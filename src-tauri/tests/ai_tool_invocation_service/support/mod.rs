//! AI 工具调用受控执行服务集成测试。
//!
//! @author kongweiguang

pub(crate) use std::fs;
pub(crate) use std::path::PathBuf;

pub(crate) use kerminal_lib::{
    error::AppError,
    models::{
        ai_tool_invocation::{
            AiToolAuditListRequest, AiToolAuditRecord, AiToolClientActionKind,
            AiToolConfirmRequest, AiToolInvocationStatus, AiToolPrepareRequest,
        },
        command_history::{
            CommandHistoryRecordRequest, CommandHistorySource, CommandHistoryTarget,
        },
        remote_host::{
            RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroup,
            RemoteHostGroupCreateRequest,
        },
        server_info::ServerInfoSnapshot,
        settings::{AiMcpSettings, CustomMcpServerSetting, CustomMcpTransportKind, ThemeMode},
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind, SftpFilePreview},
        snippet::SnippetScope,
        ssh_command::SshCommandOutput,
        terminal::TerminalCreateRequest,
        tool_registry::{ToolAuditPolicy, ToolConfirmationPolicy, ToolRiskLevel},
        workflow::WorkflowScope,
    },
    paths::KerminalPaths,
    services::ai_tool_invocation_service::{
        summarize_server_info_snapshot_for_ai, summarize_sftp_listing_for_ai,
        summarize_sftp_preview_for_ai, summarize_ssh_command_output_for_ai, AiToolExecutionContext,
    },
    services::mcp_discovery_service::discover_mcp_server_tools,
    state::AppState,
};
use serde_json::json;
use tempfile::{tempdir, TempDir};

pub(crate) fn setup_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .map(|state| (home, state))
        .expect("initialize app state")
}

pub(crate) fn write_fake_mcp_stdio_server(home: &TempDir) -> PathBuf {
    let script = home.path().join("fake-mcp-server.js");
    fs::write(
        &script,
        r#"const readline = require("node:readline");

const rl = readline.createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp", version: "1.0.0" }
      }
    });
    return;
  }
  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [{
          name: "echo",
          title: "Echo",
          description: "Echo text",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"]
          }
        }]
      }
    });
    return;
  }
  if (request.method === "tools/call") {
    const text = request.params?.arguments?.text ?? "";
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: `echo:${text}` }],
        isError: false
      }
    });
    return;
  }
  if (request.id !== undefined && request.method) {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
  }
});
"#,
    )
    .expect("write fake mcp server");
    script
}

pub(crate) fn prepare_request(tool_id: &str, arguments: serde_json::Value) -> AiToolPrepareRequest {
    AiToolPrepareRequest {
        tool_id: tool_id.to_owned(),
        arguments,
        requested_by: Some("test-agent".to_owned()),
        reason: Some("验证受控工具调用链路".to_owned()),
    }
}

pub(crate) fn prepare_with_current_settings(
    state: &AppState,
    request: AiToolPrepareRequest,
) -> kerminal_lib::error::AppResult<kerminal_lib::models::ai_tool_invocation::AiToolPendingInvocation>
{
    state.ai_tools().prepare_with_settings(
        state.tools(),
        state.settings(),
        state.storage(),
        request,
    )
}

pub(crate) fn update_ai_policy(
    state: &AppState,
    update: impl FnOnce(&mut kerminal_lib::models::settings::AiSecuritySettings),
) {
    let mut settings = state
        .settings()
        .load_settings(state.storage())
        .expect("load settings");
    update(&mut settings.ai);
    state
        .settings()
        .update_settings(state.storage(), settings)
        .expect("update ai policy settings");
}

pub(crate) fn create_test_remote_host(state: &AppState) -> String {
    let group = create_test_remote_host_group(state);
    state
        .remote_hosts()
        .create_host(
            state.storage(),
            RemoteHostCreateRequest {
                group_id: Some(group.id),
                name: "dev ssh".to_owned(),
                host: "dev.internal".to_owned(),
                port: 22,
                username: "deploy".to_owned(),
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                credential_secret: None,
                tags: vec!["dev".to_owned()],
                production: false,
                ssh_options: Default::default(),
            },
        )
        .expect("create test host")
        .id
}

pub(crate) fn create_test_remote_host_group(state: &AppState) -> RemoteHostGroup {
    state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "虚拟机".to_owned(),
            },
        )
        .expect("create test group")
}

