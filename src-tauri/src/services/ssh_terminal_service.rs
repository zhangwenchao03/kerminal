//! SSH 远程终端会话服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        terminal::{
            SshTerminalCreateRequest, TerminalCreateRequest, TerminalOutputEvent,
            TerminalSecretInputPlan, TerminalSecretInputResponse, TerminalSessionSummary,
        },
    },
    paths::KerminalPaths,
    services::{
        ssh_route_plan::{build_ssh_route_plan, materialize_openssh_route_plan},
        terminal_manager::TerminalManager,
    },
    storage::SqliteStore,
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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        terminals: &TerminalManager,
        request: SshTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let launch = self.resolve_terminal_launch(storage, paths, request)?;
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
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SshTerminalCreateRequest,
    ) -> AppResult<TerminalCreateRequest> {
        Ok(self
            .resolve_terminal_launch(storage, paths, request)?
            .request)
    }

    fn resolve_terminal_launch(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: SshTerminalCreateRequest,
    ) -> AppResult<ResolvedTerminalLaunch> {
        validate_terminal_size(request.rows, request.cols)?;
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        let ssh = resolve_ssh_executable()?;

        if !host.ssh_options.jump_hosts.is_empty() {
            return build_jump_terminal_launch(
                &host,
                ssh,
                paths,
                paths.root.join("known_hosts"),
                request.rows,
                request.cols,
            );
        }

        let identity = resolve_identity(&host, paths)?;
        let secret_input_response = resolve_secret_input_response(&host);

        let mut terminal_request = build_ssh_terminal_request(
            &host,
            ssh,
            paths.root.join("known_hosts"),
            identity,
            request.rows,
            request.cols,
        )?;
        terminal_request.secret_input_response = secret_input_response;
        Ok(ResolvedTerminalLaunch {
            request: terminal_request,
            secret_input_plan: None,
        })
    }
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

fn build_jump_terminal_launch(
    host: &RemoteHost,
    ssh_executable: String,
    paths: &KerminalPaths,
    known_hosts_path: impl AsRef<Path>,
    rows: u16,
    cols: u16,
) -> AppResult<ResolvedTerminalLaunch> {
    validate_terminal_size(rows, cols)?;
    let route = build_ssh_route_plan(host)?;
    let open_ssh = materialize_openssh_route_plan(&route, paths, known_hosts_path)?;
    let mut args = vec!["-tt".to_owned(), "-a".to_owned()];
    args.extend(open_ssh.args);

    Ok(ResolvedTerminalLaunch {
        request: TerminalCreateRequest {
            shell: Some(ssh_executable),
            args,
            cwd: None,
            cols,
            rows,
            env: terminal_environment(host),
            cleanup_paths: open_ssh.cleanup_paths,
            secret_input_response: None,
        },
        secret_input_plan: Some(open_ssh.secret_input_plan),
    })
}

