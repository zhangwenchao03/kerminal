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
        external_launch::{is_external_target_id, ExternalSessionMaterializer},
        remote_host_service::RemoteHostService,
        ssh_credential_resolver::{
            ResolvedSshAuthMaterial, ResolvedSshHopAuth, ResolvedSshRouteAuth,
            SshCredentialResolver,
        },
        ssh_identity_file::resolve_identity_file_path,
        ssh_route_plan::{
            build_ssh_route_plan_from_resolved, materialize_openssh_route_plan_with_keepalive,
        },
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshAuthPromptPlan},
            session_key::ssh_session_key_for_route,
            ManagedSshSessionManager, SshRuntimeConnectRequest, SshRuntimeHostKeyPolicy,
            SshRuntimeShellRequest, MANAGED_SSH_SHELL_UNSUPPORTED,
        },
        terminal_manager::{
            TerminalManagedShellCreateRequest, TerminalManagedShellRuntime, TerminalManager,
        },
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
const LEGACY_FALLBACK_SHELL_UNWIRED: &str = "managed-shell-backend-unwired";
const LEGACY_FALLBACK_SHELL_UNSUPPORTED: &str = "managed-shell-unsupported";

/// SSH 远程终端业务入口。
#[derive(Debug, Default)]
pub struct SshTerminalService {
    managed_runtime: Option<ManagedSshSessionManager>,
    auth_broker: Option<SshAuthBroker>,
    external_targets: Option<ExternalSessionMaterializer>,
}

impl SshTerminalService {
    /// 创建 SSH 远程终端服务。
    pub fn new() -> Self {
        Self {
            managed_runtime: None,
            auth_broker: None,
            external_targets: None,
        }
    }

    /// 创建可解析外部启动临时 target 的 SSH 远程终端服务。
    pub fn with_external_targets(external_targets: ExternalSessionMaterializer) -> Self {
        Self {
            managed_runtime: None,
            auth_broker: None,
            external_targets: Some(external_targets),
        }
    }

    /// 创建接入受管 SSH 运行时的 SSH 远程终端服务。
    pub fn with_ssh_runtime(
        managed_runtime: ManagedSshSessionManager,
        auth_broker: SshAuthBroker,
        external_targets: ExternalSessionMaterializer,
    ) -> Self {
        Self {
            managed_runtime: Some(managed_runtime),
            auth_broker: Some(auth_broker),
            external_targets: Some(external_targets),
        }
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
        if let Some(managed_launch) = self.try_open_managed_shell(remote_hosts, paths, &request)? {
            return terminals.create_managed_shell_session(
                managed_launch.request,
                managed_launch.shell,
                output,
            );
        }

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
        let (host, resolved_auth) =
            self.resolve_host_and_auth(remote_hosts, paths, &request.host_id)?;
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
                TerminalLaunchShape::from_request_and_host(&request, &host),
            );
        }

        let identity = resolve_identity(&resolved_auth.target.material, paths)?;

        let terminal_request = build_ssh_terminal_request(
            &host,
            ssh,
            paths.root.join("known_hosts"),
            identity,
            TerminalLaunchShape::from_request_and_host(&request, &host),
        )?;
        Ok(ResolvedTerminalLaunch {
            request: terminal_request,
            secret_input_plan,
        })
    }

    fn resolve_host_and_auth(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        host_id: &str,
    ) -> AppResult<(RemoteHost, ResolvedSshRouteAuth)> {
        if let Some(external_targets) = &self.external_targets {
            if let Some(target) = external_targets.resolve_target(host_id)? {
                return Ok((target.host, target.route_auth));
            }
        }
        if is_external_target_id(host_id) {
            return Err(external_target_not_available_error(host_id));
        }
        let host = remote_hosts.require_host(host_id)?;
        let resolved_auth = resolve_route_auth(paths, &host)?;
        Ok((host, resolved_auth))
    }

    fn try_open_managed_shell(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        request: &SshTerminalCreateRequest,
    ) -> AppResult<Option<ManagedTerminalLaunch>> {
        let Some(managed_runtime) = self.managed_runtime.as_ref() else {
            return Ok(None);
        };

        validate_terminal_size(request.rows, request.cols)?;
        let (host, route_auth) =
            self.resolve_host_and_auth(remote_hosts, paths, &request.host_id)?;
        let route_auth = match &self.auth_broker {
            Some(auth_broker) => match auth_broker.resolve_route_auth(&route_auth)? {
                SshAuthBrokerResolution::Ready { auth } => auth,
                SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                    return Err(ssh_auth_prompt_required_error(&host, prompt_plan));
                }
            },
            None => route_auth,
        };
        let runtime_host =
            SshCredentialResolver::materialize_runtime_host_from_auth(&host, &route_auth);
        let initial_cwd = terminal_initial_cwd(request.cwd.as_deref(), &runtime_host);
        let startup_input = remote_startup_input(initial_cwd, request.remote_command.as_deref())?;
        let known_hosts_path = paths.root.join("known_hosts");
        let key = ssh_session_key_for_route(&runtime_host, &route_auth, &known_hosts_path)?;
        let connect_request = SshRuntimeConnectRequest::native(
            key,
            runtime_host.clone(),
            known_hosts_path,
            terminal_connect_timeout_seconds(&runtime_host),
        )
        .with_keepalive_seconds(terminal_keepalive_seconds(&runtime_host))
        .with_host_key_policy(host_key_policy_for_host(&runtime_host));
        let session = match managed_runtime.acquire_session_with_request(connect_request) {
            Ok(session) => session,
            Err(error) if is_managed_runtime_unwired(&error) => {
                managed_runtime.record_legacy_fallback(
                    "shell",
                    LEGACY_FALLBACK_SHELL_UNWIRED,
                    Some(terminal_host_label(&runtime_host)),
                );
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        let shell_request =
            SshRuntimeShellRequest::new(terminal_type(&runtime_host), request.cols, request.rows);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        let shell = match runtime.block_on(session.open_shell(shell_request)) {
            Ok(shell) => shell,
            Err(error) if is_managed_shell_unsupported(&error) => {
                managed_runtime.record_legacy_fallback(
                    "shell",
                    LEGACY_FALLBACK_SHELL_UNSUPPORTED,
                    Some(terminal_host_label(&runtime_host)),
                );
                return Ok(None);
            }
            Err(error) => return Err(error),
        };

        Ok(Some(ManagedTerminalLaunch {
            request: TerminalManagedShellCreateRequest {
                shell: managed_shell_label(&runtime_host),
                cwd: normalized_remote_cwd(initial_cwd).map(ToOwned::to_owned),
                startup_input,
                cols: request.cols,
                rows: request.rows,
                target_ref: Some(request.host_id.clone()),
            },
            shell: TerminalManagedShellRuntime { shell, runtime },
        }))
    }
}

