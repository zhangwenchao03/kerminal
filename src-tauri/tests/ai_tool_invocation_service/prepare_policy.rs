//! AI 工具调用受控执行服务集成测试分组。
//!
//! @author kongweiguang

use super::support::*;
use serde_json::json;

#[test]
fn prepare_with_settings_rejects_destructive_tools_by_default() {
    let (_home, state) = setup_state();

    let error = prepare_with_current_settings(
        &state,
        prepare_request(
            "sftp.delete",
            json!({
                "directory": false,
                "hostId": "dev-server",
                "path": "/tmp/kerminal-ai-preview.tmp"
            }),
        ),
    )
    .expect_err("destructive tools should be disabled by default");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("破坏性工具")));
}

#[test]
fn prepare_with_settings_allows_destructive_tools_after_opt_in() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.allow_destructive_tools = true);

    let pending = prepare_with_current_settings(
        &state,
        prepare_request(
            "sftp.delete",
            json!({
                "directory": false,
                "hostId": "dev-server",
                "path": "/tmp/kerminal-ai-preview.tmp"
            }),
        ),
    )
    .expect("destructive tools are allowed after explicit opt-in");

    assert_eq!(pending.tool_id, "sftp.delete");
    assert_eq!(pending.risk, ToolRiskLevel::Destructive);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
}

#[test]
fn prepare_with_settings_can_auto_remote_tools_when_remote_approval_is_disabled() {
    let (_home, state) = setup_state();
    update_ai_policy(&state, |ai| ai.require_remote_approval = false);

    let pending = prepare_with_current_settings(
        &state,
        prepare_request(
            "ssh.connect",
            json!({ "hostId": "host-dev", "cols": 120, "rows": 32 }),
        ),
    )
    .expect("remote tools can become auto after policy change");

    assert_eq!(pending.tool_id, "ssh.connect");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Auto);
    assert!(!pending.requires_confirmation);
}

#[test]
fn custom_mcp_stdio_tool_is_discovered_prepared_called_and_audited() {
    let (home, state) = setup_state();
    let script = write_fake_mcp_stdio_server(&home);
    let server = CustomMcpServerSetting {
        args: vec![script.to_string_lossy().to_string()],
        bearer_token_env_var: String::new(),
        command: "node".to_owned(),
        description: "测试 stdio MCP server".to_owned(),
        enabled: true,
        env: Vec::new(),
        headers: Vec::new(),
        id: "custom.echo".to_owned(),
        last_discovered_at: None,
        last_discovery_error: None,
        name: "Custom Echo MCP".to_owned(),
        tools: Vec::new(),
        transport: CustomMcpTransportKind::Stdio,
        url: String::new(),
    };
    let discovered_tools =
        tauri::async_runtime::block_on(discover_mcp_server_tools(server.clone()))
            .expect("discover stdio mcp tools");
    assert_eq!(discovered_tools.len(), 1);
    assert_eq!(discovered_tools[0].name, "echo");

    let mut settings = state
        .settings()
        .load_settings(state.storage())
        .expect("load settings");
    settings.ai.mcp = AiMcpSettings {
        servers: vec![CustomMcpServerSetting {
            tools: discovered_tools,
            last_discovered_at: Some(123),
            ..server
        }],
        skill_directories: Vec::new(),
    };
    state
        .settings()
        .update_settings(state.storage(), settings)
        .expect("save custom mcp settings");

    let pending = prepare_with_current_settings(
        &state,
        prepare_request("custom.echo.echo", json!({ "text": "hello" })),
    )
    .expect("prepare custom mcp tool");
    assert_eq!(pending.tool_id, "custom.echo.echo");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);

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
        .expect("confirm custom mcp tool");

    assert_eq!(audit.tool_id, "custom.echo.echo");
    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert!(audit
        .result_summary
        .as_deref()
        .unwrap_or_default()
        .contains("echo:hello"));
    assert!(audit.error.is_none());
}