fn build_ssh_terminal_request(
    host: &RemoteHost,
    ssh_executable: String,
    known_hosts_path: impl AsRef<Path>,
    identity: ResolvedSshIdentity,
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

    Ok(TerminalCreateRequest {
        shell: Some(ssh_executable),
        args,
        cwd: None,
        cols,
        rows,
        env: terminal_environment(host),
        cleanup_paths: identity.cleanup_paths,
        secret_input_response: None,
    })
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
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn resolve_identity(host: &RemoteHost, paths: &KerminalPaths) -> AppResult<ResolvedSshIdentity> {
    if host.auth_type != RemoteHostAuthType::Key {
        return Ok(ResolvedSshIdentity::default());
    }

    if let Some(private_key) = normalized_credential_secret(host) {
        let private_key = normalize_private_key_content(private_key.to_owned())?;
        let path = write_temporary_identity_file(paths, &private_key)?;
        return Ok(identity_file_args(path, true));
    }

    let Some(credential_ref) = host.credential_ref.as_deref() else {
        return Ok(ResolvedSshIdentity::default());
    };
    let credential_ref = credential_ref.trim();
    if credential_ref.is_empty() {
        return Ok(ResolvedSshIdentity::default());
    }

    if credential_ref.starts_with("credential:") {
        return Err(AppError::InvalidInput(
            "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容".to_owned(),
        ));
    }

    Ok(identity_file_args(PathBuf::from(credential_ref), false))
}

fn resolve_secret_input_response(host: &RemoteHost) -> Option<TerminalSecretInputResponse> {
    if host.auth_type != RemoteHostAuthType::Password {
        return None;
    }

    let Some(password) = normalized_credential_secret(host) else {
        return None;
    };
    let password = password.to_owned();

    Some(TerminalSecretInputResponse {
        prompt_markers: password_prompt_markers(host),
        redact_values: vec![password.clone()],
        response: password,
        max_responses: 1,
    })
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn password_prompt_markers(host: &RemoteHost) -> Vec<String> {
    vec![
        format!("{}@{}'s password:", host.username, host.host),
        format!("{}'s password:", host.host),
        "password:".to_owned(),
    ]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::remote_host::SshJumpHostOptions;
    use std::{fs, path::PathBuf};
    use tempfile::tempdir;

    const JUMP_PASSWORD: &str = "jump-password-secret";
    const TARGET_PASSWORD: &str = "target-password-secret";

    fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
        remote_host_with_credential(auth_type, Some("C:/Users/kong/.ssh/dev".to_owned()))
    }

    fn remote_host_with_credential(
        auth_type: RemoteHostAuthType,
        credential_ref: Option<String>,
    ) -> RemoteHost {
        RemoteHost {
            id: "host-1".to_owned(),
            group_id: Some("group-1".to_owned()),
            name: "dev".to_owned(),
            host: "dev.internal".to_owned(),
            port: 2222,
            username: "deploy".to_owned(),
            auth_type,
            credential_ref,
            credential_secret: None,
            tags: vec!["dev".to_owned()],
            production: false,
            ssh_options: Default::default(),
            sort_order: 10,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        }
    }

    #[test]
    fn build_ssh_terminal_request_uses_parameterized_openssh_args() {
        let request = build_ssh_terminal_request(
            &remote_host(RemoteHostAuthType::Key),
            "ssh".to_owned(),
            PathBuf::from("C:/Users/kong/AppData/Roaming/kerminal/known_hosts"),
            ResolvedSshIdentity::default(),
            24,
            80,
        )
        .expect("build request");

        assert_eq!(request.shell.as_deref(), Some("ssh"));
        assert_eq!(request.rows, 24);
        assert_eq!(request.cols, 80);
        assert!(request.args.contains(&"-tt".to_owned()));
        assert!(request.args.contains(&"-a".to_owned()));
        assert!(!request.args.contains(&"-A".to_owned()));
        assert!(request.args.windows(2).any(|pair| pair == ["-p", "2222"]));
        assert!(request
            .args
            .contains(&"PreferredAuthentications=publickey".to_owned()));
        assert!(request.args.contains(
            &"UserKnownHostsFile=C:/Users/kong/AppData/Roaming/kerminal/known_hosts".to_owned()
        ));
        assert!(request
            .args
            .contains(&"GlobalKnownHostsFile=none".to_owned()));
        assert_eq!(
            request.args.last().map(String::as_str),
            Some("deploy@dev.internal")
        );
    }

    #[test]
    fn build_ssh_terminal_request_uses_key_path_identity_file() {
        let key_path = "C:/Users/kong/.ssh/dev ed25519".to_owned();
        let request = build_ssh_terminal_request(
            &remote_host_with_credential(RemoteHostAuthType::Key, Some(key_path.clone())),
            "ssh".to_owned(),
            PathBuf::from("C:/Users/kong/AppData/Roaming/kerminal/known_hosts"),
            identity_file_args(PathBuf::from(&key_path), false),
            24,
            80,
        )
        .expect("build request");

        assert!(request
            .args
            .windows(2)
            .any(|pair| pair[0] == "-i" && pair[1] == key_path));
        assert!(request.args.contains(&"IdentitiesOnly=yes".to_owned()));
    }

    #[test]
    fn build_ssh_terminal_request_does_not_add_identity_without_resolved_args() {
        let request = build_ssh_terminal_request(
            &remote_host(RemoteHostAuthType::Key),
            "ssh".to_owned(),
            PathBuf::from("C:/Users/kong/AppData/Roaming/kerminal/known_hosts"),
            ResolvedSshIdentity::default(),
            24,
            80,
        )
        .expect("build request");

        assert!(!request.args.contains(&"-i".to_owned()));
        assert!(request
            .args
            .contains(&"PreferredAuthentications=publickey".to_owned()));
    }

    #[test]
    fn build_ssh_terminal_request_rejects_zero_size() {
        let error = build_ssh_terminal_request(
            &remote_host(RemoteHostAuthType::Agent),
            "ssh".to_owned(),
            PathBuf::from("C:/Users/kong/AppData/Roaming/kerminal/known_hosts"),
            ResolvedSshIdentity::default(),
            0,
            80,
        )
        .expect_err("reject zero rows");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn cleanup_temporary_identity_files_removes_only_managed_keys() {
        let home = tempdir().expect("create temp home");
        let paths = KerminalPaths::from_home_dir(home.path());
        let key_dir = temporary_identity_directory(&paths);
        fs::create_dir_all(&key_dir).unwrap();
        let managed = key_dir.join("identity-managed.key");
        let unrelated = key_dir.join("manual.key");
        let wrong_suffix = key_dir.join("identity-managed.txt");
        fs::write(&managed, "private key").unwrap();
        fs::write(&unrelated, "manual").unwrap();
        fs::write(&wrong_suffix, "not a managed key").unwrap();

        let removed = cleanup_temporary_identity_files(&paths, None).unwrap();

        assert_eq!(removed, 1);
        assert!(!managed.exists());
        assert!(unrelated.exists());
        assert!(wrong_suffix.exists());
    }

    #[test]
    fn cleanup_stale_temporary_identity_files_honors_age_gate() {
        let home = tempdir().expect("create temp home");
        let paths = KerminalPaths::from_home_dir(home.path());
        let key_dir = temporary_identity_directory(&paths);
        fs::create_dir_all(&key_dir).unwrap();
        let fresh = key_dir.join("identity-fresh.key");
        fs::write(&fresh, "private key").unwrap();

        let removed =
            cleanup_temporary_identity_files(&paths, Some(Duration::from_secs(60 * 60))).unwrap();
        assert_eq!(removed, 0);
        assert!(fresh.exists());

        let removed = cleanup_temporary_identity_files(&paths, Some(Duration::ZERO)).unwrap();
        assert_eq!(removed, 1);
        assert!(!fresh.exists());
    }

    #[test]
    fn build_jump_terminal_launch_uses_multi_secret_plan_without_leaking_args() {
        let home = tempdir().expect("create temp home");
        let paths = KerminalPaths::from_home_dir(home.path());
        let mut host = remote_host_with_credential(RemoteHostAuthType::Password, None);
        host.credential_secret = Some(TARGET_PASSWORD.to_owned());
        host.ssh_options.jump_hosts = vec![SshJumpHostOptions {
            name: "password-jump".to_owned(),
            host: "bastion.internal".to_owned(),
            port: 2022,
            username: "jump".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(JUMP_PASSWORD.to_owned()),
        }];

        let launch = build_jump_terminal_launch(
            &host,
            "ssh".to_owned(),
            &paths,
            paths.root.join("known_hosts"),
            24,
            80,
        )
        .expect("build jump terminal launch");

        assert_eq!(launch.request.shell.as_deref(), Some("ssh"));
        assert!(launch
            .request
            .args
            .windows(2)
            .any(|pair| pair[0] == "-F" && PathBuf::from(&pair[1]).exists()));
        assert_eq!(
            launch.request.args.last().map(String::as_str),
            Some("kerminal-target")
        );
        assert!(launch.request.secret_input_response.is_none());
        assert!(!launch
            .request
            .args
            .iter()
            .any(|arg| arg.contains(JUMP_PASSWORD) || arg.contains(TARGET_PASSWORD)));

        let secret_plan = launch.secret_input_plan.expect("multi secret plan");
        assert_eq!(secret_plan.entries.len(), 2);
        assert_eq!(
            secret_plan
                .entries
                .iter()
                .map(|entry| (entry.id.as_str(), entry.response.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("jump-0:password", JUMP_PASSWORD),
                ("target:password", TARGET_PASSWORD),
            ]
        );
        assert_eq!(
            secret_plan.redact_values(),
            vec![JUMP_PASSWORD.to_owned(), TARGET_PASSWORD.to_owned()]
        );

        cleanup_paths(&launch.request.cleanup_paths);
    }

    fn cleanup_paths(paths: &[PathBuf]) {
        for path in paths {
            let _ = fs::remove_file(path);
        }
    }
}
