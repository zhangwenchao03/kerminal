//! tmux server/session/window/pane 管理服务。
//!
//! @author kongweiguang

mod parser;

use std::{
    path::Path,
    process::Output,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    error::{AppError, AppResult},
    models::{
        ssh_command::SshCommandRequest,
        target::RemoteTargetRef,
        terminal::TerminalCreateRequest,
        tmux::{
            TmuxAttachLaunch, TmuxAttachSessionRequest, TmuxCapabilityStatus,
            TmuxCapturePaneRequest, TmuxCreateSessionRequest, TmuxKillSessionRequest,
            TmuxListPanesRequest, TmuxListSessionsRequest, TmuxListWindowsRequest, TmuxPaneBinding,
            TmuxPaneCapture, TmuxPaneSummary, TmuxProbeRequest, TmuxRenameSessionRequest,
            TmuxSessionSummary, TmuxTargetRef, TmuxWindowSummary,
        },
    },
    paths::KerminalPaths,
    security::redaction::redact_terminal_text,
    services::{process_command::silent_command, ssh_command_service::SshCommandService},
};

const DEFAULT_TMUX_PROGRAM: &str = "tmux";
const MAX_CAPTURE_LINES: u16 = 1_000;
const DEFAULT_CAPTURE_LINES: u16 = 200;
const DEFAULT_TIMEOUT_SECONDS: u64 = 12;
const DEFAULT_OUTPUT_BYTES: usize = 512 * 1024;

// Keep formats compatible with tmux 2.7; older tmux leaves `#{q:...}` fields empty.
pub const SESSION_FORMAT: &str = "#{session_id}\u{1f}#{session_name}\u{1f}#{session_attached}\u{1f}#{session_attached}\u{1f}#{session_created}\u{1f}#{session_activity}\u{1f}#{session_path}\u{1f}#{session_windows}";
const WINDOW_FORMAT: &str = "#{window_id}\u{1f}#{session_id}\u{1f}#{window_index}\u{1f}#{window_name}\u{1f}#{window_active}\u{1f}#{window_panes}\u{1f}#{window_layout}\u{1f}#{window_flags}";
const PANE_FORMAT: &str = "#{pane_id}\u{1f}#{window_id}\u{1f}#{pane_index}\u{1f}#{pane_active}\u{1f}#{pane_current_path}\u{1f}#{pane_current_command}\u{1f}#{pane_title}\u{1f}#{pane_width}\u{1f}#{pane_height}\u{1f}#{pane_dead}";

/// tmux 管理业务入口。
#[derive(Debug, Default)]
pub struct TmuxService;

impl TmuxService {
    /// 创建 tmux 管理服务。
    pub fn new() -> Self {
        Self
    }

    /// 探测目标侧 tmux 是否可用。
    pub async fn probe(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxProbeRequest,
    ) -> AppResult<TmuxCapabilityStatus> {
        validate_target(&request.target)?;
        let target_ref = stable_tmux_target_ref(&request.target);
        let base = || TmuxCapabilityStatus {
            available: false,
            reason: None,
            socket_name: request.target.socket_name.clone(),
            socket_path: request.target.socket_path.clone(),
            target: request.target.target.clone(),
            target_ref: target_ref.clone(),
            version: None,
        };

        let output = match self
            .run_tmux(paths, ssh_commands, &request.target, &owned_args(&["-V"]))
            .await
        {
            Ok(output) => output,
            Err(error) => {
                let mut status = base();
                status.reason = Some(error.to_string());
                return Ok(status);
            }
        };

        if !output.success {
            let mut status = base();
            status.reason = Some(command_failure_reason(&output));
            return Ok(status);
        }

        let version = output.stdout.trim();
        let mut status = base();
        status.available = true;
        status.version = (!version.is_empty()).then(|| version.to_owned());
        Ok(status)
    }

    /// 列出 tmux sessions。
    pub async fn list_sessions(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxListSessionsRequest,
    ) -> AppResult<Vec<TmuxSessionSummary>> {
        validate_target(&request.target)?;
        let output = self
            .run_tmux(
                paths,
                ssh_commands,
                &request.target,
                &owned_args(&["list-sessions", "-F", SESSION_FORMAT]),
            )
            .await?;
        if !output.success {
            if is_no_server_output(&output) {
                return Ok(Vec::new());
            }
            return Err(command_failure(&output));
        }
        parser::parse_sessions(&output.stdout, &stable_tmux_target_ref(&request.target))
    }

