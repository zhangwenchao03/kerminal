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
        port_forward::{PortForwardCreateRequest, PortForwardStatus, PortForwardSummary},
        terminal::{TerminalSecretInputEntry, TerminalSecretInputPlan},
    },
    paths::KerminalPaths,
    services::{
        process_command::silent_command,
        remote_host_service::RemoteHostService,
        ssh_command_plan::{cleanup_paths, resolve_openssh_executable},
    },
    storage::RuntimeFileStore,
};

use self::plan::{build_forward_plan, ForwardCommandPlan};

pub mod plan;

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

    /// 兼容旧调用方：close 等价于 stop，保留已保存配置。
    pub fn close(&self, storage: &RuntimeFileStore, forward_id: &str) -> AppResult<bool> {
        self.stop(storage, forward_id)
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
        let host = remote_hosts.require_host(&request.host_id)?;
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
    spawn_secret_input_thread(reader, writer, secret_input_plan);

    Ok(ManagedForwardProcess::Pty(PtyForwardProcess {
        child,
        _master: pair.master,
        pid,
    }))
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

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
