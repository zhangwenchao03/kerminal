//! AI 上下文 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    models::{
        ai_agent::{AiChatRequest, AiChatResponse},
        ai_agent_run::{
            AiAgentHarnessRunRequest, AiAgentHarnessRunResult, AiAgentRunCancelRequest,
            AiAgentRunGetRequest, AiAgentRunResumeRequest, AiAgentRunRetryRequest,
            AiAgentRunSnapshot,
        },
        ai_context::AiTerminalContextRequest,
        ai_tool_invocation::{
            AiToolAuditClearResponse, AiToolAuditExport, AiToolAuditListRequest, AiToolAuditRecord,
            AiToolConfirmRequest, AiToolPendingContextUpdateRequest, AiToolPendingInvocation,
            AiToolPrepareRequest,
        },
    },
    services::{
        ai_agent_harness_rig_model::RigHarnessModel,
        ai_agent_run_service::AiAgentHarnessToolExecutor,
        ai_agent_service::{load_provider_api_key, select_provider, AiAgentChatContext},
        ai_tool_invocation_service::AiToolExecutionContext,
    },
    state::AppState,
};
use std::{future::Future, pin::Pin};
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
                terminal_session_bindings: state.terminal_session_bindings(),
                tools: state.tools(),
                mcp_tools: state.mcp_tools(),
                settings: state.settings(),
                paths: state.paths(),
            },
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 创建一个 AI Agent run。
#[tauri::command]
pub async fn ai_agent_run_start(
    state: State<'_, AppState>,
    request: AiAgentHarnessRunRequest,
) -> Result<AiAgentHarnessRunResult, String> {
    start_agent_run(state, request)
        .await
        .map_err(|error| error.to_string())
}

/// 获取 AI Agent run 快照。
#[tauri::command]
pub fn ai_agent_run_get(
    state: State<'_, AppState>,
    request: AiAgentRunGetRequest,
) -> Result<AiAgentRunSnapshot, String> {
    state
        .ai_agent_runs()
        .get_run(&request.run_id)
        .map_err(|error| error.to_string())
}

/// 取消 AI Agent run。
#[tauri::command]
pub fn ai_agent_run_cancel(
    state: State<'_, AppState>,
    request: AiAgentRunCancelRequest,
) -> Result<AiAgentRunSnapshot, String> {
    state
        .ai_agent_runs()
        .cancel(&request.run_id)
        .map_err(|error| error.to_string())
}

/// 在工具审批完成后恢复 AI Agent run。
#[tauri::command]
pub async fn ai_agent_run_resume(
    state: State<'_, AppState>,
    request: AiAgentRunResumeRequest,
) -> Result<AiAgentHarnessRunResult, String> {
    resume_agent_run(state, request)
        .await
        .map_err(|error| error.to_string())
}

