//! 外部 Agent / MCP 终端上下文服务。
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    error::{AppError, AppResult},
    models::{
        agent_context::{
            AgentContextPolicySnapshot, AgentTerminalContextRequest, AgentTerminalContextSnapshot,
            AgentTerminalContextSource,
        },
        terminal::TerminalOutputSnapshot,
    },
    security::redaction::redact_terminal_text,
    services::terminal_manager::TerminalManager,
};

const DEFAULT_CONTEXT_OUTPUT_BYTES: usize = 12 * 1024;
const MIN_CONTEXT_OUTPUT_BYTES: usize = 512;
const MAX_CONTEXT_OUTPUT_BYTES: usize = 24 * 1024;

/// 把终端运行态转换为外部 Agent 可通过 MCP 消费的安全上下文。
#[derive(Debug, Default)]
pub struct AgentContextService;

impl AgentContextService {
    /// 创建上下文服务。
    pub fn new() -> Self {
        Self
    }

    /// 生成当前终端上下文快照。
    pub fn terminal_context_snapshot(
        &self,
        terminals: &TerminalManager,
        request: AgentTerminalContextRequest,
    ) -> AppResult<AgentTerminalContextSnapshot> {
        let session_id = request.session_id.trim();
        if session_id.is_empty() {
            return Err(AppError::InvalidInput(
                "当前 pane 尚未绑定终端 session".to_owned(),
            ));
        }

        let max_output_bytes = normalize_output_limit(request.max_output_bytes);
        let (session, output) = terminals.output_snapshot(session_id, max_output_bytes)?;
        let (output, redacted) = redact_output_snapshot(output);

        Ok(AgentTerminalContextSnapshot {
            generated_at: current_unix_timestamp(),
            session,
            source: AgentTerminalContextSource {
                pane_id: request.pane_id,
                pane_title: request.pane_title,
                tab_id: request.tab_id,
                tab_title: request.tab_title,
                machine_id: request.machine_id,
                machine_name: request.machine_name,
                machine_kind: request.machine_kind,
            },
            output,
            redacted,
            policy: AgentContextPolicySnapshot {
                mode: "currentTerminal".to_owned(),
                includes_recent_output: true,
                includes_full_history: false,
                secret_redaction: true,
                max_output_bytes,
            },
        })
    }
}

fn normalize_output_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_CONTEXT_OUTPUT_BYTES)
        .clamp(MIN_CONTEXT_OUTPUT_BYTES, MAX_CONTEXT_OUTPUT_BYTES)
}

fn redact_output_snapshot(mut output: TerminalOutputSnapshot) -> (TerminalOutputSnapshot, bool) {
    let (data, redacted) = redact_terminal_text(&output.data);
    output.captured_bytes = data.len();
    output.data = data;
    (output, redacted)
}

fn current_unix_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}
