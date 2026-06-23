//! SSH 端口转发服务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    fmt,
    io::{Read, Write},
    net::IpAddr,
    path::PathBuf,
    process::{Child, Stdio},
    sync::Mutex,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        port_forward::{
            PortForwardCreateRequest, PortForwardEndpoint, PortForwardKind,
            PortForwardProxyProtocol, PortForwardPurpose, PortForwardRemoteAccessScope,
            PortForwardStatus, PortForwardSummary,
        },
        remote_host::RemoteHost,
        terminal::{TerminalSecretInputEntry, TerminalSecretInputPlan},
    },
    paths::KerminalPaths,
    services::{
        process_command::silent_command,
        ssh_command_plan::{
            cleanup_paths, known_hosts_args, preferred_authentication_args,
            resolve_openssh_executable, resolve_ssh_auth_plan, SshAuthMethod,
        },
        ssh_route_plan::{build_ssh_route_plan, materialize_openssh_route_plan},
    },
    storage::SqliteStore,
};

type PtyChildHandle = Box<dyn PtyChild + Send + Sync>;
type PtyMasterHandle = Box<dyn MasterPty + Send>;

/// SSH 端口转发业务入口。
#[derive(Debug, Default)]
pub struct PortForwardService {
    sessions: Mutex<HashMap<String, PortForwardSession>>,
}

#[derive(Debug)]
struct PortForwardSession {
    process: ManagedForwardProcess,
    cleanup_paths: Vec<PathBuf>,
    summary: PortForwardSummary,
}

enum ManagedForwardProcess {
    Process(Child),
    Pty(PtyForwardProcess),
}

struct PtyForwardProcess {
    child: PtyChildHandle,
    _master: PtyMasterHandle,
    pid: Option<u32>,
}

impl std::fmt::Debug for ManagedForwardProcess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Process(child) => formatter
                .debug_struct("Process")
                .field("pid", &child.id())
                .finish(),
            Self::Pty(process) => formatter
                .debug_struct("Pty")
                .field("pid", &process.pid)
                .finish(),
        }
    }
}

impl ManagedForwardProcess {
    fn id(&self) -> Option<u32> {
        match self {
            Self::Process(child) => Some(child.id()),
            Self::Pty(process) => process.pid,
        }
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self {
            Self::Process(child) => child
                .try_wait()
                .map(|status| status.map(|status| status.to_string()))
                .map_err(|error| AppError::PortForward(format!("无法读取端口转发状态: {error}"))),
            Self::Pty(process) => process
                .child
                .try_wait()
                .map(|status| {
                    status.map(|status| match status.signal() {
                        Some(signal) => format!("signal {signal}"),
                        None => format!("exit code {}", status.exit_code()),
                    })
                })
                .map_err(|error| AppError::PortForward(format!("无法读取端口转发状态: {error}"))),
        }
    }

    fn kill(&mut self) -> AppResult<()> {
        match self {
            Self::Process(child) => child
                .kill()
                .map_err(|error| AppError::PortForward(format!("无法停止端口转发: {error}"))),
            Self::Pty(process) => process
                .child
                .kill()
                .map_err(|error| AppError::PortForward(format!("无法停止端口转发: {error}"))),
        }
    }

    fn wait(&mut self) {
        match self {
            Self::Process(child) => {
                let _ = child.wait();
            }
            Self::Pty(process) => {
                let _ = process.child.wait();
            }
        }
    }
}

impl PortForwardService {
    /// 创建端口转发服务。
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建 SSH 端口转发。
    ///
    /// 该入口保留给不需要内联私钥临时文件的调用方。
    pub fn create(
        &self,
        storage: &SqliteStore,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        self.create_inner(storage, None, request, None, None)
    }

    /// 创建可使用 SSH 主机明文密码和内联私钥临时文件的端口转发。
    pub fn create_with_context(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        self.create_inner(storage, Some(paths), request, None, None)
    }

