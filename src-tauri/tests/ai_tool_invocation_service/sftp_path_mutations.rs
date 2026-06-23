//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_sftp_rename_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.rename",
                json!({
                    "fromPath": "/tmp/kerminal-ai-preview.tmp",
                    "hostId": "dev-server",
                    "toPath": "/tmp/kerminal-ai-preview.renamed.tmp"
                }),
            ),
        )
        .expect("prepare sftp rename");

    assert_eq!(pending.tool_id, "sftp.rename");
    assert_eq!(pending.tool_title, "重命名远程路径");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending
        .arguments_summary
        .contains("fromPath=/tmp/kerminal-ai-preview.tmp"));
    assert!(pending
        .arguments_summary
        .contains("toPath=/tmp/kerminal-ai-preview.renamed.tmp"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_rename_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.rename",
                json!({
                    "fromPath": "/tmp/kerminal-ai-preview.tmp",
                    "hostId": "missing-host",
                    "toPath": "/tmp/kerminal-ai-preview.renamed.tmp"
                }),
            ),
        )
        .expect("prepare sftp rename");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("unknown sftp host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.rename");
    assert_eq!(audit.risk, ToolRiskLevel::Remote);
    assert!(audit
        .error
        .expect("sftp rename failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_sftp_rename_invalid_path_arg_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.rename",
                json!({
                    "fromPath": "/tmp/kerminal-ai-preview.tmp",
                    "hostId": "missing-host",
                    "toPath": false
                }),
            ),
        )
        .expect("prepare invalid sftp rename");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("invalid sftp rename should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.rename");
    assert!(audit
        .error
        .expect("sftp rename invalid arg")
        .contains("toPath 必须是字符串"));
}

#[test]
fn confirm_sftp_rename_root_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.rename",
                json!({
                    "fromPath": "/",
                    "hostId": host_id,
                    "toPath": "/tmp/kerminal-root-renamed"
                }),
            ),
        )
        .expect("prepare root path sftp rename");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("root path rename should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.rename");
    assert!(audit
        .error
        .expect("root path rename failure")
        .contains("不允许对远程根目录执行该操作"));
}

#[test]
fn prepare_sftp_move_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.move",
                json!({
                    "fromPath": "/tmp/kerminal-ai-preview.renamed.tmp",
                    "hostId": "dev-server",
                    "toPath": "/tmp/kerminal-ai-preview/moved.tmp"
                }),
            ),
        )
        .expect("prepare sftp move");

    assert_eq!(pending.tool_id, "sftp.move");
    assert_eq!(pending.tool_title, "移动远程路径");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending
        .arguments_summary
        .contains("fromPath=/tmp/kerminal-ai-preview.renamed.tmp"));
    assert!(pending
        .arguments_summary
        .contains("toPath=/tmp/kerminal-ai-preview/moved.tmp"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_move_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.move",
                json!({
                    "fromPath": "/tmp/kerminal-ai-preview.renamed.tmp",
                    "hostId": "missing-host",
                    "toPath": "/tmp/kerminal-ai-preview/moved.tmp"
                }),
            ),
        )
        .expect("prepare sftp move");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("unknown sftp host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.move");
    assert_eq!(audit.risk, ToolRiskLevel::Remote);
    assert!(audit
        .error
        .expect("sftp move failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_sftp_move_invalid_path_arg_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.move",
                json!({
                    "fromPath": "/tmp/kerminal-ai-preview.renamed.tmp",
                    "hostId": "missing-host",
                    "toPath": false
                }),
            ),
        )
        .expect("prepare invalid sftp move");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("invalid sftp move should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.move");
    assert!(audit
        .error
        .expect("sftp move invalid arg")
        .contains("toPath 必须是字符串"));
}

#[test]
fn confirm_sftp_move_root_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.move",
                json!({
                    "fromPath": "/",
                    "hostId": host_id,
                    "toPath": "/tmp/kerminal-root-moved"
                }),
            ),
        )
        .expect("prepare root path sftp move");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
                audit_context: None,
            },
        )
        .expect("root path move should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.move");
    assert!(audit
        .error
        .expect("root path move failure")
        .contains("不允许对远程根目录执行该操作"));
}
