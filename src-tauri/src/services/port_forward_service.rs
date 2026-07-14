//! SSH 端口转发服务。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
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
            PortForwardCreateRequest, PortForwardKind, PortForwardProxyProtocol,
            PortForwardRuntimeDiagnostics, PortForwardRuntimeMode, PortForwardStatus,
            PortForwardSummary,
        },
        terminal::TerminalSecretInputPlan,
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        external_launch::ExternalSessionMaterializer,
        process_command::silent_command,
        remote_host_service::RemoteHostService,
        ssh_command_plan::{cleanup_paths, resolve_openssh_executable},
        ssh_credential_resolver::{
            NativeSshRouteMaterial, ResolvedSshRouteAuth, SshCredentialResolver,
        },
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshAuthPromptPlan},
            facade::{SshRuntimeFacade, SshRuntimeTargetContext},
            policy::{
                external_target_not_available_error, is_capability_unsupported,
                is_external_runtime_target_id, is_managed_runtime_unwired,
                runtime_host_key_policy_for_host_id, SshRuntimeCapability,
            },
            session_key::ssh_session_key_for_route,
            ManagedSshForwardTunnel, ManagedSshSessionManager, SshRuntimeConnectRequest,
            SshRuntimeDynamicForwardRequest, SshRuntimeLocalForwardRequest,
            SshRuntimeRemoteDynamicForwardRequest, SshRuntimeRemoteForwardRequest,
        },
    },
    storage::RuntimeFileStore,
};

use self::{
    plan::{build_forward_plan, build_managed_forward_plan, ForwardCommandPlan},
    secret_input::ForwardSecretInputResponder,
};

pub mod plan;
mod secret_input;

type PtyChildHandle = Box<dyn PtyChild + Send + Sync>;
type PtyMasterHandle = Box<dyn MasterPty + Send>;
const LEGACY_FALLBACK_PORT_FORWARD_OPENSSH: &str = "managed-port-forward-openssh-fallback";

/// SSH 端口转发业务入口。
#[derive(Debug, Default)]
pub struct PortForwardService {
    auth_broker: Option<SshAuthBroker>,
    external_targets: Option<ExternalSessionMaterializer>,
    managed_runtime: Option<ManagedSshSessionManager>,
    sessions: Mutex<HashMap<String, PortForwardSession>>,
}

#[derive(Debug)]
struct PortForwardSession {
    process: ManagedForwardProcess,
    cleanup_paths: Vec<PathBuf>,
    summary: PortForwardSummary,
}

enum ManagedForwardProcess {
    Managed(Box<Option<ManagedSshForwardTunnel>>),
    Process(Box<Child>),
    Pty(Box<PtyForwardProcess>),
}

struct PtyForwardProcess {
    child: PtyChildHandle,
    _master: PtyMasterHandle,
    pid: Option<u32>,
}

