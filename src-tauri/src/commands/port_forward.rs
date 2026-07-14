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
        .create_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            request,
        )
        .map_err(|error| error.to_string())
}

/// 列出 SSH 端口转发。
#[tauri::command]
pub fn port_forward_list(state: State<'_, AppState>) -> Result<Vec<PortForwardSummary>, String> {
    state
        .port_forwards()
        .list(state.storage())
        .map_err(|error| error.to_string())
}

/// 关闭 SSH 端口转发。
#[tauri::command]
pub fn port_forward_close(state: State<'_, AppState>, forward_id: String) -> Result<bool, String> {
    port_forward_stop(state, forward_id)
}

/// 从已保存配置启动 SSH 端口转发。
#[tauri::command]
pub fn port_forward_start(
    state: State<'_, AppState>,
    forward_id: String,
) -> Result<PortForwardSummary, String> {
    let summary = state
        .port_forwards()
        .get(state.storage(), &forward_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("端口转发不存在: {forward_id}"))?;
    if summary.status == crate::models::port_forward::PortForwardStatus::Running {
        return Ok(summary);
    }

    let request = create_request_from_summary(&summary);
    state
        .port_forwards()
        .start_with_context(
            state.storage(),
            state.remote_hosts(),
            state.paths(),
            &forward_id,
            request,
        )
        .map_err(|error| error.to_string())
}

/// 停止 SSH 端口转发，保留已保存配置。
#[tauri::command]
pub fn port_forward_stop(state: State<'_, AppState>, forward_id: String) -> Result<bool, String> {
    state
        .port_forwards()
        .stop(state.storage(), &forward_id)
        .map_err(|error| error.to_string())
}

/// 删除 SSH 端口转发配置。
#[tauri::command]
pub fn port_forward_delete(state: State<'_, AppState>, forward_id: String) -> Result<bool, String> {
    state
        .port_forwards()
        .delete(state.storage(), &forward_id)
        .map_err(|error| error.to_string())
}

fn create_request_from_summary(summary: &PortForwardSummary) -> PortForwardCreateRequest {
    PortForwardCreateRequest {
        bind_host: Some(summary.bind_host.clone()),
        host_id: summary.host_id.clone(),
        kind: summary.kind,
        local_bind_host: summary.local_bind_host.clone(),
        local_endpoint: summary.local_endpoint.clone(),
        name: Some(summary.name.clone()),
        origin: summary.origin,
        proxy_apply_scope: summary.proxy_apply_scope,
        proxy_protocol: summary.proxy_protocol,
        remote_access_scope: summary.remote_access_scope,
        remote_bind_host: summary.remote_bind_host.clone(),
        remote_endpoint: summary.remote_endpoint.clone(),
        source_port: summary.source_port,
        target_host: summary.target_host.clone(),
        target_port: summary.target_port,
    }
}
