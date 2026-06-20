//! SSH 端口转发 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::port_forward::{PortForwardCreateRequest, PortForwardSummary},
    state::AppState,
};
use tauri::State;

/// 创建 SSH 端口转发。
#[tauri::command]
pub fn port_forward_create(
    state: State<'_, AppState>,
    request: PortForwardCreateRequest,
) -> Result<PortForwardSummary, String> {
    state
        .port_forwards()
        .create(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 列出 SSH 端口转发。
#[tauri::command]
pub fn port_forward_list(state: State<'_, AppState>) -> Result<Vec<PortForwardSummary>, String> {
    state
        .port_forwards()
        .list()
        .map_err(|error| error.to_string())
}

/// 关闭 SSH 端口转发。
#[tauri::command]
pub fn port_forward_close(state: State<'_, AppState>, forward_id: String) -> Result<bool, String> {
    state
        .port_forwards()
        .close(&forward_id)
        .map_err(|error| error.to_string())
}