    /// 创建 detached tmux session 并返回最新摘要。
    pub async fn create_session(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxCreateSessionRequest,
    ) -> AppResult<TmuxSessionSummary> {
        validate_target(&request.target)?;
        let name = validate_name("tmux session 名称", &request.name)?;
        let mut args = owned_args(&["new-session", "-d", "-s"]);
        args.push(name.clone());
        let cwd = validate_optional_text("tmux session 初始目录", request.cwd.as_deref())?;
        if let Some(cwd) = cwd.as_deref() {
            args.extend(["-c".to_owned(), cwd.to_owned()]);
        }
        let output = self
            .run_tmux(paths, ssh_commands, &request.target, &args)
            .await?;
        if !output.success {
            return Err(command_failure(&output));
        }

        let sessions = self
            .list_sessions(
                paths,
                ssh_commands,
                TmuxListSessionsRequest {
                    target: request.target,
                },
            )
            .await?;
        sessions
            .into_iter()
            .find(|session| session.name == name)
            .ok_or_else(|| AppError::NotFound(format!("tmux session 创建后未找到: {name}")))
    }

    /// 重命名 tmux session。
    pub async fn rename_session(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxRenameSessionRequest,
    ) -> AppResult<TmuxSessionSummary> {
        validate_target(&request.target)?;
        let session_id = validate_name("tmux session id", &request.session_id)?;
        let name = validate_name("tmux session 新名称", &request.name)?;
        let output = self
            .run_tmux(
                paths,
                ssh_commands,
                &request.target,
                &[
                    "rename-session".to_owned(),
                    "-t".to_owned(),
                    session_id.clone(),
                    name.clone(),
                ],
            )
            .await?;
        if !output.success {
            return Err(command_failure(&output));
        }
        let sessions = self
            .list_sessions(
                paths,
                ssh_commands,
                TmuxListSessionsRequest {
                    target: request.target,
                },
            )
            .await?;
        sessions
            .into_iter()
            .find(|session| session.name == name)
            .ok_or_else(|| AppError::NotFound(format!("tmux session 重命名后未找到: {name}")))
    }

    /// 删除 tmux session。
    pub async fn kill_session(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxKillSessionRequest,
    ) -> AppResult<bool> {
        validate_target(&request.target)?;
        let session_id = validate_name("tmux session id", &request.session_id)?;
        let output = self
            .run_tmux(
                paths,
                ssh_commands,
                &request.target,
                &["kill-session".to_owned(), "-t".to_owned(), session_id],
            )
            .await?;
        if output.success {
            return Ok(true);
        }
        if is_not_found_output(&output) || is_no_server_output(&output) {
            return Ok(false);
        }
        Err(command_failure(&output))
    }

    /// 列出 tmux windows。
    pub async fn list_windows(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxListWindowsRequest,
    ) -> AppResult<Vec<TmuxWindowSummary>> {
        validate_target(&request.target)?;
        let session_id = validate_name("tmux session id", &request.session_id)?;
        let output = self
            .run_tmux(
                paths,
                ssh_commands,
                &request.target,
                &[
                    "list-windows".to_owned(),
                    "-t".to_owned(),
                    session_id,
                    "-F".to_owned(),
                    WINDOW_FORMAT.to_owned(),
                ],
            )
            .await?;
        if !output.success {
            return Err(command_failure(&output));
        }
        parser::parse_windows(&output.stdout)
    }

    /// 列出 tmux panes。
    pub async fn list_panes(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxListPanesRequest,
    ) -> AppResult<Vec<TmuxPaneSummary>> {
        validate_target(&request.target)?;
        let target_id = validate_name("tmux pane/window/session target", &request.target_id)?;
        let output = self
            .run_tmux(
                paths,
                ssh_commands,
                &request.target,
                &[
                    "list-panes".to_owned(),
                    "-t".to_owned(),
                    target_id,
                    "-F".to_owned(),
                    PANE_FORMAT.to_owned(),
                ],
            )
            .await?;
        if !output.success {
            return Err(command_failure(&output));
        }
        parser::parse_panes(&output.stdout)
    }

    /// 捕获 tmux pane 最近输出。
    pub async fn capture_pane(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: TmuxCapturePaneRequest,
    ) -> AppResult<TmuxPaneCapture> {
        validate_target(&request.target)?;
        let pane_id = validate_name("tmux pane id", &request.pane_id)?;
        let lines = request
            .lines
            .unwrap_or(DEFAULT_CAPTURE_LINES)
            .clamp(1, MAX_CAPTURE_LINES);
        let start = format!("-{lines}");
        let output = self
            .run_tmux(
                paths,
                ssh_commands,
                &request.target,
                &[
                    "capture-pane".to_owned(),
                    "-p".to_owned(),
                    "-t".to_owned(),
                    pane_id.as_str().to_owned(),
                    "-S".to_owned(),
                    start,
                ],
            )
            .await?;
        if !output.success {
            return Err(command_failure(&output));
        }
        let (text, _) = redact_terminal_text(&output.stdout);
        Ok(TmuxPaneCapture {
            pane_id,
            truncated: text.lines().count() >= usize::from(lines),
            text,
            lines,
        })
    }

