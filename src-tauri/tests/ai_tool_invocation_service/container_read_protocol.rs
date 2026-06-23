//! AI 容器只读工具调用协议测试。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_container_list_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "container.list",
                json!({ "hostId": "dev-server", "runtime": "docker", "includeStopped": true }),
            ),
        )
        .expect("prepare container list");

    assert_eq!(pending.tool_id, "container.list");
    assert_eq!(pending.tool_title, "列出容器");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending.arguments_summary.contains("runtime=docker"));
}

#[test]
fn confirm_container_list_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();

    let audit = confirm_tool(
        &state,
        "container.list",
        json!({ "hostId": "missing-host", "runtime": "docker", "includeStopped": true }),
    );

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "container.list");
    let error = audit.error.expect("container list failure");
    assert!(error.contains("远程主机不存在"), "{error}");
}

#[test]
fn confirm_container_preview_invalid_max_bytes_records_failed_audit() {
    let (_home, state) = setup_state();

    let audit = confirm_tool(
        &state,
        "container.files.preview",
        json!({
            "hostId": "dev-server",
            "containerId": "app",
            "runtime": "docker",
            "path": "/app/README.md",
            "maxBytes": "large"
        }),
    );

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "container.files.preview");
    let error = audit.error.expect("container preview invalid arg");
    assert!(
        error.contains("container.files.preview 参数无效"),
        "{error}"
    );
}
