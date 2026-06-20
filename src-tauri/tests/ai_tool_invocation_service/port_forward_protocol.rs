//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_port_forward_create_requires_remote_confirmation_and_uses_current_schema() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "port_forward.create",
                json!({
                    "bindHost": "127.0.0.1",
                    "hostId": "dev-server",
                    "kind": "local",
                    "name": "AI PostgreSQL 隧道",
                    "sourcePort": 15432,
                    "targetHost": "127.0.0.1",
                    "targetPort": 5432
                }),
            ),
        )
        .expect("prepare port forward create");

    assert_eq!(pending.tool_id, "port_forward.create");
    assert_eq!(pending.tool_title, "创建端口转发");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending.arguments_summary.contains("kind=local"));
    assert!(pending.arguments_summary.contains("sourcePort=15432"));
    assert!(pending.arguments_summary.contains("targetPort=5432"));
    assert!(!pending.arguments_summary.contains("localPort"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_port_forward_create_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "port_forward.create",
                json!({
                    "bindHost": "127.0.0.1",
                    "hostId": "missing-host",
                    "kind": "local",
                    "name": "AI PostgreSQL 隧道",
                    "sourcePort": 15432,
                    "targetHost": "127.0.0.1",
                    "targetPort": 5432
                }),
            ),
        )
        .expect("prepare port forward create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown port forward host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "port_forward.create");
    assert_eq!(audit.risk, ToolRiskLevel::Remote);
    assert!(audit
        .error
        .expect("port forward failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_port_forward_create_invalid_args_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let before_count = state
        .port_forwards()
        .list()
        .expect("list port forwards before")
        .len();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "port_forward.create",
                json!({
                    "bindHost": "127.0.0.1",
                    "hostId": host_id,
                    "kind": "local",
                    "name": "AI PostgreSQL 隧道",
                    "sourcePort": 0,
                    "targetHost": "127.0.0.1",
                    "targetPort": 5432
                }),
            ),
        )
        .expect("prepare invalid port forward create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("invalid port forward should become audit record");
    let after_count = state
        .port_forwards()
        .list()
        .expect("list port forwards after")
        .len();

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "port_forward.create");
    assert!(audit
        .error
        .expect("port forward invalid arg")
        .contains("sourcePort 必须是 1 到 65535 的数字"));
    assert_eq!(before_count, after_count);
}

#[test]
fn confirm_port_forward_create_rejection_does_not_create_session() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let before_count = state
        .port_forwards()
        .list()
        .expect("list port forwards before rejection")
        .len();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "port_forward.create",
                json!({
                    "bindHost": "127.0.0.1",
                    "hostId": host_id,
                    "kind": "local",
                    "name": "AI PostgreSQL 隧道",
                    "sourcePort": 15432,
                    "targetHost": "127.0.0.1",
                    "targetPort": 5432
                }),
            ),
        )
        .expect("prepare port forward create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
            },
        )
        .expect("reject port forward create");
    let after_count = state
        .port_forwards()
        .list()
        .expect("list port forwards after rejection")
        .len();

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(audit.tool_id, "port_forward.create");
    assert_eq!(before_count, after_count);
}

#[test]
fn prepare_port_forward_list_is_read_only_and_auto_confirmed() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("port_forward.list", json!({})),
        )
        .expect("prepare port forward list");

    assert_eq!(pending.tool_id, "port_forward.list");
    assert_eq!(pending.tool_title, "列出端口转发");
    assert_eq!(pending.risk, ToolRiskLevel::Read);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Auto);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(!pending.requires_confirmation);
    assert_eq!(pending.arguments_summary, "无参数");
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_port_forward_list_returns_empty_state_summary() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("port_forward.list", json!({})),
        )
        .expect("prepare port forward list");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("confirm port forward list");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "port_forward.list");
    assert!(audit
        .result_summary
        .expect("port forward list summary")
        .contains("当前没有端口转发会话"));
}

#[test]
fn prepare_port_forward_close_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("port_forward.close", json!({ "forwardId": "forward-1" })),
        )
        .expect("prepare port forward close");

    assert_eq!(pending.tool_id, "port_forward.close");
    assert_eq!(pending.tool_title, "关闭端口转发");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("forwardId=forward-1"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_port_forward_close_unknown_session_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "port_forward.close",
                json!({ "forwardId": "missing-forward" }),
            ),
        )
        .expect("prepare port forward close");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown port forward close should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "port_forward.close");
    assert!(audit
        .error
        .expect("port forward close failure")
        .contains("端口转发不存在或已关闭"));
}

#[test]
fn confirm_port_forward_close_rejection_does_not_change_sessions() {
    let (_home, state) = setup_state();
    let before_count = state
        .port_forwards()
        .list()
        .expect("list port forwards before rejection")
        .len();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("port_forward.close", json!({ "forwardId": "forward-1" })),
        )
        .expect("prepare port forward close");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
            },
        )
        .expect("reject port forward close");
    let after_count = state
        .port_forwards()
        .list()
        .expect("list port forwards after rejection")
        .len();

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(audit.tool_id, "port_forward.close");
    assert_eq!(before_count, after_count);
}
