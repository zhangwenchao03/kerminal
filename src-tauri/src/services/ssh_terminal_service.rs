//! SSH 远程终端会话服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        terminal::{
            SshTerminalCreateRequest, TerminalCreateRequest, TerminalOutputEvent,
            TerminalSecretInputEntry, TerminalSecretInputPlan, TerminalSessionSummary,
        },
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        remote_host_service::RemoteHostService,
        ssh_credential_resolver::{
            ResolvedSshAuthMaterial, ResolvedSshHopAuth, ResolvedSshRouteAuth,
            SshCredentialResolver,
        },
        ssh_identity_file::resolve_identity_file_path,
        ssh_route_plan::{build_ssh_route_plan_from_resolved, materialize_openssh_route_plan},
        terminal_manager::TerminalManager,
    },
};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;

const SSH_TERMINAL_KEY_DIR_NAME: &str = "ssh-terminal-keys";
const SSH_TERMINAL_IDENTITY_PREFIX: &str = "identity-";
const SSH_TERMINAL_IDENTITY_SUFFIX: &str = ".key";
const SSH_TERMINAL_STALE_IDENTITY_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// SSH 远程终端业务入口。
#[derive(Debug, Default)]
pub struct SshTerminalService;

impl SshTerminalService {
    /// 创建 SSH 远程终端服务。
    pub fn new() -> Self {
        Self
    }

    /// 清理上次异常退出遗留的 SSH 交互终端临时私钥文件。
    pub fn cleanup_temporary_identity_files(&self, paths: &KerminalPaths) -> AppResult<usize> {
        cleanup_temporary_identity_files(paths, None)
    }

    /// 创建 SSH 远程终端会话。
    pub fn create_session<F>(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        terminals: &TerminalManager,
        request: SshTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let launch = self.resolve_terminal_launch(remote_hosts, paths, request)?;
        if let Some(secret_input_plan) = launch.secret_input_plan {
            terminals.create_session_with_secret_input_plan(
                launch.request,
                Some(secret_input_plan),
                output,
            )
        } else {
            terminals.create_session(launch.request, output)
        }
    }

    /// 将 SSH 主机配置解析为本地受控 OpenSSH 命令。
    pub fn resolve_terminal_request(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        request: SshTerminalCreateRequest,
    ) -> AppResult<TerminalCreateRequest> {
        Ok(self
            .resolve_terminal_launch(remote_hosts, paths, request)?
            .request)
    }

    fn resolve_terminal_launch(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        request: SshTerminalCreateRequest,
    ) -> AppResult<ResolvedTerminalLaunch> {
        validate_terminal_size(request.rows, request.cols)?;
        let host = remote_hosts.require_host(&request.host_id)?;
        let resolved_auth = resolve_route_auth(paths, &host)?;
        let secret_input_plan =
            terminal_secret_input_plan_from_resolved_route(&host, &resolved_auth);
        let ssh = resolve_ssh_executable()?;

        if !host.ssh_options.jump_hosts.is_empty() {
            return build_jump_terminal_launch(
                &host,
                &resolved_auth,
                ssh,
                paths,
                paths.root.join("known_hosts"),
                request.cwd.as_deref(),
                request.remote_command.as_deref(),
                request.rows,
                request.cols,
            );
        }

        let identity = resolve_identity(&resolved_auth.target.material, paths)?;

        let terminal_request = build_ssh_terminal_request(
            &host,
            ssh,
            paths.root.join("known_hosts"),
            identity,
            request.cwd.as_deref(),
            request.remote_command.as_deref(),
            request.rows,
            request.cols,
        )?;
        Ok(ResolvedTerminalLaunch {
            request: terminal_request,
            secret_input_plan,
        })
    }
}

fn resolve_route_auth(paths: &KerminalPaths, host: &RemoteHost) -> AppResult<ResolvedSshRouteAuth> {
    let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
    resolver.resolve_host(host)
}

#[derive(Debug, Clone)]
struct ResolvedTerminalLaunch {
    request: TerminalCreateRequest,
    secret_input_plan: Option<TerminalSecretInputPlan>,
}

#[derive(Debug, Default)]
struct ResolvedSshIdentity {
    args: Vec<String>,
    cleanup_paths: Vec<PathBuf>,
}

#[doc(hidden)]
pub mod rules {
    use std::{path::PathBuf, time::Duration};

    use crate::{
        error::AppResult,
        models::terminal::{
            SshTerminalCreateRequest, TerminalCreateRequest, TerminalSecretInputPlan,
        },
        paths::KerminalPaths,
        services::{
            remote_host_service::RemoteHostService, ssh_terminal_service::SshTerminalService,
        },
    };

    pub struct TerminalLaunchPlan {
        pub request: TerminalCreateRequest,
        pub secret_input_plan: Option<TerminalSecretInputPlan>,
    }

