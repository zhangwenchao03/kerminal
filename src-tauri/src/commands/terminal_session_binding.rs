//! Terminal pane/session binding Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    services::terminal_manager::{TerminalManager, TerminalTargetTokenClaims},
    services::terminal_session_binding_service::{
        TerminalSessionBindingCapabilityUse, TerminalSessionBindingEvent,
        TerminalSessionBindingMetadata, TerminalSessionBindingService,
        TerminalSessionBindingSnapshot,
    },
    state::AppState,
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionBindingPayload {
    pub pane_id: String,
    pub session_id: String,
    pub target_token: Option<String>,
    pub metadata: Option<TerminalSessionBindingMetadata>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn terminal_session_binding_register(
    state: State<'_, AppState>,
    pane_id: String,
    session_id: String,
    target_token: Option<String>,
    metadata: Option<TerminalSessionBindingMetadata>,
) -> Result<TerminalSessionBindingSnapshot, String> {
    let authoritative_target_ref =
        resolve_authoritative_target_ref(state.terminals(), &session_id)?;
    let target_token_claims =
        verify_authoritative_target_token(state.terminals(), &session_id, target_token.as_deref())?;
    register_binding(
        state.terminal_session_bindings(),
        TerminalSessionBindingPayload {
            pane_id,
            session_id,
            target_token,
            metadata,
        },
        authoritative_target_ref,
        target_token_claims,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn terminal_session_binding_ready(
    state: State<'_, AppState>,
    pane_id: String,
    session_id: String,
) -> Result<Option<TerminalSessionBindingSnapshot>, String> {
    ready_binding(
        state.terminal_session_bindings(),
        TerminalSessionBindingPayload {
            pane_id,
            session_id,
            target_token: None,
            metadata: None,
        },
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn terminal_session_binding_disconnected(
    state: State<'_, AppState>,
    pane_id: String,
    session_id: String,
) -> Result<Option<TerminalSessionBindingSnapshot>, String> {
    disconnect_binding(
        state.terminal_session_bindings(),
        TerminalSessionBindingPayload {
            pane_id,
            session_id,
            target_token: None,
            metadata: None,
        },
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn terminal_session_binding_closed(
    state: State<'_, AppState>,
    pane_id: String,
    session_id: String,
) -> Result<bool, String> {
    close_binding(
        state.terminal_session_bindings(),
        TerminalSessionBindingPayload {
            pane_id,
            session_id,
            target_token: None,
            metadata: None,
        },
    )
}

#[tauri::command]
pub fn terminal_session_binding_events(
    state: State<'_, AppState>,
) -> Result<Vec<TerminalSessionBindingEvent>, String> {
    binding_events(state.terminal_session_bindings())
}

fn register_binding(
    service: &TerminalSessionBindingService,
    payload: TerminalSessionBindingPayload,
    authoritative_target_ref: Option<String>,
    target_token_claims: Option<TerminalTargetTokenClaims>,
) -> Result<TerminalSessionBindingSnapshot, String> {
    let metadata =
        metadata_with_authoritative_target_ref(payload.metadata, authoritative_target_ref);
    service
        .register_with_metadata_and_capability(
            payload.pane_id,
            payload.session_id,
            metadata,
            target_token_claims.map(|claims| TerminalSessionBindingCapabilityUse {
                jti: claims.jti,
                expires_at_ms: claims.expires_at_ms,
            }),
        )
        .map_err(|error| error.to_string())
}

fn resolve_authoritative_target_ref(
    terminals: &TerminalManager,
    session_id: &str,
) -> Result<Option<String>, String> {
    terminals
        .session_summary(session_id)
        .map(|summary| summary.target_ref)
        .map_err(|error| error.to_string())
}

fn verify_authoritative_target_token(
    terminals: &TerminalManager,
    session_id: &str,
    target_token: Option<&str>,
) -> Result<Option<TerminalTargetTokenClaims>, String> {
    let summary = terminals
        .session_summary(session_id)
        .map_err(|error| error.to_string())?;
    let Some(expected_token) = summary.target_token.as_deref() else {
        return Ok(None);
    };
    let Some(target_token) = target_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(format!(
            "终端 session 缺少 target capability token: {session_id}"
        ));
    };
    let Some(claims) = terminals
        .verify_target_token(session_id, target_token)
        .map_err(|error| error.to_string())?
    else {
        return Err(format!(
            "终端 session target capability token 无效: {session_id}"
        ));
    };
    if expected_token == target_token {
        Ok(Some(claims))
    } else {
        Err(format!(
            "终端 session target capability token 无效: {session_id}"
        ))
    }
}

fn metadata_with_authoritative_target_ref(
    metadata: Option<TerminalSessionBindingMetadata>,
    authoritative_target_ref: Option<String>,
) -> Option<TerminalSessionBindingMetadata> {
    TerminalSessionBindingMetadata::with_authoritative_target_ref(
        metadata,
        authoritative_target_ref,
    )
}

fn ready_binding(
    service: &TerminalSessionBindingService,
    payload: TerminalSessionBindingPayload,
) -> Result<Option<TerminalSessionBindingSnapshot>, String> {
    service
        .ready(&payload.pane_id, &payload.session_id)
        .map_err(|error| error.to_string())
}

fn disconnect_binding(
    service: &TerminalSessionBindingService,
    payload: TerminalSessionBindingPayload,
) -> Result<Option<TerminalSessionBindingSnapshot>, String> {
    service
        .disconnected(&payload.pane_id, &payload.session_id)
        .map_err(|error| error.to_string())
}

fn close_binding(
    service: &TerminalSessionBindingService,
    payload: TerminalSessionBindingPayload,
) -> Result<bool, String> {
    service
        .closed(&payload.pane_id, &payload.session_id)
        .map_err(|error| error.to_string())
}

fn binding_events(
    service: &TerminalSessionBindingService,
) -> Result<Vec<TerminalSessionBindingEvent>, String> {
    service.events().map_err(|error| error.to_string())
}
