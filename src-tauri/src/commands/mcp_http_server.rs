//! MCP HTTP Server Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::{McpHttpServerStartRequest, McpHttpServerStatus},
    state::AppState,
};
use tauri::{AppHandle, State};

/// 启动本地标准 Streamable HTTP MCP Server。
#[tauri::command]
pub async fn mcp_http_server_start(
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
pub fn mcp_http_server_stop(state: State<'_, AppState>) -> Result<McpHttpServerStatus, String> {
    state
        .mcp_http_server()
        .stop()
        .map_err(|error| error.to_string())
}

/// 返回本地标准 Streamable HTTP MCP Server 状态。
#[tauri::command]
pub fn mcp_http_server_status(state: State<'_, AppState>) -> Result<McpHttpServerStatus, String> {
    state
        .mcp_http_server()
        .status()
        .map_err(|error| error.to_string())
}
