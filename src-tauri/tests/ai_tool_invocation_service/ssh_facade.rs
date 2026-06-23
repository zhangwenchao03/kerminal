//! AI SSH facade 工具测试。
//!
//! @author kongweiguang

use super::support::*;
use kerminal_lib::models::{
    ai_tool_invocation::{AiToolExecuteIfAllowedRequest, AiToolObservationStatus},
    remote_host::{RemoteHostCreateRequest, RemoteHostGroupCreateRequest},
    settings::AiCommandApprovalPolicy,
};
use serde_json::json;

fn execute_request(tool_id: &str, arguments: serde_json::Value) -> AiToolExecuteIfAllowedRequest {
    AiToolExecuteIfAllowedRequest {
        tool_id: tool_id.to_owned(),
        arguments,
        requested_by: Some("test-agent-loop".to_owned()),
        reason: Some("验证 SSH facade 工具".to_owned()),
        conversation_id: Some("conv-ssh-facade".to_owned()),
        conversation_slot_json: None,
        run_id: None,
        step_id: None,
        audit_context: None,
    }
}

#[test]
fn ssh_ensure_connected_resolves_saved_host_by_group_and_address() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });
    let group = state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "bwy".to_owned(),
            },
        )
        .expect("create group");
    let host = state
        .remote_hosts()
        .create_host(
            state.storage(),
            RemoteHostCreateRequest {
                group_id: Some(group.id.clone()),
                name: "172.16.40.104".to_owned(),
                host: "172.16.40.104".to_owned(),
                port: 22,
                username: "root".to_owned(),
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                credential_secret: None,
                tags: vec![],
                production: false,
                ssh_options: Default::default(),
            },
        )
        .expect("create host");

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "ssh.ensure_connected",
            json!({
                "groupName": "bwy",
                "host": "172.16.40.104",
                "username": "root",
                "port": 22,
                "cols": 100,
                "rows": 30
            }),
        ),
    ))
    .expect("execute ssh.ensure_connected");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::Succeeded
    );
    assert_eq!(
        response
            .observation
            .data
            .get("hostId")
            .and_then(|value| value.as_str()),
        Some(host.id.as_str())
    );
    assert_eq!(
        response
            .observation
            .data
            .get("clientAction")
            .and_then(|value| value.as_str()),
        Some("sshConnect")
    );
    assert!(response
        .observation
        .entities
        .iter()
        .any(|entity| entity.get("id").and_then(|value| value.as_str()) == Some(host.id.as_str())));
}

#[test]
fn ssh_ensure_connected_reports_ambiguous_selector_with_candidates() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });
    let group = state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "bwy".to_owned(),
            },
        )
        .expect("create group");
    for username in ["root", "deploy"] {
        state
            .remote_hosts()
            .create_host(
                state.storage(),
                RemoteHostCreateRequest {
                    group_id: Some(group.id.clone()),
                    name: format!("bwy-{username}"),
                    host: "172.16.40.104".to_owned(),
                    port: 22,
                    username: username.to_owned(),
                    auth_type: RemoteHostAuthType::Agent,
                    credential_ref: None,
                    credential_secret: None,
                    tags: vec![],
                    production: false,
                    ssh_options: Default::default(),
                },
            )
            .expect("create host");
    }

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "ssh.ensure_connected",
            json!({
                "groupName": "bwy",
                "host": "172.16.40.104",
                "cols": 100,
                "rows": 30
            }),
        ),
    ))
    .expect("execute ambiguous ssh.ensure_connected");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("ambiguousTarget")
    );
    assert!(response.observation.recoverable);
    assert_eq!(
        response
            .observation
            .data
            .get("candidateCount")
            .and_then(|value| value.as_u64()),
        Some(2)
    );
    assert_eq!(response.observation.entities.len(), 2);
}

#[test]
fn ssh_command_on_resolved_host_requires_approval_before_network_execution() {
    let (_home, state) = setup_state();
    let group = state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "bwy".to_owned(),
            },
        )
        .expect("create group");
    state
        .remote_hosts()
        .create_host(
            state.storage(),
            RemoteHostCreateRequest {
                group_id: Some(group.id.clone()),
                name: "172.16.40.104".to_owned(),
                host: "172.16.40.104".to_owned(),
                port: 22,
                username: "root".to_owned(),
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                credential_secret: None,
                tags: vec![],
                production: false,
                ssh_options: Default::default(),
            },
        )
        .expect("create host");

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "ssh.command_on_resolved_host",
            json!({
                "groupName": "bwy",
                "host": "172.16.40.104",
                "username": "root",
                "port": 22,
                "command": "uname -a"
            }),
        ),
    ))
    .expect("prepare ssh.command_on_resolved_host");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::NeedsApproval
    );
    let pending = response.pending_invocation.expect("pending invocation");
    assert_eq!(pending.tool_id, "ssh.command_on_resolved_host");
    assert!(pending.requires_confirmation);
}

#[test]
fn ssh_command_on_resolved_host_reports_missing_target() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "ssh.command_on_resolved_host",
            json!({ "command": "uname -a" }),
        ),
    ))
    .expect("execute missing target ssh.command_on_resolved_host");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("missingTarget")
    );
    assert!(response.observation.recoverable);
}

#[test]
fn ssh_command_on_resolved_host_reports_ambiguous_selector_with_candidates() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });
    let group = state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "bwy".to_owned(),
            },
        )
        .expect("create group");
    for username in ["root", "deploy"] {
        state
            .remote_hosts()
            .create_host(
                state.storage(),
                RemoteHostCreateRequest {
                    group_id: Some(group.id.clone()),
                    name: format!("bwy-{username}"),
                    host: "172.16.40.104".to_owned(),
                    port: 22,
                    username: username.to_owned(),
                    auth_type: RemoteHostAuthType::Agent,
                    credential_ref: None,
                    credential_secret: None,
                    tags: vec![],
                    production: false,
                    ssh_options: Default::default(),
                },
            )
            .expect("create host");
    }

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "ssh.command_on_resolved_host",
            json!({
                "groupName": "bwy",
                "host": "172.16.40.104",
                "command": "uname -a"
            }),
        ),
    ))
    .expect("execute ambiguous ssh.command_on_resolved_host");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("ambiguousTarget")
    );
    assert!(response.observation.recoverable);
    assert_eq!(
        response
            .observation
            .data
            .get("candidateCount")
            .and_then(|value| value.as_u64()),
        Some(2)
    );
    assert_eq!(response.observation.entities.len(), 2);
}