    pub fn resolve_terminal_launch(
        service: &SshTerminalService,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        request: SshTerminalCreateRequest,
    ) -> AppResult<TerminalLaunchPlan> {
        let launch = service.resolve_terminal_launch(remote_hosts, paths, request)?;
        Ok(TerminalLaunchPlan {
            request: launch.request,
            secret_input_plan: launch.secret_input_plan,
        })
    }

    pub fn cleanup_temporary_identity_files(
        paths: &KerminalPaths,
        max_age: Option<Duration>,
    ) -> AppResult<usize> {
        super::cleanup_temporary_identity_files(paths, max_age)
    }

    pub fn temporary_identity_directory(paths: &KerminalPaths) -> PathBuf {
        super::temporary_identity_directory(paths)
    }
}

fn build_jump_terminal_launch(
    host: &RemoteHost,
    resolved_auth: &ResolvedSshRouteAuth,
    ssh_executable: String,
    paths: &KerminalPaths,
    known_hosts_path: impl AsRef<Path>,
    initial_cwd: Option<&str>,
    remote_command: Option<&str>,
    rows: u16,
    cols: u16,
) -> AppResult<ResolvedTerminalLaunch> {
    validate_terminal_size(rows, cols)?;
    let route = build_ssh_route_plan_from_resolved(resolved_auth)?;
    let open_ssh = materialize_openssh_route_plan(&route, paths, known_hosts_path)?;
    let mut args = vec!["-tt".to_owned(), "-a".to_owned()];
    args.extend(open_ssh.args);
    append_remote_startup_command(&mut args, initial_cwd, remote_command)?;

    Ok(ResolvedTerminalLaunch {
        request: TerminalCreateRequest {
            shell: Some(ssh_executable),
            args,
            cwd: None,
            cols,
            rows,
            env: terminal_environment(host),
            cleanup_paths: open_ssh.cleanup_paths,
        },
        secret_input_plan: terminal_secret_input_plan_from_resolved_route(host, resolved_auth)
            .or(Some(open_ssh.secret_input_plan)),
    })
}

fn terminal_secret_input_plan_from_resolved_route(
    host: &RemoteHost,
    auth: &ResolvedSshRouteAuth,
) -> Option<TerminalSecretInputPlan> {
    let mut entries = Vec::new();
    for (index, jump) in auth.jumps.iter().enumerate() {
        let label = host
            .ssh_options
            .jump_hosts
            .get(index)
            .and_then(|jump| (!jump.name.trim().is_empty()).then(|| jump.name.clone()))
            .unwrap_or_else(|| format!("{}@{}:{}", jump.username, jump.host, jump.port));
        if let Some(entry) =
            password_secret_input_entry(format!("jump-{index}:password"), label, jump)
        {
            entries.push(entry);
        }
    }

    let target_label = if host.name.trim().is_empty() {
        format!(
            "{}@{}:{}",
            auth.target.username, auth.target.host, auth.target.port
        )
    } else {
        host.name.clone()
    };
    if let Some(entry) =
        password_secret_input_entry("target:password".to_owned(), target_label, &auth.target)
    {
        entries.push(entry);
    }

    (!entries.is_empty()).then_some(TerminalSecretInputPlan { entries })
}

fn password_secret_input_entry(
    id: String,
    label: String,
    hop: &ResolvedSshHopAuth,
) -> Option<TerminalSecretInputEntry> {
    let ResolvedSshAuthMaterial::Password { value, .. } = &hop.material else {
        return None;
    };
    Some(TerminalSecretInputEntry {
        id,
        label,
        prompt_markers: resolved_password_prompt_markers(hop),
        response: value.clone(),
        redact_values: vec![value.clone()],
        max_responses: 1,
    })
}

fn resolved_password_prompt_markers(hop: &ResolvedSshHopAuth) -> Vec<String> {
    vec![
        format!("{}@{}'s password:", hop.username, hop.host),
        format!("{}'s password:", hop.host),
        "password:".to_owned(),
    ]
}

