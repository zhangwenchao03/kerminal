//! SSH 端口转发 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    models::port_forward::{
        PortForwardCreateRequest, PortForwardEndpoint, PortForwardProxyProtocol,
        PortForwardPurpose, PortForwardSummary,
    },
    services::local_network_proxy_service::LocalProxyEntryRequest,
    state::AppState,
};
use tauri::State;
use uuid::Uuid;

/// 创建 SSH 端口转发。
#[tauri::command]
pub fn port_forward_create(
    state: State<'_, AppState>,
    request: PortForwardCreateRequest,
) -> Result<PortForwardSummary, String> {
    let request =
        prepare_port_forward_request(&state, request).map_err(|error| error.to_string())?;
    let local_proxy_entry_id = request.local_proxy_entry_id.clone();
    state
        .port_forwards()
        .create_with_context(state.storage(), state.paths(), request)
        .inspect_err(|_| {
            if let Some(entry_id) = local_proxy_entry_id.as_deref() {
                let _ = state.local_network_proxy().release_entry(entry_id);
            }
        })
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

    let request = prepare_port_forward_request(&state, create_request_from_summary(&summary))
        .map_err(|error| error.to_string())?;
    let local_proxy_entry_id = request.local_proxy_entry_id.clone();
    state
        .port_forwards()
        .start_with_context(state.storage(), state.paths(), &forward_id, request)
        .inspect_err(|_| {
            if let Some(entry_id) = local_proxy_entry_id.as_deref() {
                let _ = state.local_network_proxy().release_entry(entry_id);
            }
        })
        .map_err(|error| error.to_string())
}

/// 停止 SSH 端口转发，保留已保存配置。
#[tauri::command]
pub fn port_forward_stop(state: State<'_, AppState>, forward_id: String) -> Result<bool, String> {
    let summary = state
        .port_forwards()
        .get(state.storage(), &forward_id)
        .map_err(|error| error.to_string())?;
    let closed = state
        .port_forwards()
        .stop(state.storage(), &forward_id)
        .map_err(|error| error.to_string())?;
    if closed {
        if let Some(entry_id) = summary.and_then(|summary| summary.local_proxy_entry_id) {
            let _ = state.local_network_proxy().release_entry(&entry_id);
        }
    }
    Ok(closed)
}

/// 删除 SSH 端口转发配置。
#[tauri::command]
pub fn port_forward_delete(state: State<'_, AppState>, forward_id: String) -> Result<bool, String> {
    let summary = state
        .port_forwards()
        .get(state.storage(), &forward_id)
        .map_err(|error| error.to_string())?;
    let deleted = state
        .port_forwards()
        .delete(state.storage(), &forward_id)
        .map_err(|error| error.to_string())?;
    if deleted {
        if let Some(entry_id) = summary.and_then(|summary| summary.local_proxy_entry_id) {
            let _ = state.local_network_proxy().release_entry(&entry_id);
        }
    }
    Ok(deleted)
}

fn prepare_port_forward_request(
    state: &AppState,
    mut request: PortForwardCreateRequest,
) -> AppResult<PortForwardCreateRequest> {
    let protocol = request
        .proxy_protocol
        .unwrap_or(PortForwardProxyProtocol::Http);
    if request.purpose != PortForwardPurpose::HostNetworkAssist
        || protocol != PortForwardProxyProtocol::Http
    {
        return Ok(request);
    }
    if request.local_proxy_entry_id.is_some() && request.local_endpoint.is_some() {
        return Ok(request);
    }

    let requested_local_endpoint = request.local_endpoint.clone();
    let local_bind_host = request.local_bind_host.clone().or_else(|| {
        requested_local_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone())
    });
    let local_port = requested_local_endpoint.and_then(|endpoint| endpoint.port);
    let entry = state
        .local_network_proxy()
        .acquire_entry(LocalProxyEntryRequest {
            bind_host: local_bind_host,
            host_id: request.host_id.clone(),
            port: local_port,
            session_id: format!("network-assist-{}", Uuid::new_v4()),
            tag: Some("network-assist/http".to_owned()),
        })?;

    request.local_bind_host = Some(entry.bind_host.clone());
    request.local_endpoint = Some(PortForwardEndpoint {
        host: entry.bind_host,
        label: Some("本机 HTTP CONNECT 代理".to_owned()),
        port: Some(entry.port),
    });
    request.shared_proxy_service_id = Some(entry.service_id);
    request.local_proxy_entry_id = Some(entry.entry_id);
    request.proxy_protocol = Some(PortForwardProxyProtocol::Http);
    Ok(request)
}

fn create_request_from_summary(summary: &PortForwardSummary) -> PortForwardCreateRequest {
    PortForwardCreateRequest {
        bind_host: Some(summary.bind_host.clone()),
        host_id: summary.host_id.clone(),
        kind: summary.kind,
        local_bind_host: summary.local_bind_host.clone(),
        local_endpoint: summary.local_endpoint.clone(),
        local_proxy_entry_id: summary.local_proxy_entry_id.clone(),
        name: Some(summary.name.clone()),
        origin: summary.origin,
        proxy_apply_scope: summary.proxy_apply_scope,
        proxy_protocol: summary.proxy_protocol,
        purpose: summary.purpose,
        remote_access_scope: summary.remote_access_scope,
        remote_bind_host: summary.remote_bind_host.clone(),
        remote_endpoint: summary.remote_endpoint.clone(),
        shared_proxy_service_id: summary.shared_proxy_service_id.clone(),
        source_port: summary.source_port,
        target_host: summary.target_host.clone(),
        target_port: summary.target_port,
    }
}