    /// 从已保存配置重新启动端口转发，保留原会话 id 与创建时间。
    pub fn start_with_context(
        &self,
        storage: &SqliteStore,
        paths: &KerminalPaths,
        forward_id: &str,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        let persisted = storage
            .port_forward_summary_by_id(forward_id)?
            .ok_or_else(|| AppError::NotFound(format!("端口转发不存在: {forward_id}")))?;
        self.create_inner(
            storage,
            Some(paths),
            request,
            Some(forward_id.to_owned()),
            Some(persisted.created_at),
        )
    }

    /// 列出当前端口转发。
    pub fn list(&self, storage: &SqliteStore) -> AppResult<Vec<PortForwardSummary>> {
        let (runtime_summaries, exited_updates) = {
            let mut sessions = self.sessions()?;
            let mut exited_updates = Vec::new();
            for session in sessions.values_mut() {
                if session.summary.status != PortForwardStatus::Running {
                    continue;
                }
                if let Some(status) = session.process.try_wait()? {
                    session.summary.status = PortForwardStatus::Exited;
                    session.summary.last_error =
                        Some(format!("SSH 端口转发进程已退出，退出码: {status}"));
                    session.summary.pid = None;
                    session.summary.shared_proxy_service_id = None;
                    session.summary.local_proxy_entry_id = None;
                    cleanup_paths(&session.cleanup_paths);
                    session.cleanup_paths.clear();
                    exited_updates.push(session.summary.clone());
                }
            }
            let runtime_summaries = sessions
                .values()
                .map(|session| session.summary.clone())
                .collect::<Vec<_>>();
            (runtime_summaries, exited_updates)
        };

        for summary in exited_updates {
            storage.upsert_port_forward_summary(&summary)?;
        }

        let runtime_ids = runtime_summaries
            .iter()
            .map(|summary| summary.id.clone())
            .collect::<HashSet<_>>();
        let mut summaries = storage
            .list_port_forward_summaries()?
            .into_iter()
            .map(|summary| {
                if runtime_ids.contains(&summary.id) {
                    summary
                } else {
                    restored_summary(summary)
                }
            })
            .collect::<Vec<_>>();
        for runtime_summary in runtime_summaries {
            if let Some(existing) = summaries
                .iter_mut()
                .find(|summary| summary.id == runtime_summary.id)
            {
                *existing = runtime_summary;
            } else {
                summaries.push(runtime_summary);
            }
        }
        summaries.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(summaries)
    }

    /// 获取指定端口转发摘要。
    pub fn get(
        &self,
        storage: &SqliteStore,
        forward_id: &str,
    ) -> AppResult<Option<PortForwardSummary>> {
        if let Some(summary) = self
            .sessions()?
            .get(forward_id)
            .map(|session| session.summary.clone())
        {
            return Ok(Some(summary));
        }
        Ok(storage
            .port_forward_summary_by_id(forward_id)?
            .map(restored_summary))
    }

    /// 停止端口转发，但保留已保存配置。
    pub fn stop(&self, storage: &SqliteStore, forward_id: &str) -> AppResult<bool> {
        let removed = {
            let mut sessions = self.sessions()?;
            sessions.remove(forward_id)
        };
        let Some(mut session) = removed else {
            let Some(summary) = storage.port_forward_summary_by_id(forward_id)? else {
                return Ok(false);
            };
            storage.upsert_port_forward_summary(&restored_summary(summary))?;
            return Ok(true);
        };

        let exited = session.process.try_wait()?;
        let last_error = exited.map(|status| format!("SSH 端口转发进程已退出，退出码: {status}"));
        if last_error.is_none() {
            session.process.kill()?;
        }
        session.process.wait();
        cleanup_paths(&session.cleanup_paths);
        let summary = stopped_summary(session.summary, last_error);
        storage.upsert_port_forward_summary(&summary)?;
        Ok(true)
    }

