//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn confirm_history_search_returns_matching_command_summary() {
    let (_home, state) = setup_state();
    state
        .command_history()
        .record_command(
            state.storage(),
            CommandHistoryRecordRequest {
                command: "npm run check".to_owned(),
                source: CommandHistorySource::User,
                target: CommandHistoryTarget::Local,
                record: None,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                tab_id: None,
                profile_id: None,
                remote_host_id: None,
                cwd: None,
                shell: Some("pwsh.exe".to_owned()),
            },
        )
        .expect("record history");
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "history.search",
                json!({ "query": "npm", "target": "local", "limit": 5 }),
            ),
        )
        .expect("prepare history search");

    assert_eq!(pending.tool_id, "history.search");
    assert_eq!(pending.risk, ToolRiskLevel::Read);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Auto);
    assert!(!pending.requires_confirmation);

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("confirm history search");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "history.search");
    assert!(audit
        .result_summary
        .expect("history search summary")
        .contains("npm run check"));
}

#[test]
fn confirm_diagnostics_runtime_health_returns_redacted_summary() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("diagnostics.runtime_health", json!({})),
        )
        .expect("prepare diagnostics runtime health");

    assert_eq!(pending.tool_id, "diagnostics.runtime_health");
    assert_eq!(pending.risk, ToolRiskLevel::Read);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Auto);
    assert!(!pending.requires_confirmation);

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("confirm diagnostics runtime health");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "diagnostics.runtime_health");
    let summary = audit.result_summary.expect("runtime health summary");
    assert!(summary.contains("运行体检已读取"));
    assert!(summary.contains("已脱敏"));
}

#[test]
fn confirm_diagnostics_create_bundle_writes_redacted_bundle_and_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("diagnostics.create_bundle", json!({})),
        )
        .expect("prepare diagnostics create bundle");

    assert_eq!(pending.tool_id, "diagnostics.create_bundle");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(pending.requires_confirmation);

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("confirm diagnostics create bundle");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "diagnostics.create_bundle");
    let summary = audit.result_summary.expect("diagnostic bundle summary");
    assert!(summary.contains("诊断包已生成"));
    assert!(summary.contains("已脱敏：是"));

    let bundle_count = fs::read_dir(&state.paths().diagnostics)
        .expect("read diagnostics dir")
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("diagnostics-")
        })
        .count();
    assert_eq!(bundle_count, 1);
}

#[test]
fn confirm_workspace_split_records_successful_client_dispatch_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.split_pane", json!({ "direction": "vertical" })),
        )
        .expect("prepare workspace split");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("approve workspace split");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "workspace.split_pane");
    assert!(audit
        .result_summary
        .expect("result summary")
        .contains("上下分屏"));
}

#[test]
fn confirm_workspace_focus_tab_records_successful_client_dispatch_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.focus_tab", json!({ "tabId": "tab-remote" })),
        )
        .expect("prepare workspace focus tab");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("approve workspace focus tab");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "workspace.focus_tab");
    assert!(audit
        .result_summary
        .expect("result summary")
        .contains("tab-remote"));
}

#[test]
fn confirm_workspace_open_tool_records_successful_client_dispatch_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.open_tool", json!({ "toolId": "sftp" })),
        )
        .expect("prepare workspace open tool");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("approve workspace open tool");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "workspace.open_tool");
    assert!(audit
        .result_summary
        .expect("result summary")
        .contains("SFTP"));
}

#[test]
fn confirm_terminal_create_records_client_dispatch_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.create",
                json!({ "cols": 80, "rows": 24, "title": "AI 本地终端" }),
            ),
        )
        .expect("prepare terminal create");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("approve terminal create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "terminal.create");
    assert!(audit
        .result_summary
        .expect("terminal create result summary")
        .contains("客户端将打开新 tab"));
}

#[test]
fn confirm_ssh_connect_records_client_dispatch_audit_for_saved_host() {
    let (_home, state) = setup_state();
    let host_id = create_test_remote_host(&state);
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.connect",
                json!({ "hostId": host_id, "cols": 100, "rows": 28 }),
            ),
        )
        .expect("prepare ssh connect");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("approve ssh connect");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "ssh.connect");
    let summary = audit.result_summary.expect("ssh connect summary");
    assert!(summary.contains("SSH 终端已批准打开"));
    assert!(summary.contains("dev ssh"));
    assert!(summary.contains("deploy@dev.internal:22"));
}

#[test]
fn confirm_ssh_connect_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.connect",
                json!({ "hostId": "missing-host", "cols": 80, "rows": 24 }),
            ),
        )
        .expect("prepare ssh connect");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown ssh host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert!(audit
        .error
        .expect("ssh connect failure")
        .contains("远程主机不存在"));
}

#[test]
fn confirm_ssh_command_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.command",
                json!({
                    "hostId": "missing-host",
                    "command": "uname -a",
                    "timeoutSeconds": 5
                }),
            ),
        )
        .expect("prepare ssh command");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown ssh command host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "ssh.command");
    assert!(audit
        .error
        .expect("ssh command failure")
        .contains("远程主机不存在"));
}

