//! Streamable HTTP MCP Server smoke tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::{
        agent_session::{AgentId, AgentSessionCreateRequest},
        mcp_server::{McpHttpServerStartRequest, McpToolAnnotations, ToolCategory, ToolDefinition},
    },
    paths::KerminalPaths,
    services::{
        external_agent_workspace::{
            ExternalAgentWorkspaceService, PrepareExternalAgentWorkspaceRequest,
        },
        mcp_streamable_http_server::rules,
    },
    state::AppState,
};
use rmcp::{
    model::{CallToolRequestParams, ClientInfo},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
    },
    ServiceExt,
};
use serde_json::Value;
use tauri::Manager;

#[tokio::test]
async fn generated_codex_and_claude_configs_connect_to_tools_list() {
    install_test_rustls_provider();

    let home = tempfile::tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();

    let status = state
        .mcp_http_server()
        .start(
            app.handle().clone(),
            Some(McpHttpServerStartRequest {
                host: Some("127.0.0.1".to_owned()),
                port: Some(0),
            }),
        )
        .await
        .expect("start mcp server");
    let endpoint = status.endpoint.clone().expect("endpoint");

    let workspace = ExternalAgentWorkspaceService::new(&paths.root, Some(endpoint.clone()), true);
    let codex_spec = workspace
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: Default::default(),
        })
        .expect("prepare codex");
    let claude_spec = workspace
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: Default::default(),
        })
        .expect("prepare claude");

    assert_launch_command(&codex_spec.shell, &codex_spec.args, "codex");
    assert_launch_command(&claude_spec.shell, &claude_spec.args, "claude");
    assert_eq!(codex_spec.cwd, path_to_string(&paths.root));
    assert_eq!(claude_spec.cwd, path_to_string(&paths.root));

    let codex_config =
        fs::read_to_string(paths.root.join(".codex").join("config.toml")).expect("codex config");
    assert!(codex_config.contains("[mcp_servers.kerminal]"));
    assert!(codex_config.contains(&format!("url = \"{endpoint}\"")));
    assert!(codex_config.contains("default_tools_approval_mode = \"prompt\""));

    let claude_config = fs::read_to_string(paths.root.join(".mcp.json")).expect("claude mcp json");
    let claude_root: Value = serde_json::from_str(&claude_config).expect("parse claude mcp json");
    assert_eq!(
        claude_root
            .pointer("/mcpServers/kerminal/type")
            .and_then(Value::as_str),
        Some("http")
    );
    assert_eq!(
        claude_root
            .pointer("/mcpServers/kerminal/url")
            .and_then(Value::as_str),
        Some(endpoint.as_str())
    );

    let client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(endpoint.clone()),
        ))
        .await
        .expect("connect mcp client");
    let tools = client
        .peer()
        .list_tools(None)
        .await
        .expect("list tools through mcp endpoint");

    assert!(
        tools.tools.iter().any(|tool| tool.name == "terminal.write"),
        "expected terminal.write in tools/list"
    );
    assert!(
        tools.tools.iter().any(|tool| tool.name == "ssh.command"),
        "expected ssh.command in tools/list"
    );
    assert!(
        tools.tools.iter().any(|tool| tool.name == "history.search"),
        "expected history.search in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "diagnostics.runtime_health"),
        "expected diagnostics.runtime_health in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.config.validate"),
        "expected kerminal.config.validate in tools/list"
    );
    for removed_tool in [
        "remote_host.tree",
        "settings.get",
        "profile.list",
        "snippet.create",
        "workflow.run",
        "terminal.create",
        "workspace.focus_tab",
        "history.clear",
    ] {
        assert!(
            tools.tools.iter().all(|tool| tool.name != removed_tool),
            "{removed_tool} must stay out of tools/list"
        );
    }

    let config_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator through mcp endpoint");
    assert_eq!(config_validation.is_error, Some(false));
    assert_eq!(
        config_validation
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/valid"))
            .and_then(Value::as_bool),
        Some(true)
    );

    fs::create_dir_all(paths.root.join("secrets/hosts")).expect("host secrets dir");
    fs::write(
        paths.root.join("secrets/hosts/agent-added.toml"),
        r#"schema_version = 1
id = "agent-added"
password = "<redacted-test-secret>"
"#,
    )
    .expect("write host secret with legacy password key");
    let bad_secret_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator for bad host secret");
    assert_eq!(bad_secret_validation.is_error, Some(false));
    let bad_secret_payload = bad_secret_validation
        .structured_content
        .as_ref()
        .expect("structured bad secret validation content");
    assert_eq!(
        bad_secret_payload
            .pointer("/data/valid")
            .and_then(Value::as_bool),
        Some(false)
    );
    let diagnostics = bad_secret_payload
        .pointer("/data/diagnostics")
        .and_then(Value::as_array)
        .expect("bad secret diagnostics");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic
                .pointer("/severity")
                .and_then(Value::as_str)
                .is_some_and(|severity| severity == "error")
                && diagnostic
                    .pointer("/message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| {
                        message.contains("password")
                            && message.contains("credential_secret")
                            && !message.contains("<redacted-test-secret>")
                    })
        }),
        "expected host secret password diagnostic, got {diagnostics:?}"
    );
    fs::remove_file(paths.root.join("secrets/hosts/agent-added.toml"))
        .expect("remove bad host secret");

    fs::create_dir_all(paths.root.join("hosts")).expect("hosts dir");
    fs::write(
        paths.root.join("hosts/agent-added.toml"),
        r#"schema_version = 1
id = "agent-added"
name = "Agent Added"
host = "agent-added.internal"
port = 22
username = "deploy"
auth_type = "agent"
tags = []
sort_order = 99
created_at = "1"
updated_at = "1"
"#,
    )
    .expect("write host missing production");
    let warning_config_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator for host warning");
    assert_eq!(warning_config_validation.is_error, Some(false));
    let warning_payload = warning_config_validation
        .structured_content
        .as_ref()
        .expect("structured config validation content");
    assert_eq!(
        warning_payload
            .pointer("/data/valid")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        warning_payload
            .pointer("/data/warningCount")
            .and_then(Value::as_u64),
        Some(1)
    );
    let diagnostics = warning_payload
        .pointer("/data/diagnostics")
        .and_then(Value::as_array)
        .expect("diagnostics");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic
                .pointer("/severity")
                .and_then(Value::as_str)
                .is_some_and(|severity| severity == "warning")
                && diagnostic
                    .pointer("/message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("production must be explicitly set"))
        }),
        "expected missing production diagnostic, got {diagnostics:?}"
    );
    fs::write(
        paths.root.join("hosts/agent-added.toml"),
        r#"schema_version = 1
id = "agent-added"
name = "Agent Added"
host = "agent-added.internal"
port = 22
username = "deploy"
auth_type = "agent"
production = "yes"
tags = []
sort_order = 99
created_at = "1"
updated_at = "1"
"#,
    )
    .expect("write host invalid production");
    let invalid_config_validation = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config.validate"))
        .await
        .expect("call config validator for invalid host");
    assert_eq!(invalid_config_validation.is_error, Some(false));
    let invalid_payload = invalid_config_validation
        .structured_content
        .as_ref()
        .expect("structured invalid config validation content");
    assert_eq!(
        invalid_payload
            .pointer("/data/valid")
            .and_then(Value::as_bool),
        Some(false)
    );
    let diagnostics = invalid_payload
        .pointer("/data/diagnostics")
        .and_then(Value::as_array)
        .expect("invalid diagnostics");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic
                .pointer("/severity")
                .and_then(Value::as_str)
                .is_some_and(|severity| severity == "error")
                && diagnostic
                    .pointer("/message")
                    .and_then(Value::as_str)
                    .is_some_and(|message| message.contains("production must be a boolean"))
        }),
        "expected invalid production diagnostic, got {diagnostics:?}"
    );

    let agent_session = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("Codex".to_owned()),
            launch: None,
            target: None,
            provider: None,
            mcp_endpoint: Some(format!("{endpoint}/agents/ags_test_scoped")),
        })
        .expect("create scoped agent session");
    let agent_session_id = agent_session.session.agent_session_id.as_str().to_owned();

    let session_spec = workspace
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.clone()),
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: Default::default(),
        })
        .expect("prepare scoped codex session");
    let scoped_endpoint = session_spec
        .env
        .as_ref()
        .and_then(|env| env.get("KERMINAL_MCP_ENDPOINT"))
        .expect("session-scoped MCP endpoint")
        .clone();
    assert_eq!(
        scoped_endpoint,
        format!("{endpoint}/agents/{agent_session_id}")
    );
    let scoped_client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(scoped_endpoint),
        ))
        .await
        .expect("connect scoped mcp client");
    let scoped_tools = scoped_client
        .peer()
        .list_tools(None)
        .await
        .expect("list tools through scoped mcp endpoint");
    assert!(
        scoped_tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.agent.target_context"),
        "expected agent target context tool through scoped endpoint"
    );
    let current_session = scoped_client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.agent.current_session"))
        .await
        .expect("call current session through scoped endpoint without explicit agentSessionId");
    assert_eq!(current_session.is_error, Some(false));
    assert_eq!(
        current_session
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/agentSession/session/agent_session_id"))
            .and_then(Value::as_str),
        Some(agent_session_id.as_str())
    );

    let mut mismatched_arguments = serde_json::Map::new();
    mismatched_arguments.insert(
        "agentSessionId".to_owned(),
        Value::String("ags_other_session".to_owned()),
    );
    let mismatched_session = scoped_client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.agent.current_session")
                .with_arguments(mismatched_arguments),
        )
        .await;
    assert!(
        format!("{mismatched_session:?}").contains("does not match scoped MCP endpoint"),
        "expected scoped endpoint to reject mismatched agentSessionId, got {mismatched_session:?}"
    );

    let mut direct_write_arguments = serde_json::Map::new();
    direct_write_arguments.insert(
        "sessionId".to_owned(),
        Value::String("other-terminal-session".to_owned()),
    );
    direct_write_arguments.insert("data".to_owned(), Value::String("echo scoped\n".to_owned()));
    let direct_write = scoped_client
        .peer()
        .call_tool(
            CallToolRequestParams::new("terminal.write").with_arguments(direct_write_arguments),
        )
        .await
        .expect("scoped terminal.write returns a tool error");
    assert_eq!(direct_write.is_error, Some(true));
    assert!(
        format!("{direct_write:?}").contains("不能同时提供 sessionId"),
        "expected scoped terminal.write to reject explicit sessionId bypass, got {direct_write:?}"
    );
    let _ = scoped_client.cancel().await;

    let _ = client.cancel().await;
    state.mcp_http_server().stop().expect("stop mcp server");
}

