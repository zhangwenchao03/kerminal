//! AI 远程主机 facade 工具测试。
//!
//! @author kongweiguang

use super::support::*;
use kerminal_lib::models::{
    ai_tool_invocation::{AiToolExecuteIfAllowedRequest, AiToolObservationStatus},
    settings::AiCommandApprovalPolicy,
};
use serde_json::json;

fn execute_request(tool_id: &str, arguments: serde_json::Value) -> AiToolExecuteIfAllowedRequest {
    AiToolExecuteIfAllowedRequest {
        tool_id: tool_id.to_owned(),
        arguments,
        requested_by: Some("test-agent-loop".to_owned()),
        reason: Some("验证远程主机 facade 工具".to_owned()),
        conversation_id: Some("conv-remote-host-facade".to_owned()),
        conversation_slot_json: None,
        run_id: None,
        step_id: None,
        audit_context: None,
    }
}

#[test]
fn remote_host_ensure_creates_group_and_host_from_names() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "remote_host.ensure",
            json!({
                "groupName": "bwy",
                "name": "172.16.40.104",
                "host": "172.16.40.104",
                "port": 22,
                "username": "root",
                "authType": "agent",
                "production": false
            }),
        ),
    ))
    .expect("execute remote_host.ensure");

    assert_eq!(
        response.observation.status,
        AiToolObservationStatus::Succeeded
    );
    assert_eq!(
        response
            .observation
            .data
            .get("created")
            .and_then(|value| value.as_bool()),
        Some(true)
    );
    let host_id = response
        .observation
        .data
        .get("hostId")
        .and_then(|value| value.as_str())
        .expect("hostId");
    let group_id = response
        .observation
        .data
        .get("groupId")
        .and_then(|value| value.as_str())
        .expect("groupId");
    assert!(!host_id.is_empty());
    assert!(!group_id.is_empty());
    assert!(response
        .observation
        .entities
        .iter()
        .any(|entity| entity.get("id").and_then(|value| value.as_str()) == Some(host_id)));

    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list tree");
    let group = tree
        .iter()
        .find(|group| group.id == group_id)
        .expect("created group");
    assert_eq!(group.name, "bwy");
    assert_eq!(group.hosts.len(), 1);
    assert_eq!(group.hosts[0].id, host_id);
}

#[test]
fn remote_host_ensure_confirm_persists_group_and_host_after_approval() {
    let (_home, state) = setup_state();

    let audit = confirm_tool(
        &state,
        "remote_host.ensure",
        json!({
            "groupName": "bwy",
            "name": "172.16.40.105",
            "host": "172.16.40.105",
            "port": 22,
            "username": "root",
            "authType": "agent",
            "production": false
        }),
    );

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "remote_host.ensure");
    assert!(audit
        .result_summary
        .as_deref()
        .is_some_and(|summary| summary.contains("172.16.40.105")));

    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list tree");
    let group = tree
        .iter()
        .find(|group| group.name == "bwy")
        .expect("created bwy group");
    let host = group
        .hosts
        .iter()
        .find(|host| host.host == "172.16.40.105" && host.username == "root")
        .expect("created host");

    assert_eq!(host.port, 22);
    assert_eq!(host.auth_type, RemoteHostAuthType::Agent);
}

#[test]
fn remote_host_ensure_password_auth_stores_plaintext_password_on_host() {
    let (_home, state) = setup_state();

    let audit = confirm_tool(
        &state,
        "remote_host.ensure",
        json!({
            "groupName": "bwy",
            "name": "172.16.40.105",
            "host": "172.16.40.105",
            "port": 22,
            "username": "root",
            "authType": "password",
            "password": "Pku@Wh2023",
            "production": false
        }),
    );

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list tree");
    let host = tree
        .iter()
        .flat_map(|group| group.hosts.iter())
        .find(|host| host.host == "172.16.40.105" && host.username == "root")
        .expect("created password host");

    assert_eq!(host.auth_type, RemoteHostAuthType::Password);
    assert_eq!(host.credential_ref, None);
    assert_eq!(host.credential_secret.as_deref(), Some("Pku@Wh2023"));
    assert!(!audit.arguments_summary.contains("Pku@Wh2023"));
    assert!(!audit
        .result_summary
        .unwrap_or_default()
        .contains("Pku@Wh2023"));
}