#[test]
fn prepare_rejects_unknown_tool() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("missing.tool", json!({ "value": true })),
        )
        .expect_err("unknown tool should fail");

    assert!(matches!(error, AppError::NotFound(message) if message.contains("missing.tool")));
}

#[test]
fn prepare_rejects_disabled_tool() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workflow.run", json!({ "workflowId": "wf-1" })),
        )
        .expect_err("disabled tool should fail");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("未启用")));
}

#[test]
fn prepare_rejects_missing_required_argument() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("terminal.write", json!({ "sessionId": "session-1" })),
        )
        .expect_err("missing data argument should fail");

    assert!(
        matches!(error, AppError::InvalidInput(message) if message.contains("缺少必填参数: data"))
    );
}

#[test]
fn prepare_returns_pending_invocation_with_policy_and_redacted_summary() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.write",
                json!({
                    "sessionId": "session-1",
                    "data": "echo kerminal",
                    "apiToken": "secret-token",
                }),
            ),
        )
        .expect("prepare terminal write");

    assert_eq!(pending.tool_id, "terminal.write");
    assert_eq!(pending.tool_title, "写入终端");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert_eq!(pending.status, AiToolInvocationStatus::Pending);
    assert!(pending.arguments_summary.contains("data=echo kerminal"));
    assert!(pending.arguments_summary.contains("apiToken=[已脱敏]"));
    assert!(pending.risk_summary.is_none());
}

#[test]
fn prepare_escalates_dangerous_terminal_write_to_destructive_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.write",
                json!({ "sessionId": "session-1", "data": "sudo rm -rf /tmp/kerminal-smoke\r" }),
            ),
        )
        .expect("prepare dangerous terminal write");

    assert_eq!(pending.risk, ToolRiskLevel::Destructive);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
    let risk_summary = pending.risk_summary.expect("risk summary");
    assert!(risk_summary.contains("递归强制删除"));
    assert!(risk_summary.contains("权限提升"));
}

#[test]
fn prepare_workspace_split_returns_safe_client_action() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.split_pane", json!({ "direction": "horizontal" })),
        )
        .expect("prepare workspace split");

    assert_eq!(pending.tool_id, "workspace.split_pane");
    assert_eq!(pending.tool_title, "分割当前分屏");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    let client_action = pending.client_action.expect("client action");
    assert_eq!(
        client_action.kind,
        AiToolClientActionKind::WorkspaceSplitPane
    );
    assert_eq!(client_action.direction.as_deref(), Some("horizontal"));
}

#[test]
fn prepare_workspace_focus_tab_returns_safe_client_action() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.focus_tab", json!({ "tabId": "tab-remote" })),
        )
        .expect("prepare workspace focus tab");

    assert_eq!(pending.tool_id, "workspace.focus_tab");
    assert_eq!(pending.tool_title, "切换终端 tab");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(pending.requires_confirmation);
    assert_eq!(pending.arguments_summary, "tabId=tab-remote");
    let client_action = pending.client_action.expect("client action");
    assert_eq!(
        client_action.kind,
        AiToolClientActionKind::WorkspaceFocusTab
    );
    assert_eq!(client_action.tab_id.as_deref(), Some("tab-remote"));
}

#[test]
fn prepare_workspace_open_tool_returns_safe_client_action() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.open_tool", json!({ "toolId": "sftp" })),
        )
        .expect("prepare workspace open tool");

    assert_eq!(pending.tool_id, "workspace.open_tool");
    assert_eq!(pending.tool_title, "打开工具面板");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(pending.requires_confirmation);
    assert_eq!(pending.arguments_summary, "toolId=sftp");
    let client_action = pending.client_action.expect("client action");
    assert_eq!(
        client_action.kind,
        AiToolClientActionKind::WorkspaceOpenTool
    );
    assert_eq!(client_action.tool_id.as_deref(), Some("sftp"));
}