    /// 兼容旧调用方：close 等价于 stop，保留已保存配置。
    pub fn close(&self, storage: &SqliteStore, forward_id: &str) -> AppResult<bool> {
        self.stop(storage, forward_id)
    }

    /// 删除端口转发配置；如果正在运行会先停止子进程。
    pub fn delete(&self, storage: &SqliteStore, forward_id: &str) -> AppResult<bool> {
        let removed = {
            let mut sessions = self.sessions()?;
            sessions.remove(forward_id)
        };
        let Some(mut session) = removed else {
            return storage.delete_port_forward_summary(forward_id);
        };

        if session.process.try_wait()?.is_none() {
            session.process.kill()?;
        }
        session.process.wait();
        cleanup_paths(&session.cleanup_paths);
        storage.delete_port_forward_summary(forward_id)?;
        Ok(true)
    }

    fn create_inner(
        &self,
        storage: &SqliteStore,
        paths: Option<&KerminalPaths>,
        request: PortForwardCreateRequest,
        summary_id: Option<String>,
        created_at: Option<String>,
    ) -> AppResult<PortForwardSummary> {
        if let Some(forward_id) = summary_id.as_deref() {
            self.remove_stopped_session_or_reject_running(forward_id)?;
        }
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        let executable = resolve_openssh_executable()?;
        let plan = build_forward_plan(&host, executable, paths, &request)?;
        let mut process = match spawn_forward_process(&plan) {
            Ok(process) => process,
            Err(error) => {
                cleanup_paths(&plan.cleanup_paths);
                return Err(error);
            }
        };
        let pid = process.id();
        let summary = plan.to_summary(
            &host,
            &request,
            pid,
            summary_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            created_at.unwrap_or_else(unix_timestamp),
        );

        if let Some(status) = process.try_wait()? {
            cleanup_paths(&plan.cleanup_paths);
            return Err(AppError::PortForward(format!(
                "SSH 端口转发启动后立即退出，退出码: {status}"
            )));
        }

        if let Err(error) = storage.upsert_port_forward_summary(&summary) {
            let _ = process.kill();
            process.wait();
            cleanup_paths(&plan.cleanup_paths);
            return Err(error);
        }

        let mut sessions = self.sessions()?;
        sessions.insert(
            summary.id.clone(),
            PortForwardSession {
                process,
                cleanup_paths: plan.cleanup_paths,
                summary: summary.clone(),
            },
        );
        Ok(summary)
    }

    fn remove_stopped_session_or_reject_running(&self, forward_id: &str) -> AppResult<()> {
        let mut sessions = self.sessions()?;
        let Some(session) = sessions.get_mut(forward_id) else {
            return Ok(());
        };
        if session.summary.status == PortForwardStatus::Running
            && session.process.try_wait()?.is_none()
        {
            return Err(AppError::InvalidInput("端口转发已在运行".to_owned()));
        }
        if let Some(session) = sessions.remove(forward_id) {
            cleanup_paths(&session.cleanup_paths);
        }
        Ok(())
    }

    fn sessions(
        &self,
    ) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, PortForwardSession>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("port forward sessions"))
    }
}

fn restored_summary(mut summary: PortForwardSummary) -> PortForwardSummary {
    if summary.status == PortForwardStatus::Running {
        summary.last_error = Some(
            summary
                .last_error
                .unwrap_or_else(|| "应用重启后隧道不会自动重连。".to_owned()),
        );
    }
    stopped_summary(summary, None)
}

fn stopped_summary(
    mut summary: PortForwardSummary,
    last_error: Option<String>,
) -> PortForwardSummary {
    if let Some(last_error) = last_error {
        summary.last_error = Some(last_error);
    }
    summary.status = PortForwardStatus::Exited;
    summary.pid = None;
    summary.shared_proxy_service_id = None;
    summary.local_proxy_entry_id = None;
    summary
}