    /// 构造 tmux attach 终端启动规格。
    pub fn attach_launch(&self, request: TmuxAttachSessionRequest) -> AppResult<TmuxAttachLaunch> {
        validate_target(&request.target)?;
        let session_id = validate_name("tmux session id", &request.session_id)?;
        let session_name = request
            .session_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(session_id.as_str())
            .to_owned();
        let title = format!("tmux: {session_name}");
        let binding = TmuxPaneBinding {
            attached_at: unix_timestamp_string(),
            session_id: session_id.clone(),
            session_name,
            socket_name: request.target.socket_name.clone(),
            socket_path: request.target.socket_path.clone(),
            target_ref: stable_tmux_target_ref(&request.target),
        };

        match &request.target.target {
            RemoteTargetRef::Local { .. } => {
                let mut args = socket_args(&request.target)?;
                args.extend(["attach-session".to_owned(), "-t".to_owned(), session_id]);
                Ok(TmuxAttachLaunch::Local {
                    binding,
                    terminal: TerminalCreateRequest {
                        args,
                        cleanup_paths: Vec::new(),
                        cols: 80,
                        cwd: request.cwd,
                        env: Default::default(),
                        rows: 24,
                        shell: Some(tmux_program(&request.target).to_owned()),
                    },
                    title,
                })
            }
            RemoteTargetRef::Ssh { host_id } => {
                let mut args = socket_args(&request.target)?;
                args.extend(["attach-session".to_owned(), "-t".to_owned(), session_id]);
                Ok(TmuxAttachLaunch::Ssh {
                    binding,
                    cwd: request.cwd,
                    host_id: host_id.clone(),
                    remote_command: build_remote_command(tmux_program(&request.target), &args),
                    title,
                })
            }
            RemoteTargetRef::DockerContainer { .. } => Err(AppError::InvalidInput(
                "tmux 容器目标 attach 将在 Docker executor 评估切片中实现".to_owned(),
            )),
            RemoteTargetRef::Telnet { .. } | RemoteTargetRef::Serial { .. } => Err(
                AppError::InvalidInput("当前目标没有可靠非交互命令通道，暂不支持 tmux".to_owned()),
            ),
        }
    }

    async fn run_tmux(
        &self,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        target: &TmuxTargetRef,
        command_args: &[String],
    ) -> AppResult<TmuxCommandOutput> {
        let args = command_args_with_socket_owned(target, command_args)?;
        match &target.target {
            RemoteTargetRef::Local { .. } => run_local_tmux(tmux_program(target), &args),
            RemoteTargetRef::Ssh { host_id } => {
                run_ssh_tmux(paths, ssh_commands, target, host_id, &args).await
            }
            RemoteTargetRef::DockerContainer { .. } => Err(AppError::InvalidInput(
                "tmux 容器目标将在 Docker executor 评估切片中实现".to_owned(),
            )),
            RemoteTargetRef::Telnet { .. } | RemoteTargetRef::Serial { .. } => Err(
                AppError::InvalidInput("当前目标没有可靠非交互命令通道，暂不支持 tmux".to_owned()),
            ),
        }
    }
}

#[doc(hidden)]
pub mod rules {
    pub use super::parser::{parse_panes, parse_sessions, parse_windows, FIELD_SEPARATOR};
    pub use super::{
        build_remote_command, command_args_with_socket, stable_tmux_target_ref, validate_target,
        SESSION_FORMAT,
    };
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TmuxCommandOutput {
    exit_code: Option<i32>,
    stderr: String,
    stdout: String,
    success: bool,
}

async fn run_ssh_tmux(
    paths: &KerminalPaths,
    ssh_commands: &SshCommandService,
    target: &TmuxTargetRef,
    host_id: &str,
    args: &[String],
) -> AppResult<TmuxCommandOutput> {
    let command = build_remote_command(tmux_program(target), args);
    let output = ssh_commands
        .execute_native(
            paths,
            SshCommandRequest {
                command,
                host_id: host_id.to_owned(),
                max_output_bytes: Some(DEFAULT_OUTPUT_BYTES),
                timeout_seconds: Some(DEFAULT_TIMEOUT_SECONDS),
            },
        )
        .await?;
    Ok(TmuxCommandOutput {
        exit_code: output.exit_code,
        stderr: output.stderr,
        stdout: output.stdout,
        success: output.success,
    })
}

fn run_local_tmux(program: &str, args: &[String]) -> AppResult<TmuxCommandOutput> {
    let output = silent_command(program)
        .args(args)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::Terminal(format!(
                    "未找到 tmux 可执行文件 `{program}`，请安装 tmux 或确认已加入 PATH"
                ))
            } else {
                AppError::Terminal(format!("tmux 启动失败: {error}"))
            }
        })?;
    Ok(output.into())
}

