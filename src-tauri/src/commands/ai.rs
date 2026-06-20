//! AI 上下文 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::{
        ai_agent::{AiChatRequest, AiChatResponse},
        ai_context::AiTerminalContextRequest,
        ai_tool_invocation::{
            AiToolAuditClearResponse, AiToolAuditExport, AiToolAuditListRequest, AiToolAuditRecord,
            AiToolConfirmRequest, AiToolPendingInvocation, AiToolPrepareRequest,
        },
    },
    services::{
        ai_agent_service::AiAgentChatContext, ai_tool_invocation_service::AiToolExecutionContext,
    },
    state::AppState,
};
use tauri::State;

/// 发送一次 Kerminal Agent 对话请求。
#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    request: AiChatRequest,
) -> Result<AiChatResponse, String> {
    state
        .ai_agent()
        .chat(
            AiAgentChatContext {
                storage: state.storage(),
                credentials: state.credentials(),
                ai_context: state.ai_context(),
                ai_tools: state.ai_tools(),
                terminals: state.terminals(),
                tools: state.tools(),
                mcp_tools: state.mcp_tools(),
                settings: state.settings(),
            },
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 获取当前终端上下文快照，供 AI 面板和 Kerminal Agent 复用。
#[tauri::command]
pub fn ai_terminal_context_snapshot(
    state: State<'_, AppState>,
    request: AiTerminalContextRequest,
) -> Result<crate::models::ai_context::AiTerminalContextSnapshot, String> {
    state
        .ai_context()
        .terminal_context_snapshot(state.terminals(), request)
        .map_err(|error| error.to_string())
}

/// 准备一次 AI 工具调用，返回待确认记录。
#[tauri::command]
pub fn ai_tool_prepare(
    state: State<'_, AppState>,
    request: AiToolPrepareRequest,
) -> Result<AiToolPendingInvocation, String> {
    state
        .ai_tools()
        .prepare_with_settings(state.tools(), state.settings(), state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 确认并执行一次 AI 工具调用。
#[tauri::command]
pub async fn ai_tool_confirm(
    state: State<'_, AppState>,
    request: AiToolConfirmRequest,
) -> Result<AiToolAuditRecord, String> {
    state
        .ai_tools()
        .confirm_async(
            AiToolExecutionContext {
                terminals: state.terminals(),
                command_history: state.command_history(),
                credentials: state.credentials(),
                settings: state.settings(),
                profiles: state.profiles(),
                remote_hosts: state.remote_hosts(),
                rig_providers: state.rig_providers(),
                server_info: state.server_info(),
                diagnostics: state.diagnostics(),
                sftp: state.sftp(),
                port_forwards: state.port_forwards(),
                snippets: state.snippets(),
                workflows: state.workflows(),
                ssh_commands: state.ssh_commands(),
                paths: state.paths(),
                storage: state.storage(),
            },
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 返回最近 AI 工具调用审计记录。
#[tauri::command]
pub fn ai_tool_audit_list(
    state: State<'_, AppState>,
    request: Option<AiToolAuditListRequest>,
) -> Result<Vec<AiToolAuditRecord>, String> {
    state
        .ai_tools()
        .list_audits_with_request(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 导出最近 AI 工具调用审计记录。
#[tauri::command]
pub fn ai_tool_audit_export(
    state: State<'_, AppState>,
    request: Option<AiToolAuditListRequest>,
) -> Result<AiToolAuditExport, String> {
    state
        .ai_tools()
        .export_audits(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 清空 AI 工具调用审计记录。
#[tauri::command]
pub fn ai_tool_audit_clear(state: State<'_, AppState>) -> Result<AiToolAuditClearResponse, String> {
    state
        .ai_tools()
        .clear_audits(state.storage())
        .map_err(|error| error.to_string())
}
