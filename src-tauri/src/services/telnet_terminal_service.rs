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
    services::terminal_manager::TerminalManager,
    storage::SqliteStore,
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
        storage: &SqliteStore,
        terminals: &TerminalManager,
        request: TelnetTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let terminal_request = self.resolve_terminal_request(storage, request)?;
        terminals.create_session(terminal_request, output)
    }

    /// 将 Telnet 主机配置解析为本地 telnet 客户端命令。
    pub fn resolve_terminal_request(
        &self,
        storage: &SqliteStore,
        request: TelnetTerminalCreateRequest,
    ) -> AppResult<TerminalCreateRequest> {
        validate_terminal_size(request.rows, request.cols)?;
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        ensure_telnet_host(&host)?;
        let telnet = resolve_telnet_executable()?;

        build_telnet_terminal_request(&host, telnet, request.rows, request.cols)
    }
}

fn build_telnet_terminal_request(
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
        secret_input_response: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::remote_host::{RemoteHostAuthType, SshOptions};

    fn remote_host(tags: Vec<String>) -> RemoteHost {
        RemoteHost {
            id: "host-1".to_owned(),
            group_id: Some("group-1".to_owned()),
            name: "legacy".to_owned(),
            host: "legacy.internal".to_owned(),
            port: 2323,
            username: String::new(),
            auth_type: RemoteHostAuthType::Agent,
            credential_ref: None,
            tags,
            production: false,
            ssh_options: SshOptions::default(),
            sort_order: 10,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        }
    }

    #[test]
    fn build_telnet_terminal_request_uses_parameterized_args() {
        let request = build_telnet_terminal_request(
            &remote_host(vec![" TELNET ".to_owned()]),
            "telnet".to_owned(),
            24,
            80,
        )
        .expect("build request");

        assert_eq!(request.shell.as_deref(), Some("telnet"));
        assert_eq!(request.args, vec!["legacy.internal", "2323"]);
        assert_eq!(request.cwd, None);
        assert_eq!(request.rows, 24);
        assert_eq!(request.cols, 80);
        assert!(request.env.is_empty());
        assert!(request.cleanup_paths.is_empty());
        assert!(request.secret_input_response.is_none());
    }

    #[test]
    fn build_telnet_terminal_request_rejects_non_telnet_tag() {
        let error = build_telnet_terminal_request(
            &remote_host(vec!["ssh".to_owned()]),
            "telnet".to_owned(),
            24,
            80,
        )
        .expect_err("reject non telnet host");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn build_telnet_terminal_request_rejects_zero_size() {
        let error = build_telnet_terminal_request(
            &remote_host(vec!["telnet".to_owned()]),
            "telnet".to_owned(),
            0,
            80,
        )
        .expect_err("reject zero rows");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