fn terminal_host_label(host: &RemoteHost) -> String {
    format!("{}@{}:{}", host.username, host.host, host.port)
}

fn external_target_not_available_error(host_id: &str) -> AppError {
    AppError::NotFound(format!("外部 SSH 临时目标不存在或已关闭: {host_id}"))
}

fn host_key_policy_for_host(host: &RemoteHost) -> SshRuntimeHostKeyPolicy {
    if is_external_target_id(&host.id) {
        SshRuntimeHostKeyPolicy::TrustUnknown
    } else {
        SshRuntimeHostKeyPolicy::RequireKnown
    }
}

fn ssh_auth_prompt_required_error(host: &RemoteHost, prompt_plan: SshAuthPromptPlan) -> AppError {
    let prompt_count = prompt_plan.prompts.len();
    let prompt_plan =
        serde_json::to_value(prompt_plan).unwrap_or_else(|_| serde_json::json!({ "prompts": [] }));
    AppError::SshAuthPromptRequired {
        message: format!(
            "{} 需要 SSH 认证输入（{} 个 prompt）",
            terminal_host_label(host),
            prompt_count
        ),
        prompt_plan,
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

struct ManagedTerminalLaunch {
    request: TerminalManagedShellCreateRequest,
    shell: TerminalManagedShellRuntime,
}

#[derive(Debug, Default)]
struct ResolvedSshIdentity {
    args: Vec<String>,
    cleanup_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy)]
struct TerminalLaunchShape<'a> {
    initial_cwd: Option<&'a str>,
    remote_command: Option<&'a str>,
    rows: u16,
    cols: u16,
}

impl<'a> TerminalLaunchShape<'a> {
    fn from_request_and_host(request: &'a SshTerminalCreateRequest, host: &'a RemoteHost) -> Self {
        Self {
            initial_cwd: terminal_initial_cwd(request.cwd.as_deref(), host),
            remote_command: request.remote_command.as_deref(),
            rows: request.rows,
            cols: request.cols,
        }
    }
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