#[derive(Clone, PartialEq, Eq)]
struct ForwardCommandPlan {
    executable: String,
    args: Vec<String>,
    cleanup_paths: Vec<PathBuf>,
    secret_input_plan: Option<TerminalSecretInputPlan>,
    bind_host: String,
    target_host: Option<String>,
    target_port: Option<u16>,
    local_bind_host: Option<String>,
    remote_bind_host: Option<String>,
    local_endpoint: Option<PortForwardEndpoint>,
    remote_endpoint: Option<PortForwardEndpoint>,
    proxy_protocol: Option<PortForwardProxyProtocol>,
    remote_access_scope: Option<PortForwardRemoteAccessScope>,
    proxy_url: Option<String>,
    command_preview: String,
}

impl fmt::Debug for ForwardCommandPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ForwardCommandPlan")
            .field("executable", &self.executable)
            .field("args", &self.args)
            .field("cleanup_paths", &self.cleanup_paths)
            .field(
                "secret_entry_count",
                &self
                    .secret_input_plan
                    .as_ref()
                    .map(|plan| plan.entries.len())
                    .unwrap_or_default(),
            )
            .field("bind_host", &self.bind_host)
            .field("target_host", &self.target_host)
            .field("target_port", &self.target_port)
            .field("local_bind_host", &self.local_bind_host)
            .field("remote_bind_host", &self.remote_bind_host)
            .field("local_endpoint", &self.local_endpoint)
            .field("remote_endpoint", &self.remote_endpoint)
            .field("proxy_protocol", &self.proxy_protocol)
            .field("remote_access_scope", &self.remote_access_scope)
            .field("proxy_url", &self.proxy_url)
            .field("command_preview", &self.command_preview)
            .finish()
    }
}

impl ForwardCommandPlan {
    fn to_summary(
        &self,
        host: &RemoteHost,
        request: &PortForwardCreateRequest,
        pid: Option<u32>,
        id: String,
        created_at: String,
    ) -> PortForwardSummary {
        PortForwardSummary {
            id,
            host_id: host.id.clone(),
            host_name: host.name.clone(),
            name: normalized_name(request, host),
            kind: request.kind,
            purpose: request.purpose,
            origin: request.origin,
            bind_host: self.bind_host.clone(),
            local_bind_host: self.local_bind_host.clone(),
            remote_bind_host: self.remote_bind_host.clone(),
            source_port: request.source_port,
            target_host: self.target_host.clone(),
            target_port: self.target_port,
            local_endpoint: self.local_endpoint.clone(),
            remote_endpoint: self.remote_endpoint.clone(),
            proxy_protocol: self.proxy_protocol,
            remote_access_scope: self.remote_access_scope,
            proxy_url: self.proxy_url.clone(),
            proxy_apply_scope: request.proxy_apply_scope,
            shared_proxy_service_id: request.shared_proxy_service_id.clone(),
            local_proxy_entry_id: request.local_proxy_entry_id.clone(),
            command_preview: self.command_preview.clone(),
            last_error: None,
            pid,
            status: PortForwardStatus::Running,
            created_at,
        }
    }
}