#[test]
fn filters_disabled_or_unexposed_tools_from_external_mcp_surface() {
    let mut disabled = tool("terminal.list");
    disabled.enabled = false;

    let mut internal = tool("diagnostics.runtime_health");
    internal.exposed_to_mcp = false;

    assert!(!rules::is_externally_callable_tool(&disabled));
    assert!(!rules::is_externally_callable_tool(&internal));
    assert!(rules::is_externally_callable_tool(&tool("history.search")));
}

#[test]
fn only_accepts_loopback_bind_addresses() {
    assert_eq!(
        rules::normalize_bind_address(None).unwrap(),
        rules::default_bind_address().to_owned()
    );
    assert_eq!(
        rules::normalize_bind_address(Some("localhost")).unwrap(),
        rules::default_bind_address().to_owned()
    );
    assert!(rules::normalize_bind_address(Some("0.0.0.0")).is_err());
}

#[test]
fn uses_fixed_default_mcp_http_port() {
    assert_eq!(
        rules::requested_start_port(None),
        rules::default_mcp_http_port()
    );
    assert_eq!(
        rules::requested_start_port(Some(0)),
        rules::default_mcp_http_port()
    );
    assert_eq!(rules::requested_start_port(Some(48123)), 48123);
}

#[tokio::test]
async fn moves_to_next_loopback_port_when_start_port_is_occupied() {
    let (occupied, occupied_port) = occupied_loopback_port_below_scan_ceiling().await;

    let (_listener, local_addr) = rules::bind_loopback_port_from(occupied_port).await.unwrap();

    assert!(local_addr.port() > occupied_port);
    assert!(local_addr.port() - occupied_port < rules::mcp_http_port_scan_limit());
    drop(occupied);
}

