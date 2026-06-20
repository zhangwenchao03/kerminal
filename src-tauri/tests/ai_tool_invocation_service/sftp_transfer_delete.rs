//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_sftp_upload_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.upload",
                json!({
                    "hostId": "dev-server",
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-upload.txt",
                    "remotePath": "/tmp/kerminal-ai-preview-upload.txt"
                }),
            ),
        )
        .expect("prepare sftp upload");

    assert_eq!(pending.tool_id, "sftp.upload");
    assert_eq!(pending.tool_title, "上传本地文件");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending
        .arguments_summary
        .contains("localPath=~/.kerminal/temp/kerminal-ai-preview-upload.txt"));
    assert!(pending
        .arguments_summary
        .contains("remotePath=/tmp/kerminal-ai-preview-upload.txt"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_upload_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.upload",
                json!({
                    "hostId": "missing-host",
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-upload.txt",
                    "remotePath": "/tmp/kerminal-ai-preview-upload.txt"
                }),
            ),
        )
        .expect("prepare sftp upload");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown sftp host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.upload");
    assert_eq!(audit.risk, ToolRiskLevel::Remote);
    assert!(audit
        .error
        .expect("sftp upload failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_sftp_upload_invalid_remote_path_arg_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.upload",
                json!({
                    "hostId": "missing-host",
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-upload.txt",
                    "remotePath": false
                }),
            ),
        )
        .expect("prepare invalid sftp upload");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("invalid sftp upload should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.upload");
    assert!(audit
        .error
        .expect("sftp upload invalid arg")
        .contains("remotePath 必须是字符串"));
}

#[test]
fn confirm_sftp_upload_empty_local_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.upload",
                json!({
                    "hostId": host_id,
                    "localPath": "",
                    "remotePath": "/tmp/kerminal-ai-preview-upload.txt"
                }),
            ),
        )
        .expect("prepare empty local path sftp upload");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("empty local path upload should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.upload");
    assert!(audit
        .error
        .expect("empty local path upload failure")
        .contains("本地路径不能为空"));
}

#[test]
fn confirm_sftp_upload_root_remote_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.upload",
                json!({
                    "hostId": host_id,
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-upload.txt",
                    "remotePath": "/"
                }),
            ),
        )
        .expect("prepare root path sftp upload");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("root path upload should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.upload");
    assert!(audit
        .error
        .expect("root path upload failure")
        .contains("不允许对远程根目录执行该操作"));
}

#[test]
fn prepare_sftp_download_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.download",
                json!({
                    "hostId": "dev-server",
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-app.log",
                    "remotePath": "/var/log/app.log"
                }),
            ),
        )
        .expect("prepare sftp download");

    assert_eq!(pending.tool_id, "sftp.download");
    assert_eq!(pending.tool_title, "下载远程文件");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending
        .arguments_summary
        .contains("remotePath=/var/log/app.log"));
    assert!(pending
        .arguments_summary
        .contains("localPath=~/.kerminal/temp/kerminal-ai-preview-app.log"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_download_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.download",
                json!({
                    "hostId": "missing-host",
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-app.log",
                    "remotePath": "/var/log/app.log"
                }),
            ),
        )
        .expect("prepare sftp download");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown sftp host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.download");
    assert_eq!(audit.risk, ToolRiskLevel::Remote);
    assert!(audit
        .error
        .expect("sftp download failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_sftp_download_invalid_local_path_arg_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.download",
                json!({
                    "hostId": "missing-host",
                    "localPath": false,
                    "remotePath": "/var/log/app.log"
                }),
            ),
        )
        .expect("prepare invalid sftp download");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("invalid sftp download should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.download");
    assert!(audit
        .error
        .expect("sftp download invalid arg")
        .contains("localPath 必须是字符串"));
}

#[test]
fn confirm_sftp_download_empty_local_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.download",
                json!({
                    "hostId": host_id,
                    "localPath": "",
                    "remotePath": "/var/log/app.log"
                }),
            ),
        )
        .expect("prepare empty local path sftp download");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("empty local path download should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.download");
    assert!(audit
        .error
        .expect("empty local path download failure")
        .contains("本地路径不能为空"));
}

#[test]
fn confirm_sftp_download_root_remote_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.download",
                json!({
                    "hostId": host_id,
                    "localPath": "~/.kerminal/temp/kerminal-ai-preview-app.log",
                    "remotePath": "/"
                }),
            ),
        )
        .expect("prepare root path sftp download");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("root path download should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.download");
    assert!(audit
        .error
        .expect("root path download failure")
        .contains("不允许对远程根目录执行该操作"));
}

#[test]
fn prepare_sftp_delete_requires_destructive_confirmation_and_full_audit() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.delete",
                json!({
                    "directory": false,
                    "hostId": "dev-server",
                    "path": "/tmp/kerminal-ai-preview.tmp"
                }),
            ),
        )
        .expect("prepare sftp delete");

    assert_eq!(pending.tool_id, "sftp.delete");
    assert_eq!(pending.tool_title, "删除远程文件");
    assert_eq!(pending.risk, ToolRiskLevel::Destructive);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Full);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending
        .arguments_summary
        .contains("path=/tmp/kerminal-ai-preview.tmp"));
    assert!(pending.arguments_summary.contains("directory=false"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_delete_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.delete",
                json!({
                    "directory": false,
                    "hostId": "missing-host",
                    "path": "/tmp/kerminal-ai-preview.tmp"
                }),
            ),
        )
        .expect("prepare sftp delete");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown sftp host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.delete");
    assert_eq!(audit.risk, ToolRiskLevel::Destructive);
    assert!(audit
        .error
        .expect("sftp delete failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_sftp_delete_invalid_directory_arg_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.delete",
                json!({
                    "directory": "yes",
                    "hostId": "missing-host",
                    "path": "/tmp/kerminal-ai-preview.tmp"
                }),
            ),
        )
        .expect("prepare invalid sftp delete");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("invalid sftp delete should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.delete");
    assert!(audit
        .error
        .expect("sftp delete invalid arg")
        .contains("directory 必须是布尔值"));
}

#[test]
fn confirm_sftp_delete_root_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.delete",
                json!({
                    "directory": true,
                    "hostId": host_id,
                    "path": "/"
                }),
            ),
        )
        .expect("prepare root path sftp delete");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("root path delete should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.delete");
    assert!(audit
        .error
        .expect("root path delete failure")
        .contains("不允许对远程根目录执行该操作"));
}