fn build_forward_plan(
    host: &RemoteHost,
    executable: String,
    paths: Option<&KerminalPaths>,
    request: &PortForwardCreateRequest,
) -> AppResult<ForwardCommandPlan> {
    if request.source_port == 0 {
        return Err(AppError::InvalidInput("监听端口必须大于 0".to_owned()));
    }

    let route = resolve_forward_route(request)?;
    let mut args = vec!["-N".to_owned(), "-T".to_owned(), "-a".to_owned()];
    let cleanup_paths;
    let secret_input_plan;

    if host.ssh_options.jump_hosts.is_empty() {
        let auth = resolve_ssh_auth_plan(host, paths)?;
        let batch_mode = auth.method != SshAuthMethod::Password;

        args.extend(["-p".to_owned(), host.port.to_string()]);
        if let Some(paths) = paths {
            args.extend(known_hosts_args(paths.root.join("known_hosts")));
        }
        if batch_mode {
            args.extend(["-o".to_owned(), "BatchMode=yes".to_owned()]);
        }
        args.extend(preferred_authentication_args(host.auth_type));
        args.extend(auth.args);
        args.extend(forward_common_args());
        args.push(forward_flag(route.kind).to_owned());
        args.push(route.forward_arg);
        args.push(format!("{}@{}", host.username, host.host));

        cleanup_paths = auth.cleanup_paths;
        secret_input_plan = auth
            .secret_input_response
            .map(TerminalSecretInputPlan::from);
    } else {
        let paths = paths.ok_or_else(|| {
            AppError::InvalidInput(
                "SSH 跳板端口转发需要应用路径上下文以创建临时 ssh config".to_owned(),
            )
        })?;
        let ssh_route = build_ssh_route_plan(host)?;
        let open_ssh =
            materialize_openssh_route_plan(&ssh_route, paths, paths.root.join("known_hosts"))?;

        if open_ssh.secret_input_plan.entries.is_empty() {
            args.extend(["-o".to_owned(), "BatchMode=yes".to_owned()]);
        }
        args.extend(forward_common_args());
        args.push(forward_flag(route.kind).to_owned());
        args.push(route.forward_arg);
        args.extend(open_ssh.args);

        cleanup_paths = open_ssh.cleanup_paths;
        secret_input_plan =
            (!open_ssh.secret_input_plan.entries.is_empty()).then_some(open_ssh.secret_input_plan);
    }

    let command_preview = command_preview(&executable, &args);

    Ok(ForwardCommandPlan {
        executable,
        args,
        cleanup_paths,
        secret_input_plan,
        bind_host: route.bind_host,
        target_host: route.target_host,
        target_port: route.target_port,
        local_bind_host: route.local_bind_host,
        remote_bind_host: route.remote_bind_host,
        local_endpoint: route.local_endpoint,
        remote_endpoint: route.remote_endpoint,
        proxy_protocol: route.proxy_protocol,
        remote_access_scope: route.remote_access_scope,
        proxy_url: route.proxy_url,
        command_preview,
    })
}

fn forward_common_args() -> Vec<String> {
    vec![
        "-o".to_owned(),
        "ExitOnForwardFailure=yes".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ForwardRoutePlan {
    kind: PortForwardKind,
    forward_arg: String,
    bind_host: String,
    target_host: Option<String>,
    target_port: Option<u16>,
    local_bind_host: Option<String>,
    remote_bind_host: Option<String>,
    local_endpoint: Option<PortForwardEndpoint>,
    remote_endpoint: Option<PortForwardEndpoint>,
    proxy_protocol: Option<PortForwardProxyProtocol>,
    remote_access_scope: Option<PortForwardRemoteAccessScope>,
    proxy_url: Option<String>,
}

fn resolve_forward_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    if request.purpose == PortForwardPurpose::HostNetworkAssist {
        return resolve_host_network_assist_route(request);
    }

    match request.kind {
        PortForwardKind::Local => resolve_local_route(request),
        PortForwardKind::Remote => resolve_remote_route(request),
        PortForwardKind::Dynamic => resolve_dynamic_route(request),
    }
}

fn resolve_local_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.local_bind_host.as_deref(), request)?;
    let target_host = required_target_host(request)?;
    let target_port = required_target_port(request)?;
    let local_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "本机监听",
    )?;
    let remote_endpoint = endpoint(Some(target_host.clone()), Some(target_port), "主机目标服务")?;

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::Local,
        forward_arg: format!(
            "{}:{}:{}:{}",
            bind_host, request.source_port, target_host, target_port
        ),
        bind_host,
        target_host: Some(target_host),
        target_port: Some(target_port),
        local_bind_host: local_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        remote_bind_host: None,
        local_endpoint,
        remote_endpoint,
        proxy_protocol: None,
        remote_access_scope: None,
        proxy_url: None,
    })
}