/// 重试 AI Agent run 的最后一个可重试步骤。
#[tauri::command]
pub async fn ai_agent_run_retry_last_step(
    state: State<'_, AppState>,
    request: AiAgentRunRetryRequest,
) -> Result<AiAgentHarnessRunResult, String> {
    retry_agent_run(state, request)
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
                terminal_session_bindings: state.terminal_session_bindings(),
                command_history: state.command_history(),
                credentials: state.credentials(),
                settings: state.settings(),
                profiles: state.profiles(),
                remote_hosts: state.remote_hosts(),
                rig_providers: state.rig_providers(),
                server_info: state.server_info(),
                diagnostics: state.diagnostics(),
                sftp: state.sftp(),
                docker_hosts: state.docker_hosts(),
                port_forwards: state.port_forwards(),
                local_network_proxy: state.local_network_proxy(),
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

/// 返回当前可恢复的 AI 工具待确认调用。
#[tauri::command]
pub fn ai_tool_pending_list(
    state: State<'_, AppState>,
) -> Result<Vec<AiToolPendingInvocation>, String> {
    state
        .ai_tools()
        .list_pending(state.storage())
        .map_err(|error| error.to_string())
}

/// 更新 AI 工具待确认调用的会话归属信息。
#[tauri::command]
pub fn ai_tool_pending_update_context(
    state: State<'_, AppState>,
    request: AiToolPendingContextUpdateRequest,
) -> Result<AiToolPendingInvocation, String> {
    state
        .ai_tools()
        .update_pending_context(state.storage(), request)
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

async fn start_agent_run(
    state: State<'_, AppState>,
    request: AiAgentHarnessRunRequest,
) -> AppResult<AiAgentHarnessRunResult> {
    let provider = select_provider(state.storage(), None)?;
    let api_key = load_provider_api_key(state.credentials(), &provider)?;
    let model = RigHarnessModel::new(provider, api_key, state.tools().list_tools());
    let executor = StateToolExecutor { state: &state };
    state
        .ai_agent_runs()
        .run_harness(request, &model, &executor)
        .await
}

async fn resume_agent_run(
    state: State<'_, AppState>,
    request: AiAgentRunResumeRequest,
) -> AppResult<AiAgentHarnessRunResult> {
    let snapshot = state
        .ai_agent_runs()
        .resume_after_approval(&request.run_id, request.audit)?;
    if snapshot.run.status != crate::models::ai_agent_run::AiAgentRunStatus::Running {
        return Ok(AiAgentHarnessRunResult {
            snapshot,
            final_message: None,
            pending_invocation: None,
            last_observation: None,
        });
    }

    let provider = select_provider(state.storage(), None)?;
    let api_key = load_provider_api_key(state.credentials(), &provider)?;
    let model = RigHarnessModel::new(provider, api_key, state.tools().list_tools());
    let executor = StateToolExecutor { state: &state };
    state
        .ai_agent_runs()
        .continue_harness(&request.run_id, &model, &executor)
        .await
}

async fn retry_agent_run(
    state: State<'_, AppState>,
    request: AiAgentRunRetryRequest,
) -> AppResult<AiAgentHarnessRunResult> {
    let snapshot = state.ai_agent_runs().retry_last_step(&request.run_id)?;
    let provider = select_provider(state.storage(), None)?;
    let api_key = load_provider_api_key(state.credentials(), &provider)?;
    let model = RigHarnessModel::new(provider, api_key, state.tools().list_tools());
    let executor = StateToolExecutor { state: &state };
    state
        .ai_agent_runs()
        .continue_harness(&snapshot.run.id, &model, &executor)
        .await
}

struct StateToolExecutor<'a> {
    state: &'a AppState,
}

impl AiAgentHarnessToolExecutor for StateToolExecutor<'_> {
    fn execute_tool<'a>(
        &'a self,
        request: crate::models::ai_tool_invocation::AiToolExecuteIfAllowedRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = AppResult<
                        crate::models::ai_tool_invocation::AiToolExecuteIfAllowedResponse,
                    >,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            self.state
                .ai_tools()
                .execute_if_allowed(execution_context(self.state), self.state.tools(), request)
                .await
        })
    }
}

fn execution_context(state: &AppState) -> AiToolExecutionContext<'_> {
    AiToolExecutionContext {
        terminals: state.terminals(),
        terminal_session_bindings: state.terminal_session_bindings(),
        command_history: state.command_history(),
        credentials: state.credentials(),
        settings: state.settings(),
        profiles: state.profiles(),
        remote_hosts: state.remote_hosts(),
        rig_providers: state.rig_providers(),
        server_info: state.server_info(),
        diagnostics: state.diagnostics(),
        sftp: state.sftp(),
        docker_hosts: state.docker_hosts(),
        port_forwards: state.port_forwards(),
        local_network_proxy: state.local_network_proxy(),
        snippets: state.snippets(),
        workflows: state.workflows(),
        ssh_commands: state.ssh_commands(),
        paths: state.paths(),
        storage: state.storage(),
    }
}
