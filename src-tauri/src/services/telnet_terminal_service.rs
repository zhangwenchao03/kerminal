//! Telnet 远程终端会话服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::RemoteHost,
        terminal::{
            TelnetTerminalCreateRequest, TerminalCreateRequest, TerminalOutputEvent,
            TerminalSessionSummary,
        },
    },
    services::{remote_host_service::RemoteHostService, terminal_manager::TerminalManager},
};

/// Telnet 远程终端业务入口。
#[derive(Debug, Default)]
pub struct TelnetTerminalService;

impl TelnetTerminalService {
    /// 创建 Telnet 远程终端服务。
    pub fn new() -> Self {
        Self
    }

    /// 创建 Telnet 远程终端会话。
    pub fn create_session<F>(
        &self,
        remote_hosts: &RemoteHostService,
        terminals: &TerminalManager,
        request: TelnetTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let terminal_request = self.resolve_terminal_request(remote_hosts, request)?;
        terminals.create_session(terminal_request, output)
    }

    /// 将 Telnet 主机配置解析为本地 telnet 客户端命令。
    pub fn resolve_terminal_request(
        &self,
        remote_hosts: &RemoteHostService,
        request: TelnetTerminalCreateRequest,
    ) -> AppResult<TerminalCreateRequest> {
        validate_terminal_size(request.rows, request.cols)?;
        let host = remote_hosts.require_host(&request.host_id)?;
        ensure_telnet_host(&host)?;
        let telnet = resolve_telnet_executable()?;

        build_telnet_terminal_request(&host, telnet, request.rows, request.cols)
    }
}

#[doc(hidden)]
pub mod rules {
    pub use super::build_telnet_terminal_request;
}

pub fn build_telnet_terminal_request(
    host: &RemoteHost,
    telnet_executable: String,
    rows: u16,
    cols: u16,
) -> AppResult<TerminalCreateRequest> {
    validate_terminal_size(rows, cols)?;
    ensure_telnet_host(host)?;

    Ok(TerminalCreateRequest {
        shell: Some(telnet_executable),
        args: vec![host.host.clone(), host.port.to_string()],
        cwd: None,
        cols,
        rows,
        env: Default::default(),
        cleanup_paths: Vec::new(),
    })
}

fn validate_terminal_size(rows: u16, cols: u16) -> AppResult<()> {
    if rows == 0 || cols == 0 {
        return Err(AppError::InvalidInput(
            "终端行数和列数必须大于 0".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_telnet_host(host: &RemoteHost) -> AppResult<()> {
    if !has_telnet_tag(&host.tags) {
        return Err(AppError::InvalidInput(
            "Telnet 终端只支持带 telnet 标签的远程主机".to_owned(),
        ));
    }
    Ok(())
}

fn has_telnet_tag(tags: &[String]) -> bool {
    tags.iter()
        .any(|tag| tag.trim().eq_ignore_ascii_case("telnet"))
}

fn resolve_telnet_executable() -> AppResult<String> {
    which::which("telnet")
        .or_else(|_| which::which("telnet.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::Terminal(
                "未找到 Telnet 客户端，请安装 telnet 或确认 telnet 已加入 PATH".to_owned(),
            )
        })
}