fn resolve_remote_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.remote_bind_host.as_deref(), request)?;
    let target_host = required_target_host(request)?;
    let target_port = required_target_port(request)?;
    let remote_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "主机监听",
    )?;
    let local_endpoint = endpoint(Some(target_host.clone()), Some(target_port), "本机目标服务")?;
    let remote_access_scope = Some(
        request
            .remote_access_scope
            .unwrap_or_else(|| infer_remote_access_scope(&bind_host)),
    );

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::Remote,
        forward_arg: format!(
            "{}:{}:{}:{}",
            bind_host, request.source_port, target_host, target_port
        ),
        bind_host,
        target_host: Some(target_host),
        target_port: Some(target_port),
        local_bind_host: None,
        remote_bind_host: remote_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        local_endpoint,
        remote_endpoint,
        proxy_protocol: None,
        remote_access_scope,
        proxy_url: None,
    })
}

fn resolve_dynamic_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.local_bind_host.as_deref(), request)?;
    let local_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "本机 SOCKS",
    )?;

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::Dynamic,
        forward_arg: format!("{}:{}", bind_host, request.source_port),
        bind_host,
        target_host: None,
        target_port: None,
        local_bind_host: local_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        remote_bind_host: None,
        local_endpoint,
        remote_endpoint: None,
        proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
        remote_access_scope: None,
        proxy_url: Some(format!(
            "socks5h://{}:{}",
            format_proxy_host(&proxy_client_host(&request_bind_host(request))),
            request.source_port
        )),
    })
}

fn resolve_host_network_assist_route(
    request: &PortForwardCreateRequest,
) -> AppResult<ForwardRoutePlan> {
    let proxy_protocol = request
        .proxy_protocol
        .unwrap_or(PortForwardProxyProtocol::Http);
    let bind_host = listener_bind_host(request.remote_bind_host.as_deref(), request)?;
    let remote_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "主机代理监听",
    )?;
    let remote_access_scope = Some(
        request
            .remote_access_scope
            .unwrap_or_else(|| infer_remote_access_scope(&bind_host)),
    );

    match proxy_protocol {
        PortForwardProxyProtocol::Http => {
            let local_proxy = request.local_endpoint.as_ref().ok_or_else(|| {
                AppError::InvalidInput("HTTP 网络助手需要本机代理端点".to_owned())
            })?;
            let local_host = validate_host_like(&local_proxy.host, "本机代理地址")?;
            let local_port = required_endpoint_port(local_proxy, "本机代理端口")?;
            let local_endpoint = endpoint(
                Some(local_host.clone()),
                Some(local_port),
                "本机 HTTP CONNECT 代理",
            )?;
            Ok(ForwardRoutePlan {
                kind: PortForwardKind::Remote,
                forward_arg: format!(
                    "{}:{}:{}:{}",
                    bind_host, request.source_port, local_host, local_port
                ),
                bind_host: bind_host.clone(),
                target_host: Some(local_host),
                target_port: Some(local_port),
                local_bind_host: local_endpoint
                    .as_ref()
                    .map(|endpoint| endpoint.host.clone()),
                remote_bind_host: remote_endpoint
                    .as_ref()
                    .map(|endpoint| endpoint.host.clone()),
                local_endpoint,
                remote_endpoint,
                proxy_protocol: Some(proxy_protocol),
                remote_access_scope,
                proxy_url: Some(format!(
                    "http://{}:{}",
                    format_proxy_host(&proxy_client_host(&bind_host)),
                    request.source_port
                )),
            })
        }
        PortForwardProxyProtocol::Socks5 => Ok(ForwardRoutePlan {
            kind: PortForwardKind::Remote,
            forward_arg: format!("{}:{}", bind_host, request.source_port),
            bind_host: bind_host.clone(),
            target_host: None,
            target_port: None,
            local_bind_host: None,
            remote_bind_host: remote_endpoint
                .as_ref()
                .map(|endpoint| endpoint.host.clone()),
            local_endpoint: None,
            remote_endpoint,
            proxy_protocol: Some(proxy_protocol),
            remote_access_scope,
            proxy_url: Some(format!(
                "socks5h://{}:{}",
                format_proxy_host(&proxy_client_host(&bind_host)),
                request.source_port
            )),
        }),
    }
}