#[test]
fn prepare_terminal_create_returns_safe_client_action() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "terminal.create",
                json!({
                    "cols": 120,
                    "rows": 32,
                    "title": "AI 本地终端",
                    "shell": "pwsh.exe",
                    "args": ["-NoLogo"],
                    "env": { "TERM": "xterm-256color" }
                }),
            ),
        )
        .expect("prepare terminal create");

    assert_eq!(pending.tool_id, "terminal.create");
    assert_eq!(pending.tool_title, "新建终端");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("title=AI 本地终端"));

    let client_action = pending.client_action.expect("client action");
    assert_eq!(client_action.kind, AiToolClientActionKind::TerminalCreate);
    assert_eq!(client_action.title.as_deref(), Some("AI 本地终端"));
    assert_eq!(client_action.shell.as_deref(), Some("pwsh.exe"));
    assert_eq!(
        client_action.args.as_deref(),
        Some(&["-NoLogo".to_owned()][..])
    );
    assert_eq!(
        client_action.env.as_ref().and_then(|env| env.get("TERM")),
        Some(&"xterm-256color".to_owned())
    );
    assert_eq!(client_action.cols, Some(120));
    assert_eq!(client_action.rows, Some(32));
}

#[test]
fn prepare_terminal_create_rejects_invalid_dimensions() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("terminal.create", json!({ "cols": 0, "rows": 24 })),
        )
        .expect_err("zero cols should fail");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("cols")));
}

#[test]
fn prepare_ssh_connect_returns_safe_client_action() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.connect",
                json!({ "hostId": "host-dev", "cols": 120, "rows": 32 }),
            ),
        )
        .expect("prepare ssh connect");

    assert_eq!(pending.tool_id, "ssh.connect");
    assert_eq!(pending.tool_title, "打开 SSH 终端");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=host-dev"));

    let client_action = pending.client_action.expect("client action");
    assert_eq!(client_action.kind, AiToolClientActionKind::SshConnect);
    assert_eq!(client_action.host_id.as_deref(), Some("host-dev"));
    assert_eq!(client_action.cols, Some(120));
    assert_eq!(client_action.rows, Some(32));
}

#[test]
fn prepare_ssh_connect_rejects_invalid_dimensions() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("ssh.connect", json!({ "hostId": "host-dev", "cols": 80 })),
        )
        .expect_err("missing rows should fail");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("rows")));
}

#[test]
fn prepare_ssh_command_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.command",
                json!({
                    "hostId": "dev-server",
                    "command": "uname -a && df -h /",
                    "timeoutSeconds": 30,
                    "maxOutputBytes": 4096
                }),
            ),
        )
        .expect("prepare ssh command");

    assert_eq!(pending.tool_id, "ssh.command");
    assert_eq!(pending.tool_title, "执行远程命令");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("hostId=dev-server"));
    assert!(pending.arguments_summary.contains("command=uname -a"));
    assert!(pending.client_action.is_none());
}

#[test]
fn prepare_dangerous_ssh_command_escalates_to_destructive_full_audit() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.command",
                json!({
                    "hostId": "dev-server",
                    "command": "sudo rm -rf /tmp/kerminal-smoke"
                }),
            ),
        )
        .expect("prepare dangerous ssh command");

    assert_eq!(pending.tool_id, "ssh.command");
    assert_eq!(pending.risk, ToolRiskLevel::Destructive);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Full);
    let risk_summary = pending.risk_summary.expect("risk summary");
    assert!(risk_summary.contains("远程命令风险"));
    assert!(risk_summary.contains("递归强制删除"));
    assert!(risk_summary.contains("权限提升"));
}

#[test]
fn prepare_resolved_host_ssh_command_requires_remote_confirmation() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.command_on_resolved_host",
                json!({
                    "groupName": "bwy",
                    "host": "172.16.40.104",
                    "username": "root",
                    "command": "uname -a && df -h /"
                }),
            ),
        )
        .expect("prepare resolved host ssh command");

    assert_eq!(pending.tool_id, "ssh.command_on_resolved_host");
    assert_eq!(pending.tool_title, "解析目标后执行远程命令");
    assert_eq!(pending.risk, ToolRiskLevel::Remote);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("groupName=bwy"));
    assert!(pending.arguments_summary.contains("command=uname -a"));
    assert!(pending.client_action.is_none());
}