impl From<Output> for TmuxCommandOutput {
    fn from(output: Output) -> Self {
        Self {
            exit_code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            success: output.status.success(),
        }
    }
}

pub fn validate_target(target: &TmuxTargetRef) -> AppResult<()> {
    target.target.validate()?;
    validate_optional_text("tmux socket name", target.socket_name.as_deref())?;
    validate_optional_text("tmux socket path", target.socket_path.as_deref())?;
    validate_optional_text("tmux path", target.tmux_path.as_deref())?;
    if target
        .socket_name
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        && target
            .socket_path
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(AppError::InvalidInput(
            "tmux socket name 和 socket path 不能同时设置".to_owned(),
        ));
    }
    Ok(())
}

pub fn stable_tmux_target_ref(target: &TmuxTargetRef) -> String {
    let mut value = target.target.stable_id();
    if let Some(socket_name) = target
        .socket_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        value.push_str("|L:");
        value.push_str(socket_name);
    }
    if let Some(socket_path) = target
        .socket_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        value.push_str("|S:");
        value.push_str(socket_path);
    }
    value
}

pub fn command_args_with_socket(
    target: &TmuxTargetRef,
    command_args: &[&str],
) -> AppResult<Vec<String>> {
    command_args_with_socket_owned(target, &owned_args(command_args))
}

fn command_args_with_socket_owned(
    target: &TmuxTargetRef,
    command_args: &[String],
) -> AppResult<Vec<String>> {
    let mut args = socket_args(target)?;
    args.extend(command_args.iter().cloned());
    Ok(args)
}

fn owned_args(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| (*arg).to_owned()).collect()
}

fn socket_args(target: &TmuxTargetRef) -> AppResult<Vec<String>> {
    validate_target(target)?;
    let mut args = Vec::new();
    if let Some(socket_name) =
        validate_optional_text("tmux socket name", target.socket_name.as_deref())?
    {
        args.extend(["-L".to_owned(), socket_name]);
    }
    if let Some(socket_path) =
        validate_optional_text("tmux socket path", target.socket_path.as_deref())?
    {
        args.extend(["-S".to_owned(), socket_path]);
    }
    Ok(args)
}

fn tmux_program(target: &TmuxTargetRef) -> &str {
    target
        .tmux_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TMUX_PROGRAM)
}

pub fn build_remote_command(program: &str, args: &[String]) -> String {
    let mut parts = vec![shell_quote(program)];
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    parts.join(" ")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn validate_name(label: &str, value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} 不能为空")));
    }
    if value.len() > 128 {
        return Err(AppError::InvalidInput(format!("{label} 不能超过 128 字节")));
    }
    if value.chars().any(|ch| ch.is_control()) {
        return Err(AppError::InvalidInput(format!("{label} 不能包含控制字符")));
    }
    Ok(value.to_owned())
}

fn validate_optional_text(label: &str, value: Option<&str>) -> AppResult<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 512 {
        return Err(AppError::InvalidInput(format!("{label} 不能超过 512 字节")));
    }
    if value.chars().any(|ch| ch == '\0' || ch == '\r') {
        return Err(AppError::InvalidInput(format!(
            "{label} 不能包含非法控制字符"
        )));
    }
    Ok(Some(value.to_owned()))
}

fn command_failure(output: &TmuxCommandOutput) -> AppError {
    AppError::Terminal(command_failure_reason(output))
}

fn command_failure_reason(output: &TmuxCommandOutput) -> String {
    let message = first_non_empty_line(&output.stderr)
        .or_else(|| first_non_empty_line(&output.stdout))
        .unwrap_or("tmux 命令执行失败");
    format!(
        "{message}{}",
        output
            .exit_code
            .map(|code| format!(" (exit {code})"))
            .unwrap_or_default()
    )
}

fn first_non_empty_line(value: &str) -> Option<&str> {
    value.lines().map(str::trim).find(|line| !line.is_empty())
}

fn is_no_server_output(output: &TmuxCommandOutput) -> bool {
    let text = format!("{}\n{}", output.stderr, output.stdout).to_lowercase();
    text.contains("no server running") || text.contains("no sessions")
}

fn is_not_found_output(output: &TmuxCommandOutput) -> bool {
    let text = format!("{}\n{}", output.stderr, output.stdout).to_lowercase();
    text.contains("can't find") || text.contains("not found") || text.contains("no such")
}

fn unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[allow(dead_code)]
fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