fn spawn_forward_process(plan: &ForwardCommandPlan) -> AppResult<ManagedForwardProcess> {
    if let Some(secret_input_plan) = plan.secret_input_plan.clone() {
        return spawn_forward_pty(&plan.executable, &plan.args, secret_input_plan);
    }

    let child = silent_command(&plan.executable)
        .args(&plan.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| AppError::PortForward(format!("无法启动 SSH 端口转发: {error}")))?;
    Ok(ManagedForwardProcess::Process(child))
}

fn spawn_forward_pty(
    executable: &str,
    args: &[String],
    secret_input_plan: TerminalSecretInputPlan,
) -> AppResult<ManagedForwardProcess> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::PortForward(error.to_string()))?;
    let mut command = CommandBuilder::new(executable);
    command.args(args.iter().map(String::as_str));
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::PortForward(error.to_string()))?;
    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| AppError::PortForward(error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| AppError::PortForward(error.to_string()))?;
    spawn_secret_response_thread(reader, writer, secret_input_plan);

    Ok(ManagedForwardProcess::Pty(PtyForwardProcess {
        child,
        _master: pair.master,
        pid,
    }))
}

fn spawn_secret_response_thread(
    mut reader: Box<dyn Read + Send>,
    mut writer: Box<dyn Write + Send>,
    secret_input_plan: TerminalSecretInputPlan,
) {
    thread::spawn(move || {
        let mut responder = ForwardSecretInputResponder::new(secret_input_plan);
        let mut buffer = String::new();
        let mut chunk = [0_u8; 1024];

        while let Ok(read) = reader.read(&mut chunk) {
            if read == 0 {
                break;
            }
            if !responder.can_respond() {
                continue;
            }

            buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
            if buffer.len() > 8192 {
                let keep_from = buffer.len().saturating_sub(4096);
                buffer = buffer[keep_from..].to_owned();
            }
            if let Some(response) = responder.response_for(&buffer) {
                let _ = writer.write_all(response.as_bytes());
                let _ = writer.write_all(b"\n");
                let _ = writer.flush();
                buffer.clear();
            }
        }
    });
}

struct ForwardSecretInputResponder {
    entries: Vec<ForwardSecretInputResponderEntry>,
}

struct ForwardSecretInputResponderEntry {
    prompt_markers: Vec<String>,
    response: String,
    max_responses: usize,
    responses_sent: usize,
}

impl ForwardSecretInputResponder {
    fn new(plan: TerminalSecretInputPlan) -> Self {
        Self {
            entries: plan
                .entries
                .into_iter()
                .filter_map(ForwardSecretInputResponderEntry::from_entry)
                .collect(),
        }
    }

    fn can_respond(&self) -> bool {
        self.entries
            .iter()
            .any(ForwardSecretInputResponderEntry::can_respond)
    }

    fn response_for(&mut self, buffer: &str) -> Option<String> {
        let lower = buffer.to_ascii_lowercase();
        let entry = self.entries.iter_mut().find(|entry| {
            entry.can_respond()
                && entry
                    .prompt_markers
                    .iter()
                    .any(|marker| lower.contains(marker))
        })?;
        entry.responses_sent = entry.responses_sent.saturating_add(1);
        Some(entry.response.clone())
    }
}

impl ForwardSecretInputResponderEntry {
    fn from_entry(entry: TerminalSecretInputEntry) -> Option<Self> {
        let prompt_markers = entry
            .prompt_markers
            .into_iter()
            .map(|marker| marker.to_ascii_lowercase())
            .filter(|marker| !marker.trim().is_empty())
            .collect::<Vec<_>>();
        if entry.response.is_empty() || entry.max_responses == 0 || prompt_markers.is_empty() {
            return None;
        }
        Some(Self {
            prompt_markers,
            response: entry.response,
            max_responses: entry.max_responses,
            responses_sent: 0,
        })
    }