#[test]
fn prepare_dangerous_resolved_host_ssh_command_escalates_to_destructive_full_audit() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "ssh.command_on_resolved_host",
                json!({
                    "host": "172.16.40.104",
                    "command": "sudo rm -rf /tmp/kerminal-smoke"
                }),
            ),
        )
        .expect("prepare dangerous resolved host ssh command");

    assert_eq!(pending.tool_id, "ssh.command_on_resolved_host");
    assert_eq!(pending.risk, ToolRiskLevel::Destructive);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Always);
    assert_eq!(pending.audit, ToolAuditPolicy::Full);
    let risk_summary = pending.risk_summary.expect("risk summary");
    assert!(risk_summary.contains("远程命令风险"));
    assert!(risk_summary.contains("递归强制删除"));
    assert!(risk_summary.contains("权限提升"));
}

#[test]
fn prepare_workspace_split_rejects_unknown_direction() {
    let (_home, state) = setup_state();

    let error = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request("workspace.split_pane", json!({ "direction": "diagonal" })),
        )
        .expect_err("unknown split direction should fail");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("horizontal")));
}

#[test]
fn prepare_profile_create_redacts_nested_sensitive_env_summary() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "profile.create",
                json!({
                    "name": "AI 临时 Profile",
                    "shell": "pwsh.exe",
                    "args": ["-NoLogo"],
                    "env": {
                        "API_TOKEN": "secret-token",
                        "TERM": "xterm-256color"
                    },
                    "setDefault": false
                }),
            ),
        )
        .expect("prepare profile create");

    assert_eq!(pending.tool_id, "profile.create");
    assert_eq!(pending.tool_title, "创建终端配置");
    assert!(pending.arguments_summary.contains("name=AI 临时 Profile"));
    assert!(pending.arguments_summary.contains("env={"));
    assert!(pending.arguments_summary.contains("API_TOKEN=[已脱敏]"));
    assert!(pending.arguments_summary.contains("TERM=xterm-256color"));
}

#[test]
fn prepare_snippet_create_uses_write_policy_and_redacts_command_summary() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "snippet.create",
                json!({
                    "title": "带密钥的检查命令",
                    "command": "echo token=secret-value",
                    "description": "不会自动执行",
                    "tags": ["secret", "daily"],
                    "scope": "local"
                }),
            ),
        )
        .expect("prepare snippet create");

    assert_eq!(pending.tool_id, "snippet.create");
    assert_eq!(pending.tool_title, "创建脚本片段");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("title=带密钥的检查命令"));
    assert!(pending
        .arguments_summary
        .contains("command=echo token=[已脱敏]"));
    assert!(!pending.arguments_summary.contains("secret-value"));
}

#[test]
fn prepare_workflow_create_uses_write_policy_and_redacts_step_commands() {
    let (_home, state) = setup_state();

    let pending = state
        .ai_tools()
        .prepare(
            state.tools(),
            prepare_request(
                "workflow.create",
                json!({
                    "title": "带密钥的质量检查",
                    "description": "保存多步骤流程，不会自动执行",
                    "tags": ["secret", "quality"],
                    "scope": "local",
                    "steps": [
                        {
                            "title": "检查状态",
                            "command": "echo token=secret-value",
                            "requiresConfirmation": false
                        },
                        {
                            "title": "运行门禁",
                            "command": "npm run check",
                            "requiresConfirmation": true
                        }
                    ]
                }),
            ),
        )
        .expect("prepare workflow create");

    assert_eq!(pending.tool_id, "workflow.create");
    assert_eq!(pending.tool_title, "创建命令工作流");
    assert_eq!(pending.risk, ToolRiskLevel::Write);
    assert_eq!(pending.confirmation, ToolConfirmationPolicy::Contextual);
    assert_eq!(pending.audit, ToolAuditPolicy::Summary);
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("title=带密钥的质量检查"));
    assert!(pending.arguments_summary.contains("steps=[2 项]"));
    assert!(!pending.arguments_summary.contains("secret-value"));
}