pub(crate) fn ai_tool_execution_context(state: &AppState) -> AiToolExecutionContext<'_> {
    AiToolExecutionContext {
        terminals: state.terminals(),
        command_history: state.command_history(),
        credentials: state.credentials(),
        settings: state.settings(),
        profiles: state.profiles(),
        remote_hosts: state.remote_hosts(),
        rig_providers: state.rig_providers(),
        server_info: state.server_info(),
        diagnostics: state.diagnostics(),
        sftp: state.sftp(),
        port_forwards: state.port_forwards(),
        snippets: state.snippets(),
        workflows: state.workflows(),
        ssh_commands: state.ssh_commands(),
        paths: state.paths(),
        storage: state.storage(),
    }
}

pub(crate) fn confirm_tool(
    state: &AppState,
    tool_id: &str,
    arguments: serde_json::Value,
) -> AiToolAuditRecord {
    let pending = prepare_with_current_settings(state, prepare_request(tool_id, arguments))
        .unwrap_or_else(|error| panic!("prepare {tool_id}: {error}"));
    state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(state),
            AiToolConfirmRequest {
                invocation_id: pending.id,
                approved: true,
            },
        )
        .unwrap_or_else(|error| panic!("confirm {tool_id}: {error}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn interactive_shell_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/Q".to_owned(), "/K".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn interactive_shell_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

pub(crate) fn sample_arguments_for_tool(tool_id: &str) -> serde_json::Value {
    match tool_id {
        "terminal.create" => json!({ "cols": 100, "rows": 30 }),
        "terminal.write" => json!({ "sessionId": "session-1", "data": "echo ai\n" }),
        "terminal.resize" => json!({ "sessionId": "session-1", "cols": 100, "rows": 30 }),
        "terminal.list" => json!({}),
        "terminal.close" => json!({ "sessionId": "session-1" }),
        "terminal.log.start" => json!({ "sessionId": "session-1" }),
        "terminal.log.stop" => json!({ "sessionId": "session-1" }),
        "terminal.log.state" => json!({ "sessionId": "session-1" }),
        "workspace.split_pane" => json!({ "direction": "horizontal" }),
        "workspace.focus_tab" => json!({ "tabId": "tab-1" }),
        "workspace.open_tool" => json!({ "toolId": "ai" }),
        "settings.get" => json!({}),
        "settings.update_theme" => json!({ "themeMode": "dark" }),
        "settings.update_terminal_appearance" => json!({ "fontSize": 14 }),
        "settings.update_ai_security" => json!({
            "contextMaxOutputBytes": 12288,
            "includeCommandHistory": true,
            "requireRemoteApproval": true,
            "allowDestructiveTools": true,
            "commandApprovalPolicy": "risky",
            "commandTimeoutSeconds": 45,
            "terminalTailLines": 80,
            "customInstructions": "测试策略"
        }),
        "llm_provider.list" => json!({}),
        "llm_provider.create" => json!({
            "name": "AI Provider",
            "kind": "openAiChat",
            "baseUrl": "https://api.example.com/v1",
            "model": "gpt-test",
            "modelList": ["gpt-test"],
            "temperature": 0.2,
            "contextStrategy": "currentTerminal",
            "contextWindowTokens": 128000,
            "reasoningEffort": "modelDefault",
            "maxRetries": 3,
            "enabled": true,
            "isDefault": false
        }),
        "llm_provider.update" => json!({
            "id": "llm-test",
            "name": "AI Provider Updated",
            "kind": "openAiChat",
            "baseUrl": "https://api.example.com/v1",
            "model": "gpt-test-2",
            "modelList": ["gpt-test-2"],
            "temperature": 0.3,
            "contextStrategy": "currentWorkspace",
            "contextWindowTokens": 128000,
            "reasoningEffort": "low",
            "maxRetries": 2,
            "enabled": true,
            "isDefault": false,
            "clearApiKey": false
        }),
        "llm_provider.delete" => json!({ "id": "llm-test" }),
        "llm_provider.test" => json!({ "id": "llm-test" }),
        "profile.create" => json!({ "name": "AI Profile", "shell": "pwsh.exe" }),
        "profile.list" => json!({}),
        "profile.detect_shells" => json!({}),
        "profile.update" => json!({
            "id": "profile-test",
            "name": "AI Profile Updated",
            "shell": "pwsh.exe",
            "args": [],
            "env": {},
            "setDefault": false,
            "sortOrder": 10
        }),
        "profile.delete" => json!({ "profileId": "profile-test" }),
        "remote_host.create" => json!({
            "name": "AI Host",
            "host": "dev.internal",
            "port": 22,
            "username": "deploy",
            "authType": "agent",
            "tags": ["ai"],
            "production": false
        }),
        "remote_host.group_list" => json!({}),
        "remote_host.tree" => json!({}),
        "remote_host.group_create" => json!({ "name": "AI Group" }),
        "remote_host.group_update" => json!({
            "id": "group-test",
            "name": "AI Group Updated",
            "sortOrder": 10
        }),
        "remote_host.group_delete" => json!({ "groupId": "group-test" }),
        "remote_host.update" => json!({
            "id": "host-test",
            "name": "AI Host Updated",
            "host": "dev.internal",
            "port": 22,
            "username": "deploy",
            "authType": "agent",
            "tags": ["ai"],
            "production": false,
            "sortOrder": 10
        }),
        "remote_host.delete" => json!({ "hostId": "host-test" }),
        "ssh.connect" => json!({ "hostId": "host-test", "cols": 100, "rows": 30 }),
        "ssh.command" => json!({ "hostId": "host-test", "command": "uname -a" }),
        "connection.rdp_open" => json!({
            "name": "AI RDP",
            "host": "rdp.internal",
            "port": 3389,
            "fullscreen": false
        }),
        "sftp.list" => json!({ "hostId": "host-test", "path": "/tmp" }),
        "sftp.rename" => json!({
            "hostId": "host-test",
            "fromPath": "/tmp/a",
            "toPath": "/tmp/b"
        }),
        "sftp.move" => json!({
            "hostId": "host-test",
            "fromPath": "/tmp/a",
            "toPath": "/tmp/b"
        }),
        "sftp.preview" => json!({ "hostId": "host-test", "path": "/tmp/a", "maxBytes": 512 }),
        "sftp.create_directory" => json!({ "hostId": "host-test", "path": "/tmp/ai" }),
        "sftp.chmod" => json!({ "hostId": "host-test", "path": "/tmp/a", "mode": "0644" }),
        "sftp.upload" => json!({
            "hostId": "host-test",
            "localPath": "C:/tmp/a",
            "remotePath": "/tmp/a"
        }),
        "sftp.upload_directory" => json!({
            "hostId": "host-test",
            "localPath": "C:/tmp/dir",
            "remotePath": "/tmp/dir"
        }),
        "sftp.download" => json!({
            "hostId": "host-test",
            "remotePath": "/tmp/a",
            "localPath": "C:/tmp/a"
        }),
        "sftp.download_directory" => json!({
            "hostId": "host-test",
            "remotePath": "/tmp/dir",
            "localPath": "C:/tmp/dir"
        }),
        "sftp.delete" => json!({ "hostId": "host-test", "path": "/tmp/a", "directory": false }),
        "sftp.transfer.enqueue" => json!({
            "hostId": "host-test",
            "remotePath": "/tmp/a",
            "localPath": "C:/tmp/a",
            "direction": "download",
            "kind": "file"
        }),
        "sftp.transfer.list" => json!({}),
        "sftp.transfer.cancel" => json!({ "transferId": "transfer-test" }),
        "sftp.transfer.clear_completed" => json!({}),
        "server_info.snapshot" => json!({ "hostId": "host-test" }),
        "diagnostics.runtime_health" => json!({}),
        "diagnostics.create_bundle" => json!({}),
        "port_forward.create" => json!({
            "hostId": "host-test",
            "kind": "local",
            "sourcePort": 18080,
            "targetHost": "127.0.0.1",
            "targetPort": 80
        }),
        "port_forward.list" => json!({}),
        "port_forward.close" => json!({ "forwardId": "forward-test" }),
        "snippet.create" => json!({
            "title": "AI Snippet",
            "command": "echo ai",
            "scope": "local"
        }),
        "snippet.list" => json!({ "query": "AI", "scope": "local" }),
        "snippet.update" => json!({
            "id": "snippet-test",
            "title": "AI Snippet Updated",
            "command": "echo ai",
            "scope": "local",
            "sortOrder": 10
        }),
        "snippet.delete" => json!({ "snippetId": "snippet-test" }),
        "workflow.create" => json!({
            "title": "AI Workflow",
            "scope": "local",
            "steps": [{ "title": "one", "command": "echo one" }]
        }),
        "workflow.list" => json!({ "query": "AI", "scope": "local" }),
        "workflow.update" => json!({
            "id": "workflow-test",
            "title": "AI Workflow Updated",
            "scope": "local",
            "sortOrder": 10,
            "steps": [{ "title": "one", "command": "echo one" }]
        }),
        "workflow.delete" => json!({ "workflowId": "workflow-test" }),
        "history.search" => json!({ "query": "echo", "target": "local", "limit": 5 }),
        "history.record" => json!({ "command": "echo ai", "source": "tool", "target": "local" }),
        "history.delete" => json!({ "entryId": "history-test" }),
        "history.clear" => json!({}),
        other => panic!("missing sample arguments for enabled tool {other}"),
    }
}