    fn can_respond(&self) -> bool {
        self.responses_sent < self.max_responses
    }
}

fn listener_bind_host(
    preferred: Option<&str>,
    request: &PortForwardCreateRequest,
) -> AppResult<String> {
    validate_host_like(
        preferred
            .or(request.bind_host.as_deref())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("127.0.0.1"),
        "监听地址",
    )
}

fn request_bind_host(request: &PortForwardCreateRequest) -> String {
    request
        .local_bind_host
        .as_deref()
        .or(request.bind_host.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("127.0.0.1")
        .trim()
        .to_owned()
}

fn proxy_client_host(bind_host: &str) -> String {
    match bind_host.trim() {
        "" | "0.0.0.0" => "127.0.0.1".to_owned(),
        "::" => "::1".to_owned(),
        host => host.to_owned(),
    }
}

fn format_proxy_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}

fn endpoint(
    host: Option<String>,
    port: Option<u16>,
    label: &str,
) -> AppResult<Option<PortForwardEndpoint>> {
    let Some(host) = host else {
        return Ok(None);
    };
    Ok(Some(PortForwardEndpoint {
        host: validate_host_like(&host, label)?,
        port,
        label: Some(label.to_owned()),
    }))
}

fn required_endpoint_port(endpoint: &PortForwardEndpoint, label: &str) -> AppResult<u16> {
    match endpoint.port {
        Some(port) if port > 0 => Ok(port),
        _ => Err(AppError::InvalidInput(format!("{label}必须大于 0"))),
    }
}

fn required_target_host(request: &PortForwardCreateRequest) -> AppResult<String> {
    let target_host = request
        .target_host
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("目标主机不能为空".to_owned()))?;
    validate_host_like(target_host, "目标主机")
}

fn required_target_port(request: &PortForwardCreateRequest) -> AppResult<u16> {
    match request.target_port {
        Some(port) if port > 0 => Ok(port),
        _ => Err(AppError::InvalidInput("目标端口必须大于 0".to_owned())),
    }
}

fn validate_host_like(value: &str, label: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.contains('\0')
        || trimmed.contains('\r')
        || trimmed.contains('\n')
        || trimmed.split_whitespace().count() > 1
    {
        return Err(AppError::InvalidInput(format!("{label}不合法")));
    }
    Ok(trimmed.to_owned())
}

fn infer_remote_access_scope(bind_host: &str) -> PortForwardRemoteAccessScope {
    let trimmed = bind_host.trim();
    if matches!(trimmed, "127.0.0.1" | "localhost" | "::1") {
        return PortForwardRemoteAccessScope::Loopback;
    }
    if matches!(trimmed, "0.0.0.0" | "::") {
        return PortForwardRemoteAccessScope::AllInterfaces;
    }
    if trimmed
        .parse::<IpAddr>()
        .ok()
        .is_some_and(|ip| matches!(ip, IpAddr::V4(ip) if ip.is_private()))
    {
        return PortForwardRemoteAccessScope::PrivateNetwork;
    }
    PortForwardRemoteAccessScope::Custom
}

fn forward_flag(kind: PortForwardKind) -> &'static str {
    match kind {
        PortForwardKind::Local => "-L",
        PortForwardKind::Remote => "-R",
        PortForwardKind::Dynamic => "-D",
    }
}

fn normalized_name(request: &PortForwardCreateRequest, host: &RemoteHost) -> String {
    request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{} {}", host.name, forward_flag(request.kind)))
}

fn command_preview(executable: &str, args: &[String]) -> String {
    std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "-_./:=@".contains(ch))
    {
        return value.to_owned();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[cfg(test)]
#[path = "port_forward_service_tests.rs"]
mod port_forward_service_tests;
