//! Tool Registry Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::{
        ai_tool_invocation::AiToolAuditListRequest,
        settings::{CustomMcpServerSetting, CustomMcpServerToolSetting},
        tool_registry::{
            McpGatewayManifest, McpHttpServerStartRequest, McpHttpServerStatus,
            McpPromptRenderRequest, McpPromptRenderResult, McpResourceReadRequest,
            McpResourceReadResult, McpToolList, ToolDefinition,
        },
    },
    services::{
        mcp_discovery_service::discover_mcp_server_tools,
        mcp_tool_gateway::{
            McpPromptRenderRuntime, McpResourceReadRuntime, AI_AUDIT_SUMMARY_RESOURCE_URI,
            AI_POLICY_RESOURCE_URI, APPLICATION_CONTEXT_RESOURCE_URI,
            TERMINAL_CONTEXT_RESOURCE_URI,
        },
    },
    state::AppState,
};
use tauri::{AppHandle, State};

/// 返回 Kerminal 内部工具目录。
#[tauri::command]
pub fn tool_registry_list(state: State<'_, AppState>) -> Result<Vec<ToolDefinition>, String> {
    Ok(state.tools().list_tools())
}

/// 返回 rmcp/MCP-compatible 工具列表。
#[tauri::command]
pub fn tool_registry_mcp_list(state: State<'_, AppState>) -> Result<McpToolList, String> {
    let tools = state.tools().list_tools();
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(|error| error.to_string())?;
    Ok(state
        .mcp_tools()
        .list_tools_with_custom(&tools, &settings.ai.mcp))
}

/// 返回 Kerminal 本地 MCP 清单。
#[tauri::command]
pub fn tool_registry_mcp_manifest(
    state: State<'_, AppState>,
) -> Result<McpGatewayManifest, String> {
    let tools = state.tools().list_tools();
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(|error| error.to_string())?;
    Ok(state.mcp_tools().manifest(&tools, &settings.ai.mcp))
}

/// 读取 Kerminal 本地 MCP resource 内容。
#[tauri::command]
pub fn tool_registry_mcp_resource_read(
    state: State<'_, AppState>,
    request: McpResourceReadRequest,
) -> Result<McpResourceReadResult, String> {
    let tools = state.tools().list_tools();
    let runtime = build_resource_runtime(&state, &request)?;
    state
        .mcp_tools()
        .read_resource(&tools, request, runtime)
        .map_err(|error| error.to_string())
}

/// 渲染 Kerminal 本地 MCP prompt 内容。
#[tauri::command]
pub fn tool_registry_mcp_prompt_render(
    state: State<'_, AppState>,
    request: McpPromptRenderRequest,
) -> Result<McpPromptRenderResult, String> {
    let runtime = build_prompt_runtime(&state, &request)?;
    state
        .mcp_tools()
        .render_prompt(request, runtime)
        .map_err(|error| error.to_string())
}

/// 对单个自定义 MCP Server 执行 tools/list discovery。
#[tauri::command]
pub async fn tool_registry_mcp_server_discover_tools(
    server: CustomMcpServerSetting,
) -> Result<Vec<CustomMcpServerToolSetting>, String> {
    discover_mcp_server_tools(server)
        .await
        .map_err(|error| error.to_string())
}

/// 启动本地标准 Streamable HTTP MCP Server。
#[tauri::command]
pub async fn tool_registry_mcp_http_start(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Option<McpHttpServerStartRequest>,
) -> Result<McpHttpServerStatus, String> {
    state
        .mcp_http_server()
        .start(app, request)
        .await
        .map_err(|error| error.to_string())
}

/// 停止本地标准 Streamable HTTP MCP Server。
#[tauri::command]
pub fn tool_registry_mcp_http_stop(
    state: State<'_, AppState>,
) -> Result<McpHttpServerStatus, String> {
    state
        .mcp_http_server()
        .stop()
        .map_err(|error| error.to_string())
}

/// 返回本地标准 Streamable HTTP MCP Server 状态。
#[tauri::command]
pub fn tool_registry_mcp_http_status(
    state: State<'_, AppState>,
) -> Result<McpHttpServerStatus, String> {
    state
        .mcp_http_server()
        .status()
        .map_err(|error| error.to_string())
}

fn build_resource_runtime(
    state: &State<'_, AppState>,
    request: &McpResourceReadRequest,
) -> Result<McpResourceReadRuntime, String> {
    let uri = request.uri.trim();
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(|error| error.to_string())?;
    let mut runtime = McpResourceReadRuntime {
        custom_mcp: settings.ai.mcp.clone(),
        ..Default::default()
    };

    if uri == APPLICATION_CONTEXT_RESOURCE_URI {
        runtime.application_context = request.application_context.clone();
    }

    if uri == TERMINAL_CONTEXT_RESOURCE_URI {
        runtime.terminal_context = match request.terminal_context.clone() {
            Some(context_request) => match state
                .ai_context()
                .terminal_context_snapshot(state.terminals(), context_request)
            {
                Ok(snapshot) => Some(snapshot),
                Err(error) => {
                    runtime.terminal_context_error = Some(error.to_string());
                    None
                }
            },
            None => {
                runtime.terminal_context_error =
                    Some("当前没有活动终端 session，无法生成终端上下文。".to_owned());
                None
            }
        };
    }

    if uri == AI_AUDIT_SUMMARY_RESOURCE_URI {
        runtime.audit_records = state
            .ai_tools()
            .list_audits_with_request(
                state.storage(),
                Some(AiToolAuditListRequest {
                    limit: request.audit_limit,
                }),
            )
            .map_err(|error| error.to_string())?;
    }

    if uri == AI_POLICY_RESOURCE_URI {
        runtime.ai_policy = Some(settings.ai);
    }

    Ok(runtime)
}

fn build_prompt_runtime(
    state: &State<'_, AppState>,
    request: &McpPromptRenderRequest,
) -> Result<McpPromptRenderRuntime, String> {
    let settings = state
        .settings()
        .load_settings(state.storage())
        .map_err(|error| error.to_string())?;
    let mut runtime = McpPromptRenderRuntime {
        application_context: request.application_context.clone(),
        custom_mcp: settings.ai.mcp,
        ..Default::default()
    };
    runtime.terminal_context = match request.terminal_context.clone() {
        Some(context_request) => match state
            .ai_context()
            .terminal_context_snapshot(state.terminals(), context_request)
        {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                runtime.terminal_context_error = Some(error.to_string());
                None
            }
        },
        None => {
            runtime.terminal_context_error =
                Some("当前没有活动终端 session，无法生成终端上下文。".to_owned());
            None
        }
    };

    Ok(runtime)
}