impl std::fmt::Debug for ManagedForwardProcess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Managed(tunnel) => formatter
                .debug_struct("Managed")
                .field(
                    "id",
                    &tunnel.as_ref().as_ref().and_then(|tunnel| tunnel.id()),
                )
                .finish(),
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
            Self::Managed(_tunnel) => None,
            Self::Process(child) => Some(child.id()),
            Self::Pty(process) => process.pid,
        }
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self {
            Self::Managed(tunnel) => {
                let Some(tunnel) = tunnel.as_mut() else {
                    return Ok(Some("受管 SSH 端口转发已退出".to_owned()));
                };
                match tunnel.try_wait()? {
                    Some(status) => {
                        *self = Self::Managed(Box::new(None));
                        Ok(Some(status))
                    }
                    None => Ok(None),
                }
            }
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
            Self::Managed(tunnel) => {
                if let Some(tunnel) = tunnel.as_mut() {
                    tunnel.kill()?;
                }
                Ok(())
            }
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
            Self::Managed(tunnel) => {
                if let Some(mut tunnel) = tunnel.take() {
                    tunnel.wait();
                }
            }
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

    /// 创建可识别外部 SSH 启动临时 target 的端口转发服务。
    pub fn with_external_targets(external_targets: ExternalSessionMaterializer) -> Self {
        Self {
            auth_broker: None,
            external_targets: Some(external_targets),
            managed_runtime: None,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 创建接入受管 SSH 运行时的端口转发服务。
    pub fn with_ssh_runtime(
        managed_runtime: ManagedSshSessionManager,
        auth_broker: SshAuthBroker,
        external_targets: ExternalSessionMaterializer,
    ) -> Self {
        Self {
            auth_broker: Some(auth_broker),
            external_targets: Some(external_targets),
            managed_runtime: Some(managed_runtime),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 创建 SSH 端口转发。
    ///
    /// 该入口保留给不需要内联私钥临时文件的调用方。
    pub fn create(
        &self,
        storage: &RuntimeFileStore,
        remote_hosts: &RemoteHostService,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        self.create_inner(storage, remote_hosts, None, request, None, None)
    }

    /// 创建可使用 SSH 主机明文密码和内联私钥临时文件的端口转发。
    pub fn create_with_context(
        &self,
        storage: &RuntimeFileStore,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        self.create_inner(storage, remote_hosts, Some(paths), request, None, None)
    }

    /// 从已保存配置重新启动端口转发，保留原会话 id 与创建时间。
    pub fn start_with_context(
        &self,
        storage: &RuntimeFileStore,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        forward_id: &str,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        let persisted = storage
            .port_forward_summary_by_id(forward_id)?
            .ok_or_else(|| AppError::NotFound(format!("端口转发不存在: {forward_id}")))?;
        self.create_inner(
            storage,
            remote_hosts,
            Some(paths),
            request,
            Some(forward_id.to_owned()),
            Some(persisted.created_at),
        )
    }

    #[doc(hidden)]
    pub fn build_plan_with_context(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        executable: String,
        request: &PortForwardCreateRequest,
    ) -> AppResult<ForwardCommandPlan> {
        let host = self.resolve_host(remote_hosts, &request.host_id)?;
        build_forward_plan(&host, executable, Some(paths), request)
    }

    /// 列出当前端口转发。
    pub fn list(&self, storage: &RuntimeFileStore) -> AppResult<Vec<PortForwardSummary>> {
        let (runtime_summaries, exited_updates) = {
            let mut sessions = self.sessions()?;
            let mut exited_updates = Vec::new();
            for session in sessions.values_mut() {
                if session.summary.status != PortForwardStatus::Running {
                    continue;
                }
                if let Some(status) = session.process.try_wait()? {
                    let last_error = format!("SSH 端口转发进程已退出，退出码: {status}");
                    session.summary.status = PortForwardStatus::Exited;
                    session.summary.last_error = Some(last_error.clone());
                    mark_summary_runtime_cleanup(
                        &mut session.summary,
                        "cleanedUp",
                        Some(last_error),
                    );
                    session.summary.pid = None;
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
        storage: &RuntimeFileStore,
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
    pub fn stop(&self, storage: &RuntimeFileStore, forward_id: &str) -> AppResult<bool> {
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

    /// 删除端口转发配置；如果正在运行会先停止子进程。
    pub fn delete(&self, storage: &RuntimeFileStore, forward_id: &str) -> AppResult<bool> {
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
        storage: &RuntimeFileStore,
        remote_hosts: &RemoteHostService,
        paths: Option<&KerminalPaths>,
        request: PortForwardCreateRequest,
        summary_id: Option<String>,
        created_at: Option<String>,
    ) -> AppResult<PortForwardSummary> {
        if let Some(forward_id) = summary_id.as_deref() {
            self.remove_stopped_session_or_reject_running(forward_id)?;
        }
        let (host, route_auth) =
            self.resolve_runtime_host(remote_hosts, paths, &request.host_id)?;
        let managed_plan = build_managed_forward_plan(&request)?;
        let (mut process, plan, fallback_reason) = match self.start_managed_forward(
            paths,
            &host,
            route_auth.as_ref(),
            &managed_plan,
            &request,
        )? {
            Some(process) => (process, managed_plan, None),
            None => {
                self.record_managed_forward_legacy_fallback(&host, &request);
                let executable = resolve_openssh_executable()?;
                let plan = build_forward_plan(&host, executable, paths, &request)?;
                let process = match spawn_forward_process(&plan) {
                    Ok(process) => process,
                    Err(error) => {
                        cleanup_paths(&plan.cleanup_paths);
                        return Err(error);
                    }
                };
                (
                    process,
                    plan,
                    Some(
                        "managed SSH forward runtime unavailable or unsupported; using OpenSSH fallback"
                            .to_owned(),
                    ),
                )
            }
        };
        let pid = process.id();
        let mut summary = plan.to_summary(
            &host,
            &request,
            pid,
            summary_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            created_at.unwrap_or_else(unix_timestamp),
        );
        summary.runtime = Some(runtime_diagnostics_for_process(
            &process,
            &request,
            fallback_reason,
        ));

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

    fn record_managed_forward_legacy_fallback(
        &self,
        host: &crate::models::remote_host::RemoteHost,
        request: &PortForwardCreateRequest,
    ) {
        let Some(managed_runtime) = self.managed_runtime.as_ref() else {
            return;
        };
        managed_runtime.record_legacy_fallback(
            format!(
                "port-forward.{}",
                tunnel_kind_for_kind(request.kind, request.proxy_protocol)
            ),
            LEGACY_FALLBACK_PORT_FORWARD_OPENSSH,
            Some(format!("{}@{}:{}", host.username, host.host, host.port)),
        );
    }

    fn resolve_host(
        &self,
        remote_hosts: &RemoteHostService,
        host_id: &str,
    ) -> AppResult<crate::models::remote_host::RemoteHost> {
        if let Some(external_targets) = &self.external_targets {
            if let Some(target) = external_targets.resolve_target(host_id)? {
                return Ok(target.host);
            }
        }
        if is_external_runtime_target_id(host_id) {
            return Err(external_target_not_available_error(host_id));
        }
        remote_hosts.require_host(host_id)
    }

    fn resolve_runtime_host(
        &self,
        remote_hosts: &RemoteHostService,
        paths: Option<&KerminalPaths>,
        host_id: &str,
    ) -> AppResult<(
        crate::models::remote_host::RemoteHost,
        Option<ResolvedSshRouteAuth>,
    )> {
        if let Some(external_targets) = &self.external_targets {
            if let Some(target) = external_targets.resolve_target(host_id)? {
                return Ok((target.host, Some(target.route_auth)));
            }
        }
        if is_external_runtime_target_id(host_id) {
            return Err(external_target_not_available_error(host_id));
        }

        let host = remote_hosts.require_host(host_id)?;
        let Some(paths) = paths else {
            return Ok((host, None));
        };
        let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
        let resolved_auth = resolver.resolve_host(&host)?;
        let resolved_auth = match &self.auth_broker {
            Some(auth_broker) => match auth_broker.resolve_route_auth(&resolved_auth)? {
                SshAuthBrokerResolution::Ready { auth } => auth,
                SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                    return Err(prompt_required_forward_error(prompt_plan));
                }
            },
            None => resolved_auth,
        };
        let runtime_host =
            SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved_auth);
        Ok((runtime_host, Some(resolved_auth)))
    }

    fn start_managed_forward(
        &self,
        paths: Option<&KerminalPaths>,
        host: &crate::models::remote_host::RemoteHost,
        route_auth: Option<&ResolvedSshRouteAuth>,
        plan: &ForwardCommandPlan,
        request: &PortForwardCreateRequest,
    ) -> AppResult<Option<ManagedForwardProcess>> {
        if !is_managed_forward_candidate(request) {
            return Ok(None);
        }
        let (Some(paths), Some(route_auth), Some(managed_runtime)) =
            (paths, route_auth, self.managed_runtime.as_ref())
        else {
            return Ok(None);
        };

        let known_hosts_path = paths.root.join("known_hosts");
        let key = ssh_session_key_for_route(host, route_auth, &known_hosts_path)?;
        let connect_request = SshRuntimeConnectRequest::native(
            key,
            host.clone(),
            known_hosts_path,
            u64::from(host.ssh_options.terminal.connect_timeout_seconds).clamp(1, 300),
        )
        .with_host_key_policy(runtime_host_key_policy_for_host_id(&host.id))
        .with_native_route_material(NativeSshRouteMaterial::from_resolved_auth(route_auth)?);
        let facade = SshRuntimeFacade::new(managed_runtime.clone());
        let context = SshRuntimeTargetContext::new(connect_request);
        let tunnel = match request.kind {
            PortForwardKind::Local => {
                let Some(target_host) = plan.target_host.clone() else {
                    return Ok(None);
                };
                let Some(target_port) = plan.target_port else {
                    return Ok(None);
                };
                facade.start_local_forward(
                    &context,
                    SshRuntimeLocalForwardRequest::new(
                        plan.bind_host.clone(),
                        request.source_port,
                        target_host,
                        target_port,
                    ),
                )
            }
            PortForwardKind::Remote => match (plan.target_host.clone(), plan.target_port) {
                (Some(target_host), Some(target_port)) => facade.start_remote_forward(
                    &context,
                    SshRuntimeRemoteForwardRequest::new(
                        plan.bind_host.clone(),
                        request.source_port,
                        target_host,
                        target_port,
                    ),
                ),
                (None, None) if is_remote_dynamic_forward_request(request) => facade
                    .start_remote_dynamic_forward(
                        &context,
                        SshRuntimeRemoteDynamicForwardRequest::new(
                            plan.bind_host.clone(),
                            request.source_port,
                        ),
                    ),
                _ => return Ok(None),
            },
            PortForwardKind::RemoteDynamic => facade.start_remote_dynamic_forward(
                &context,
                SshRuntimeRemoteDynamicForwardRequest::new(
                    plan.bind_host.clone(),
                    request.source_port,
                ),
            ),
            PortForwardKind::Dynamic => facade.start_dynamic_forward(
                &context,
                SshRuntimeDynamicForwardRequest::new(plan.bind_host.clone(), request.source_port),
            ),
        };
        match tunnel {
            Ok(tunnel) => Ok(Some(ManagedForwardProcess::Managed(Box::new(Some(tunnel))))),
            Err(error)
                if is_managed_runtime_unwired(&error)
                    || is_capability_unsupported(&error, SshRuntimeCapability::Forward) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
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
    normalize_legacy_summary(&mut summary);
    if summary.status != PortForwardStatus::Running {
        return summary;
    }

    summary.last_error = Some(
        summary
            .last_error
            .unwrap_or_else(|| "应用重启后隧道不会自动重连。".to_owned()),
    );
    let mut summary = stopped_summary(summary, None);
    mark_summary_runtime_restored(&mut summary);
    summary
}

fn stopped_summary(
    mut summary: PortForwardSummary,
    last_error: Option<String>,
) -> PortForwardSummary {
    if let Some(last_error) = last_error {
        summary.last_error = Some(last_error.clone());
        mark_summary_runtime_cleanup(&mut summary, "stopped", Some(last_error));
    } else {
        mark_summary_runtime_cleanup(&mut summary, "stopped", None);
    }
    summary.status = PortForwardStatus::Exited;
    summary.pid = None;
    summary
}

fn normalize_legacy_summary(summary: &mut PortForwardSummary) {
    if summary.kind == PortForwardKind::Remote
        && summary.proxy_protocol == Some(PortForwardProxyProtocol::Socks5)
        && summary.target_host.is_none()
        && summary.target_port.is_none()
    {
        summary.kind = PortForwardKind::RemoteDynamic;
    }
}

fn runtime_diagnostics_for_process(
    process: &ManagedForwardProcess,
    request: &PortForwardCreateRequest,
    fallback_reason: Option<String>,
) -> PortForwardRuntimeDiagnostics {
    match process {
        ManagedForwardProcess::Managed(tunnel) => {
            let mut diagnostics = PortForwardRuntimeDiagnostics {
                backend: "native-russh".to_owned(),
                cleanup_status: "active".to_owned(),
                mode: PortForwardRuntimeMode::ManagedSshRuntime,
                tunnel_kind: tunnel_kind_for_request(request),
                ..Default::default()
            };
            if let Some(tunnel) = tunnel.as_ref().as_ref() {
                diagnostics.managed_session_id = Some(tunnel.session_id().to_owned());
                diagnostics.managed_channel_kind = Some(tunnel.kind().as_str().to_owned());
                diagnostics.managed_tunnel_id = tunnel.id();
            }
            diagnostics
        }
        ManagedForwardProcess::Process(_) => PortForwardRuntimeDiagnostics {
            backend: "openssh".to_owned(),
            cleanup_status: "active".to_owned(),
            fallback_reason,
            mode: PortForwardRuntimeMode::OpenSshProcess,
            tunnel_kind: tunnel_kind_for_request(request),
            ..Default::default()
        },
        ManagedForwardProcess::Pty(_) => PortForwardRuntimeDiagnostics {
            backend: "openssh".to_owned(),
            cleanup_status: "active".to_owned(),
            fallback_reason,
            mode: PortForwardRuntimeMode::OpenSshPty,
            tunnel_kind: tunnel_kind_for_request(request),
            ..Default::default()
        },
    }
}

fn mark_summary_runtime_cleanup(
    summary: &mut PortForwardSummary,
    cleanup_status: &str,
    recent_failure: Option<String>,
) {
    if let Some(runtime) = &mut summary.runtime {
        runtime.cleanup_status = cleanup_status.to_owned();
        if let Some(recent_failure) = recent_failure {
            runtime.recent_failure = Some(recent_failure);
        }
    }
}

fn mark_summary_runtime_restored(summary: &mut PortForwardSummary) {
    let recent_failure = summary.last_error.clone();
    if let Some(runtime) = &mut summary.runtime {
        runtime.cleanup_status = "restoredAfterAppRestart".to_owned();
        runtime.mode = PortForwardRuntimeMode::Restored;
        runtime.recent_failure = recent_failure;
        return;
    }

    summary.runtime = Some(PortForwardRuntimeDiagnostics {
        backend: "restored".to_owned(),
        cleanup_status: "restoredAfterAppRestart".to_owned(),
        mode: PortForwardRuntimeMode::Restored,
        recent_failure,
        tunnel_kind: tunnel_kind_for_summary(summary),
        ..Default::default()
    });
}

fn tunnel_kind_for_request(request: &PortForwardCreateRequest) -> String {
    tunnel_kind_for_kind(request.kind, request.proxy_protocol)
}

fn tunnel_kind_for_summary(summary: &PortForwardSummary) -> String {
    tunnel_kind_for_kind(summary.kind, summary.proxy_protocol)
}

fn tunnel_kind_for_kind(
    kind: PortForwardKind,
    proxy_protocol: Option<PortForwardProxyProtocol>,
) -> String {
    if proxy_protocol == Some(PortForwardProxyProtocol::Http) {
        return "legacyHttp".to_owned();
    }
    match kind {
        PortForwardKind::Local => "local",
        PortForwardKind::Remote if proxy_protocol == Some(PortForwardProxyProtocol::Socks5) => {
            "remoteDynamic"
        }
        PortForwardKind::Remote => "remote",
        PortForwardKind::RemoteDynamic => "remoteDynamic",
        PortForwardKind::Dynamic => "dynamic",
    }
    .to_owned()
}

fn is_managed_forward_candidate(request: &PortForwardCreateRequest) -> bool {
    request.proxy_protocol != Some(PortForwardProxyProtocol::Http)
}

fn is_remote_dynamic_forward_request(request: &PortForwardCreateRequest) -> bool {
    matches!(
        request.kind,
        PortForwardKind::Remote | PortForwardKind::RemoteDynamic
    ) && request.proxy_protocol == Some(PortForwardProxyProtocol::Socks5)
}

fn prompt_required_forward_error(prompt_plan: SshAuthPromptPlan) -> AppError {
    let prompts = prompt_plan
        .prompts
        .iter()
        .map(|prompt| {
            format!(
                "{}@{}:{} {}",
                prompt.username,
                prompt.host,
                prompt.port,
                prompt.secret_kind.as_str()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    AppError::Credential(format!(
        "SSH authentication is required before starting port forwarding: {prompts}"
    ))
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
    Ok(ManagedForwardProcess::Process(Box::new(child)))
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
    spawn_secret_input_thread(reader, writer, secret_input_plan);

    Ok(ManagedForwardProcess::Pty(Box::new(PtyForwardProcess {
        child,
        _master: pair.master,
        pid,
    })))
}

fn spawn_secret_input_thread(
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

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