fn build_ssh_terminal_request(
    host: &RemoteHost,
    ssh_executable: String,
    known_hosts_path: impl AsRef<Path>,
    identity: ResolvedSshIdentity,
    initial_cwd: Option<&str>,
    remote_command: Option<&str>,
    rows: u16,
    cols: u16,
) -> AppResult<TerminalCreateRequest> {
    validate_terminal_size(rows, cols)?;

    let mut args = vec![
        "-tt".to_owned(),
        "-a".to_owned(),
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
        "-o".to_owned(),
        format!(
            "UserKnownHostsFile={}",
            display_path_arg(known_hosts_path.as_ref())
        ),
        "-o".to_owned(),
        "GlobalKnownHostsFile=none".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.extend(identity.args);
    args.push(format!("{}@{}", host.username, host.host));
    append_remote_startup_command(&mut args, initial_cwd, remote_command)?;

    Ok(TerminalCreateRequest {
        shell: Some(ssh_executable),
        args,
        cwd: None,
        cols,
        rows,
        env: terminal_environment(host),
        cleanup_paths: identity.cleanup_paths,
    })
}

fn append_remote_startup_command(
    args: &mut Vec<String>,
    initial_cwd: Option<&str>,
    remote_command: Option<&str>,
) -> AppResult<()> {
    let remote_command = normalized_remote_command(remote_command)?;
    let cwd = normalized_remote_cwd(initial_cwd);
    match (cwd, remote_command.as_deref()) {
        (Some(cwd), Some(command)) => {
            args.push(format!("cd -- {} && exec {command}", shell_quote(cwd)))
        }
        (Some(cwd), None) => args.push(format!(
            "cd -- {} && exec \"${{SHELL:-/bin/sh}}\" -l",
            shell_quote(cwd)
        )),
        (None, Some(command)) => args.push(format!("exec {command}")),
        (None, None) => {}
    }
    Ok(())
}

fn normalized_remote_cwd(initial_cwd: Option<&str>) -> Option<&str> {
    initial_cwd
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty() && cwd.starts_with('/'))
}

fn normalized_remote_command(remote_command: Option<&str>) -> AppResult<Option<String>> {
    let Some(command) = remote_command
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if command.len() > 4096 {
        return Err(AppError::InvalidInput(
            "SSH 远端启动命令不能超过 4096 字节".to_owned(),
        ));
    }
    if command.contains('\0') || command.contains('\r') {
        return Err(AppError::InvalidInput(
            "SSH 远端启动命令不能包含非法控制字符".to_owned(),
        ));
    }
    Ok(Some(command.to_owned()))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn terminal_environment(host: &RemoteHost) -> HashMap<String, String> {
    let terminal_type = host.ssh_options.terminal.terminal_type.trim();
    let terminal_type = if terminal_type.is_empty() {
        "xterm-256color"
    } else {
        terminal_type
    };

    HashMap::from([("TERM".to_owned(), terminal_type.to_owned())])
}

fn validate_terminal_size(rows: u16, cols: u16) -> AppResult<()> {
    if rows == 0 || cols == 0 {
        return Err(AppError::InvalidInput(
            "终端行数和列数必须大于 0".to_owned(),
        ));
    }
    Ok(())
}

fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "publickey,password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn resolve_identity(
    material: &ResolvedSshAuthMaterial,
    paths: &KerminalPaths,
) -> AppResult<ResolvedSshIdentity> {
    match material {
        ResolvedSshAuthMaterial::PrivateKeyPem { content, .. } => {
            let private_key = normalize_private_key_content(content.to_owned())?;
            let path = write_temporary_identity_file(paths, &private_key)?;
            Ok(identity_file_args(path, true))
        }
        ResolvedSshAuthMaterial::PrivateKeyPath { path, .. } => {
            let credential_ref = path.to_string_lossy();
            if credential_ref.trim().starts_with("credential:") {
                return Err(AppError::InvalidInput(
                    "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                        .to_owned(),
                ));
            }
            Ok(identity_file_args(
                resolve_identity_file_path(&credential_ref)?,
                false,
            ))
        }
        ResolvedSshAuthMaterial::Agent { .. }
        | ResolvedSshAuthMaterial::Password { .. }
        | ResolvedSshAuthMaterial::PromptOnly { .. } => Ok(ResolvedSshIdentity::default()),
    }
}

fn identity_file_args(path: PathBuf, cleanup: bool) -> ResolvedSshIdentity {
    let cleanup_paths = if cleanup {
        vec![path.clone()]
    } else {
        Vec::new()
    };
    ResolvedSshIdentity {
        args: vec![
            "-i".to_owned(),
            display_path_arg(&path),
            "-o".to_owned(),
            "IdentitiesOnly=yes".to_owned(),
        ],
        cleanup_paths,
    }
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
    let path = directory.join(format!("identity-{}.key", Uuid::new_v4()));

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
    cleanup_temporary_identity_files(paths, Some(SSH_TERMINAL_STALE_IDENTITY_MAX_AGE))
}

fn cleanup_temporary_identity_files(
    paths: &KerminalPaths,
    max_age: Option<Duration>,
) -> AppResult<usize> {
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

        if let Some(max_age) = max_age {
            let metadata = entry.metadata()?;
            if !identity_file_is_stale(&metadata, max_age) {
                continue;
            }
        }

        fs::remove_file(entry.path())?;
        removed += 1;
    }

    Ok(removed)
}

fn temporary_identity_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(SSH_TERMINAL_KEY_DIR_NAME)
}

fn is_managed_identity_file_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|name| {
        name.starts_with(SSH_TERMINAL_IDENTITY_PREFIX)
            && name.ends_with(SSH_TERMINAL_IDENTITY_SUFFIX)
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

fn resolve_ssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::Terminal(
                "未找到 OpenSSH 客户端，请安装 ssh 或确认 ssh 已加入 PATH".to_owned(),
            )
        })
}
