//! OpenSSH 命令启动计划构建工具。
//!
//! @author kongweiguang

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        terminal::TerminalSecretInputResponse,
    },
    paths::KerminalPaths,
};

const SSH_COMMAND_KEY_DIR_NAME: &str = "ssh-command-keys";
const SSH_COMMAND_IDENTITY_PREFIX: &str = "identity-";
const SSH_COMMAND_IDENTITY_SUFFIX: &str = ".key";
const SSH_COMMAND_STALE_IDENTITY_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// SSH 认证方式的启动计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshAuthPlan {
    /// 传给 OpenSSH 的认证参数，不包含密码或私钥明文。
    pub args: Vec<String>,
    /// 认证完成或进程退出后需要清理的本地临时文件。
    pub cleanup_paths: Vec<PathBuf>,
    /// 密码认证的 PTY 安全响应计划；不参与日志和命令行。
    pub secret_input_response: Option<TerminalSecretInputResponse>,
    /// 当前计划使用的认证方式。
    pub method: SshAuthMethod,
}

/// SSH 认证方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshAuthMethod {
    /// 私钥认证。
    Key,
    /// 系统 SSH agent 认证。
    Agent,
    /// 密码或 keyboard-interactive 认证。
    Password,
}

impl SshAuthPlan {
    /// 密码认证需要本地 PTY 读取 OpenSSH 提示并安全写回密码。
    pub fn requires_secret_response_pty(&self) -> bool {
        self.secret_input_response.is_some()
    }
}

/// 查找 OpenSSH 可执行文件。
pub fn resolve_openssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::PortForward(
                "未找到 OpenSSH 客户端，请安装 ssh 或确认 ssh 已加入 PATH".to_owned(),
            )
        })
}

/// 构建 OpenSSH known_hosts 参数。
pub fn known_hosts_args(known_hosts_path: impl AsRef<Path>) -> Vec<String> {
    vec![
        "-o".to_owned(),
        format!(
            "UserKnownHostsFile={}",
            display_path_arg(known_hosts_path.as_ref())
        ),
        "-o".to_owned(),
        "GlobalKnownHostsFile=none".to_owned(),
    ]
}

/// 构建 OpenSSH PreferredAuthentications 参数。
pub fn preferred_authentication_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

/// 解析指定主机的认证启动计划。
pub fn resolve_ssh_auth_plan(
    host: &RemoteHost,
    paths: Option<&KerminalPaths>,
) -> AppResult<SshAuthPlan> {
    match host.auth_type {
        RemoteHostAuthType::Key => resolve_key_auth_plan(host, paths),
        RemoteHostAuthType::Agent => Ok(SshAuthPlan {
            args: Vec::new(),
            cleanup_paths: Vec::new(),
            secret_input_response: None,
            method: SshAuthMethod::Agent,
        }),
        RemoteHostAuthType::Password => Ok(resolve_password_auth_plan(host)),
    }
}

/// 删除 SSH 命令临时认证文件。
pub fn cleanup_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn resolve_key_auth_plan(
    host: &RemoteHost,
    paths: Option<&KerminalPaths>,
) -> AppResult<SshAuthPlan> {
    if let Some(private_key) = normalized_credential_secret(host) {
        let paths = paths.ok_or_else(|| {
            AppError::Credential("内联 SSH 私钥需要本地数据目录用于临时身份文件".to_owned())
        })?;
        let private_key = normalize_private_key_content(private_key.to_owned())?;
        let path = write_temporary_identity_file(paths, &private_key)?;
        return Ok(identity_file_auth_plan(path, true));
    }

    let Some(credential_ref) = normalized_credential_ref(host) else {
        return Ok(SshAuthPlan {
            args: Vec::new(),
            cleanup_paths: Vec::new(),
            secret_input_response: None,
            method: SshAuthMethod::Key,
        });
    };

    if credential_ref.starts_with("credential:") {
        return Err(AppError::InvalidInput(
            "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容".to_owned(),
        ));
    }

    Ok(identity_file_auth_plan(
        PathBuf::from(credential_ref),
        false,
    ))
}

fn resolve_password_auth_plan(host: &RemoteHost) -> SshAuthPlan {
    let response = normalized_credential_secret(host).map(|password| {
        let password = password.to_owned();
        TerminalSecretInputResponse {
            prompt_markers: password_prompt_markers(host),
            redact_values: vec![password.clone()],
            response: password,
            max_responses: 1,
        }
    });

    SshAuthPlan {
        args: Vec::new(),
        cleanup_paths: Vec::new(),
        secret_input_response: response,
        method: SshAuthMethod::Password,
    }
}

fn normalized_credential_ref(host: &RemoteHost) -> Option<&str> {
    host.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn identity_file_auth_plan(path: PathBuf, cleanup: bool) -> SshAuthPlan {
    let cleanup_paths = if cleanup {
        vec![path.clone()]
    } else {
        Vec::new()
    };
    SshAuthPlan {
        args: vec![
            "-i".to_owned(),
            display_path_arg(&path),
            "-o".to_owned(),
            "IdentitiesOnly=yes".to_owned(),
        ],
        cleanup_paths,
        secret_input_response: None,
        method: SshAuthMethod::Key,
    }
}

fn password_prompt_markers(host: &RemoteHost) -> Vec<String> {
    vec![
        format!("{}@{}'s password:", host.username, host.host),
        format!("{}'s password:", host.host),
        "password:".to_owned(),
    ]
}

fn normalize_private_key_content(private_key: String) -> AppResult<String> {
    let trimmed = private_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Credential("SSH 私钥凭据内容为空".to_owned()));
    }

    let mut normalized = trimmed.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.ends_with('\n') {
        normalized.push('\n');
    }
    Ok(normalized)
}

fn write_temporary_identity_file(paths: &KerminalPaths, private_key: &str) -> AppResult<PathBuf> {
    cleanup_stale_temporary_identity_files(paths)?;

    let directory = temporary_identity_directory(paths);
    fs::create_dir_all(&directory)?;
    let path = directory.join(format!(
        "{SSH_COMMAND_IDENTITY_PREFIX}{}{SSH_COMMAND_IDENTITY_SUFFIX}",
        Uuid::new_v4()
    ));

    let write_result: AppResult<()> = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            options.mode(0o600);
        }

        let mut file = options.open(&path)?;
        file.write_all(private_key.as_bytes())?;
        file.flush()?;

        #[cfg(unix)]
        {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&path);
    }
    write_result?;

    Ok(path)
}

fn cleanup_stale_temporary_identity_files(paths: &KerminalPaths) -> AppResult<usize> {
    let directory = temporary_identity_directory(paths);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };

    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() || !is_managed_identity_file_name(&entry.file_name()) {
            continue;
        }
        let metadata = entry.metadata()?;
        if !identity_file_is_stale(&metadata, SSH_COMMAND_STALE_IDENTITY_MAX_AGE) {
            continue;
        }
        fs::remove_file(entry.path())?;
        removed += 1;
    }
    Ok(removed)
}

fn temporary_identity_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(SSH_COMMAND_KEY_DIR_NAME)
}

fn is_managed_identity_file_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|name| {
        name.starts_with(SSH_COMMAND_IDENTITY_PREFIX) && name.ends_with(SSH_COMMAND_IDENTITY_SUFFIX)
    })
}

fn identity_file_is_stale(metadata: &fs::Metadata, max_age: Duration) -> bool {
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default()
        >= max_age
}

fn display_path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