    pub fn try_open_managed_shell(
        service: &SshTerminalService,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        request: SshTerminalCreateRequest,
    ) -> AppResult<bool> {
        Ok(service
            .try_open_managed_shell(remote_hosts, paths, &request)?
            .is_some())
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
    shape: TerminalLaunchShape<'_>,
) -> AppResult<ResolvedTerminalLaunch> {
    let TerminalLaunchShape {
        initial_cwd,
        remote_command,
        rows,
        cols,
    } = shape;
    validate_terminal_size(rows, cols)?;
    let route = build_ssh_route_plan_from_resolved(resolved_auth)?;
    let open_ssh = materialize_openssh_route_plan_with_keepalive(
        &route,
        paths,
        known_hosts_path,
        terminal_keepalive_seconds(host),
    )?;
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
    shape: TerminalLaunchShape<'_>,
) -> AppResult<TerminalCreateRequest> {
    let TerminalLaunchShape {
        initial_cwd,
        remote_command,
        rows,
        cols,
    } = shape;
    validate_terminal_size(rows, cols)?;

    let mut args = vec![
        "-tt".to_owned(),
        "-a".to_owned(),
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        format!("ServerAliveInterval={}", terminal_keepalive_seconds(host)),
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
    if let Some(command) = remote_startup_command(initial_cwd, remote_command)? {
        args.push(command);
    }
    Ok(())
}

fn remote_startup_input(
    initial_cwd: Option<&str>,
    remote_command: Option<&str>,
) -> AppResult<Option<String>> {
    Ok(remote_startup_command(initial_cwd, remote_command)?.map(|command| format!("{command}\r")))
}

fn remote_startup_command(
    initial_cwd: Option<&str>,
    remote_command: Option<&str>,
) -> AppResult<Option<String>> {
    let remote_command = normalized_remote_command(remote_command)?;
    let cwd = normalized_remote_cwd(initial_cwd);
    Ok(match (cwd, remote_command.as_deref()) {
        (Some(cwd), Some(command)) => Some(format!("cd -- {} && exec {command}", shell_quote(cwd))),
        (Some(cwd), None) => Some(format!(
            "cd -- {} && exec \"${{SHELL:-/bin/sh}}\" -l",
            shell_quote(cwd)
        )),
        (None, Some(command)) => Some(format!("exec {command}")),
        (None, None) => None,
    })
}

fn terminal_initial_cwd<'a>(request_cwd: Option<&'a str>, host: &'a RemoteHost) -> Option<&'a str> {
    let request_cwd = request_cwd.map(str::trim).filter(|cwd| !cwd.is_empty());
    match request_cwd {
        Some(cwd) => normalized_remote_cwd(Some(cwd)),
        None => terminal_startup_directory(host),
    }
}

fn terminal_startup_directory(host: &RemoteHost) -> Option<&str> {
    normalized_remote_cwd(Some(host.ssh_options.terminal.startup_command.as_str()))
}

fn normalized_remote_cwd(initial_cwd: Option<&str>) -> Option<&str> {
    initial_cwd.map(str::trim).filter(|cwd| {
        !cwd.is_empty()
            && cwd.starts_with('/')
            && cwd.len() <= 4096
            && !cwd.contains('\0')
            && !cwd.contains('\r')
            && !cwd.contains('\n')
    })
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
    HashMap::from([("TERM".to_owned(), terminal_type(host))])
}

fn terminal_type(host: &RemoteHost) -> String {
    let terminal_type = host.ssh_options.terminal.terminal_type.trim();
    if terminal_type.is_empty() {
        "xterm-256color".to_owned()
    } else {
        terminal_type.to_owned()
    }
}

fn terminal_connect_timeout_seconds(host: &RemoteHost) -> u64 {
    u64::from(host.ssh_options.terminal.connect_timeout_seconds).max(1)
}

fn terminal_keepalive_seconds(host: &RemoteHost) -> u64 {
    u64::from(host.ssh_options.terminal.keepalive_seconds)
}

fn managed_shell_label(host: &RemoteHost) -> String {
    if host.name.trim().is_empty() {
        format!("ssh:{}@{}:{}", host.username, host.host, host.port)
    } else {
        format!("ssh:{}", host.name)
    }
}

fn is_managed_runtime_unwired(error: &AppError) -> bool {
    matches!(error, AppError::SshCommand(message) if message.contains("managed SSH runtime backend is not wired yet"))
}

fn is_managed_shell_unsupported(error: &AppError) -> bool {
    matches!(error, AppError::SshCommand(message) if message == MANAGED_SSH_SHELL_UNSUPPORTED)
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
