//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_sftp_list_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.list",
                json!({ "hostId": "dev-server", "path": "/var/log" }),
            ),
        )
        .expect("prepare sftp list");

    assert_eq!(pending.tool_id, "sftp.list");
    assert_eq!(pending.tool_title, "列出远程目录");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending.arguments_summary.contains("path=/var/log"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_list_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.list",
                json!({ "hostId": "missing-host", "path": "/var/log" }),
            ),
        )
        .expect("prepare sftp list");

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
    assert_eq!(audit.tool_id, "sftp.list");
    assert!(audit
        .error
        .expect("sftp list failure")
        .contains("远程主机不存在"));
}

#[test]
fn summarize_sftp_listing_for_ai_counts_entry_kinds_and_examples() {
    let summary = summarize_sftp_listing_for_ai(&SftpDirectoryListing {
        entries: vec![
            SftpEntry {
                kind: SftpEntryKind::File,
                modified: Some("Jun 17 18:00".to_owned()),
                name: "app.log".to_owned(),
                path: "/var/log/app.log".to_owned(),
                permissions: Some("-rw-r--r--".to_owned()),
                raw: "-rw-r--r-- 524288 app.log".to_owned(),
                size: Some(524_288),
            },
            SftpEntry {
                kind: SftpEntryKind::Directory,
                modified: Some("Jun 17 18:00".to_owned()),
                name: "nginx".to_owned(),
                path: "/var/log/nginx".to_owned(),
                permissions: Some("drwxr-xr-x".to_owned()),
                raw: "drwxr-xr-x 4096 nginx".to_owned(),
                size: Some(4_096),
            },
            SftpEntry {
                kind: SftpEntryKind::Symlink,
                modified: Some("Jun 17 18:00".to_owned()),
                name: "current".to_owned(),
                path: "/var/log/current".to_owned(),
                permissions: Some("lrwxrwxrwx".to_owned()),
                raw: "lrwxrwxrwx 7 current -> app.log".to_owned(),
                size: Some(7),
            },
        ],
        host_id: "dev-server".to_owned(),
        parent_path: Some("/var".to_owned()),
        path: "/var/log".to_owned(),
    });

    assert!(summary.contains("远程目录已读取"));
    assert!(summary.contains("dev-server:/var/log"));
    assert!(summary.contains("共 3 项"));
    assert!(summary.contains("目录 1"));
    assert!(summary.contains("文件 1"));
    assert!(summary.contains("链接 1"));
    assert!(summary.contains("app.log、nginx、current"));
}

#[test]
fn prepare_sftp_preview_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.preview",
                json!({ "hostId": "dev-server", "path": "/var/log/app.log", "maxBytes": 4096 }),
            ),
        )
        .expect("prepare sftp preview");

    assert_eq!(pending.tool_id, "sftp.preview");
    assert_eq!(pending.tool_title, "预览远程文件");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending.arguments_summary.contains("path=/var/log/app.log"));
    assert!(pending.arguments_summary.contains("maxBytes=4096"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_sftp_preview_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.preview",
                json!({ "hostId": "missing-host", "path": "/var/log/app.log" }),
            ),
        )
        .expect("prepare sftp preview");

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
        .expect("unknown sftp preview host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.preview");
    assert!(audit
        .error
        .expect("sftp preview failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_sftp_preview_invalid_max_bytes_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.preview",
                json!({
                    "hostId": "dev-server",
                    "maxBytes": "large",
                    "path": "/var/log/app.log"
                }),
            ),
        )
        .expect("prepare invalid sftp preview");

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
        .expect("invalid maxBytes should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.preview");
    assert!(audit
        .error
        .expect("sftp preview invalid arg")
        .contains("maxBytes 必须是数字"));
}

#[test]
fn confirm_sftp_preview_root_path_records_failed_audit_before_spawn() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "sftp.preview",
                json!({
                    "hostId": host_id,
                    "path": "/"
                }),
            ),
        )
        .expect("prepare root path sftp preview");

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
        .expect("root path preview should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "sftp.preview");
    assert!(audit
        .error
        .expect("root path preview failure")
        .contains("不允许对远程根目录执行该操作"));
    assert!(!state.paths().temp.join("sftp-preview").exists());
}

#[test]
fn summarize_sftp_preview_for_ai_redacts_and_truncates_sample() {
    let summary = summarize_sftp_preview_for_ai(&SftpFilePreview {
        bytes_read: 128,
        content: "token=super-secret\nline one\nline two\nline three\nline four\nline five"
            .to_owned(),
        encoding: "utf-8-lossy".to_owned(),
        host_id: "dev-server".to_owned(),
        max_bytes: 128,
        path: "/var/log/app.log".to_owned(),
        truncated: true,
    });

    assert!(summary.contains("远程文件已预览"));
    assert!(summary.contains("dev-server:/var/log/app.log"));
    assert!(summary.contains("内容已截断"));
    assert!(summary.contains("片段已脱敏"));
    assert!(summary.contains("token=[已脱敏]"));
    assert!(!summary.contains("super-secret"));
    assert!(!summary.contains("line five"));
}