#[test]
fn remote_host_ensure_updates_existing_host_when_plaintext_credential_is_provided() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });
    let base_arguments = json!({
        "groupName": "bwy",
        "name": "172.16.40.106",
        "host": "172.16.40.106",
        "port": 22,
        "username": "root",
        "authType": "agent",
        "production": false
    });

    let first = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("remote_host.ensure", base_arguments),
    ))
    .expect("first ensure");
    let host_id = first
        .observation
        .data
        .get("hostId")
        .and_then(|value| value.as_str())
        .expect("host id")
        .to_owned();

    let second = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request(
            "remote_host.ensure",
            json!({
                "groupName": "bwy",
                "name": "172.16.40.106",
                "host": "172.16.40.106",
                "port": 22,
                "username": "root",
                "authType": "password",
                "credentialSecret": "new-visible-password",
                "production": false
            }),
        ),
    ))
    .expect("second ensure");

    assert_eq!(
        second
            .observation
            .data
            .get("created")
            .and_then(|value| value.as_bool()),
        Some(false)
    );
    assert_eq!(
        second
            .observation
            .data
            .get("hostId")
            .and_then(|value| value.as_str()),
        Some(host_id.as_str())
    );

    let host = state
        .storage()
        .remote_host_by_id(&host_id)
        .expect("load host")
        .expect("host exists");
    assert_eq!(host.auth_type, RemoteHostAuthType::Password);
    assert_eq!(
        host.credential_secret.as_deref(),
        Some("new-visible-password")
    );
}

#[test]
fn remote_host_ensure_reuses_existing_host_in_group() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| {
        ai.command_approval_policy = AiCommandApprovalPolicy::Relaxed
    });
    let arguments = json!({
        "groupName": "bwy",
        "name": "172.16.40.104",
        "host": "172.16.40.104",
        "port": 22,
        "username": "root",
        "authType": "agent",
        "production": false
    });

    let first = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("remote_host.ensure", arguments.clone()),
    ))
    .expect("first ensure");
    let second = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("remote_host.ensure", arguments),
    ))
    .expect("second ensure");

    assert_eq!(
        second.observation.status,
        AiToolObservationStatus::Succeeded
    );
    assert_eq!(
        second
            .observation
            .data
            .get("created")
            .and_then(|value| value.as_bool()),
        Some(false)
    );
    assert_eq!(
        second.observation.data.get("hostId"),
        first.observation.data.get("hostId")
    );

    let host_count = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list tree")
        .iter()
        .flat_map(|group| group.hosts.iter())
        .filter(|host| host.host == "172.16.40.104" && host.username == "root")
        .count();
    assert_eq!(host_count, 1);
}

#[test]
fn remote_host_last_used_resolves_recent_ssh_history_host() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    state
        .command_history()
        .record_command(
            state.storage(),
            CommandHistoryRecordRequest {
                command: "uname -a".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Ssh,
                record: None,
                session_id: Some("session-ssh".to_owned()),
                pane_id: Some("pane-ssh".to_owned()),
                tab_id: None,
                profile_id: None,
                remote_host_id: Some(host_id.clone()),
                cwd: None,
                shell: Some("ssh".to_owned()),
            },
        )
        .expect("record ssh history");

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("remote_host.last_used", json!({})),
    ))
    .expect("execute remote_host.last_used");

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
        Some(host_id.as_str())
    );
    assert!(response.observation.entities.iter().any(|entity| {
        entity.get("type").and_then(|value| value.as_str()) == Some("remoteHost")
            && entity.get("id").and_then(|value| value.as_str()) == Some(host_id.as_str())
    }));
}

#[test]
fn remote_host_last_used_fails_when_no_ssh_history_host_exists() {
    let (_home, state) = setup_state();

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("remote_host.last_used", json!({ "target": "ssh" })),
    ))
    .expect("execute remote_host.last_used");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("targetNotFound")
    );
    assert!(response.observation.recoverable);
}

#[test]
fn remote_host_last_used_ignores_deleted_history_host() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    state
        .command_history()
        .record_command(
            state.storage(),
            CommandHistoryRecordRequest {
                command: "df -h".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Ssh,
                record: None,
                session_id: None,
                pane_id: None,
                tab_id: None,
                profile_id: None,
                remote_host_id: Some(host_id.clone()),
                cwd: None,
                shell: Some("ssh".to_owned()),
            },
        )
        .expect("record ssh history");
    assert!(state
        .remote_hosts()
        .delete_host(state.storage(), &host_id)
        .expect("delete host"));

    let response = tauri::async_runtime::block_on(state.ai_tools().execute_if_allowed(
        ai_tool_execution_context(&state),
        state.tools(),
        execute_request("remote_host.last_used", json!({})),
    ))
    .expect("execute remote_host.last_used");

    assert_eq!(response.observation.status, AiToolObservationStatus::Failed);
    assert_eq!(
        response.observation.error_kind.as_deref(),
        Some("targetNotFound")
    );
    assert!(response.observation.recoverable);
    assert!(response.observation.entities.is_empty());
}