fn path_to_string(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

fn install_test_rustls_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn assert_launch_command(shell: &str, args: &[String], command: &str) {
    #[cfg(windows)]
    {
        if shell.eq_ignore_ascii_case("cmd.exe") {
            assert_eq!(
                args.iter().map(String::as_str).collect::<Vec<_>>(),
                vec!["/d", "/s", "/k", command]
            );
        } else {
            assert!(
                shell.eq_ignore_ascii_case("pwsh.exe")
                    || shell.eq_ignore_ascii_case("powershell.exe")
            );
            assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("-NoLogo")));
            assert!(args
                .iter()
                .any(|arg| arg.eq_ignore_ascii_case("-NoProfile")));
            assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("-NoExit")));
            let command_index = args
                .iter()
                .position(|arg| arg.eq_ignore_ascii_case("-Command"))
                .expect("PowerShell wrapper includes -Command");
            assert_eq!(
                args.get(command_index + 1).map(String::as_str),
                Some(command)
            );
        }
    }

    #[cfg(not(windows))]
    {
        assert_eq!(shell, command);
        assert!(args.is_empty());
    }
}

fn tool(id: &str) -> ToolDefinition {
    ToolDefinition {
        id: id.to_owned(),
        title: id.to_owned(),
        description: id.to_owned(),
        category: ToolCategory::Terminal,
        annotations: McpToolAnnotations {
            read_only_hint: true,
            idempotent_hint: true,
            ..McpToolAnnotations::default()
        },
        enabled: true,
        exposed_to_mcp: true,
        input_schema: serde_json::json!({"type": "object"}),
    }
}

async fn occupied_loopback_port_below_scan_ceiling() -> (tokio::net::TcpListener, u16) {
    for _ in 0..128 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        if port <= u16::MAX - rules::mcp_http_port_scan_limit() {
            return (listener, port);
        }
    }

    panic!("could not reserve a loopback test port below the scan ceiling");
}