#[test]
fn audit_preserves_dangerous_ssh_command_risk_summary() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.command",
                json!({
                    "hostId": "dev-server",
                    "command": "sudo reboot"
                }),
            ),
        )
        .expect("prepare dangerous ssh command");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: false,
            },
        )
        .expect("reject dangerous ssh command");

    assert_eq!(audit.status, AiToolInvocationStatus::Rejected);
    assert_eq!(audit.tool_id, "ssh.command");
    assert_eq!(audit.risk, ToolRiskLevel::Destructive);
    assert_eq!(audit.confirmation, ToolConfirmationPolicy::Always);
    let risk_summary = audit.risk_summary.expect("audit risk summary");
    assert!(risk_summary.contains("远程命令风险"));
    assert!(risk_summary.contains("权限提升"));
    assert!(risk_summary.contains("关机或重启"));
}

#[test]
fn prepare_server_info_snapshot_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("server_info.snapshot", json!({ "hostId": "dev-server" })),
        )
        .expect("prepare server info snapshot");

    assert_eq!(pending.tool_id, "server_info.snapshot");
    assert_eq!(pending.tool_title, "读取服务器信息");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending.client_action.is_none());
}

#[test]
fn confirm_server_info_snapshot_unknown_host_records_failed_audit() {
    let (_home, state) = setup_state();
    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("server_info.snapshot", json!({ "hostId": "missing-host" })),
        )
        .expect("prepare server info snapshot");

    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .expect("unknown server info host should become audit record");

    assert_eq!(audit.status, AiToolInvocationStatus::Failed);
    assert_eq!(audit.tool_id, "server_info.snapshot");
    assert!(audit
        .error
        .expect("server info failure")
        .contains("远程主机不存在"));
}

#[test]
fn summarize_server_info_snapshot_for_ai_uses_readable_percentages() {
    let summary = summarize_server_info_snapshot_for_ai(&ServerInfoSnapshot {
        architecture: Some("x86_64".to_owned()),
        captured_at: "100".to_owned(),
        cpu_core_usage_percents: Vec::new(),
        cpu_count: Some(8),
        cpu_model: None,
        cpu_usage_percent: Some(13.45),
        disk_available_bytes: Some(75),
        disk_mount: Some("/".to_owned()),
        disk_total_bytes: Some(100),
        disk_used_bytes: Some(25),
        disks: Vec::new(),
        gpu_probe_status: None,
        gpus: Vec::new(),
        host: "dev.internal".to_owned(),
        host_id: "dev-server".to_owned(),
        host_name: "dev server".to_owned(),
        hostname: Some("dev-api".to_owned()),
        kernel: Some("6.8.0".to_owned()),
        load_average: Some([0.1, 0.2, 0.3]),
        memory_available_bytes: Some(625),
        memory_buffers_bytes: None,
        memory_cached_bytes: None,
        memory_total_bytes: Some(1000),
        memory_used_bytes: Some(375),
        network_interfaces: Vec::new(),
        network_rx_bytes: Some(123),
        network_tx_bytes: Some(456),
        os: Some("Linux".to_owned()),
        port: 22,
        process_count: None,
        running_process_count: None,
        swap_total_bytes: Some(0),
        swap_used_bytes: Some(0),
        top_processes: Vec::new(),
        uptime_seconds: Some(90_000),
        username: "deploy".to_owned(),
    });

    assert!(summary.contains("服务器信息已读取"));
    assert!(summary.contains("dev server"));
    assert!(summary.contains("deploy@dev.internal:22"));
    assert!(summary.contains("Linux x86_64"));
    assert!(summary.contains("CPU：13.4%"));
    assert!(summary.contains("内存：37.5%"));
    assert!(summary.contains("磁盘：25.0%"));
    assert!(summary.contains("1 天 1 小时"));
}

#[test]
fn summarize_ssh_command_output_for_ai_bounds_and_redacts_streams() {
    let summary = summarize_ssh_command_output_for_ai(&SshCommandOutput {
        host_id: "dev-server".to_owned(),
        host_name: "dev server".to_owned(),
        host: "dev.internal".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        exit_code: Some(0),
        success: true,
        stdout: "token=secret-token\nservice started".to_owned(),
        stderr: "warning: noisy output".to_owned(),
        stdout_bytes: 34,
        stderr_bytes: 21,
        stdout_truncated: true,
        stderr_truncated: false,
        max_output_bytes: 4096,
        duration_ms: 123,
    });

    assert!(summary.contains("远程命令已执行"));
    assert!(summary.contains("dev server"));
    assert!(summary.contains("deploy@dev.internal:22"));
    assert!(summary.contains("退出码：0"));
    assert!(summary.contains("stdout：34 字节，已截断，已脱敏"));
    assert!(summary.contains("token=[已脱敏]"));
    assert!(!summary.contains("secret-token"));
    assert!(summary.contains("stderr：21 字节"));
    assert!(summary.contains("耗时：123 ms"));
}
