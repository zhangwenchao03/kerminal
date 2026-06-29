//! Streamable HTTP MCP Server smoke tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    models::{
        agent_session::{AgentId, AgentSessionCreateRequest},
        mcp_server::{McpHttpServerStartRequest, McpToolAnnotations, ToolCategory, ToolDefinition},
        target::RemoteTargetRef,
    },
    paths::KerminalPaths,
    services::{
        external_agent_workspace::{
            ExternalAgentWorkspaceService, PrepareExternalAgentWorkspaceRequest,
        },
        mcp_streamable_http_server::rules,
        mcp_tool_executor_service::rules as executor_rules,
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
    let tool_names = tools
        .tools
        .iter()
        .map(|tool| tool.name.as_ref())
        .collect::<Vec<_>>();
    let expected_tool_ids = [
        "container.files.list",
        "container.files.preview",
        "container.files.write_text",
        "container.files.create_directory",
        "container.files.rename",
        "container.files.chmod",
        "container.files.upload",
        "container.files.download",
        "container.files.delete",
        "container.inspect",
        "container.list",
        "container.logs.tail",
        "container.remove",
        "container.restart",
        "container.start",
        "container.stats",
        "container.stop",
        "diagnostics.create_bundle",
        "diagnostics.runtime_health",
        "history.search",
        "kerminal.agent.current_session",
        "kerminal.agent.target_context",
        "kerminal.app_guide",
        "kerminal.capabilities",
        "kerminal.config_guide",
        "kerminal.config.validate",
        "kerminal.host.upsert_with_credential",
        "kerminal.tool_help",
        "kerminal.operation_guide",
        "kerminal.runtime_snapshot",
        "kerminal.vault.encrypt_secret",
        "port_forward.close",
        "port_forward.create",
        "port_forward.list",
        "server_info.snapshot",
        "sftp.chmod",
        "sftp.create_directory",
        "sftp.delete",
        "sftp.download",
        "sftp.download_directory",
        "sftp.list",
        "sftp.move",
        "sftp.preview",
        "sftp.rename",
        "sftp.transfer.cancel",
        "sftp.transfer.clear_completed",
        "sftp.transfer.enqueue",
        "sftp.transfer.list",
        "sftp.upload",
        "sftp.upload_directory",
        "ssh.command",
        "ssh.command_on_resolved_host",
        "terminal.close",
        "terminal.list",
        "terminal.log.start",
        "terminal.log.state",
        "terminal.log.stop",
        "terminal.resize",
        "terminal.resolve_agent_target",
        "terminal.snapshot",
        "terminal.write",
        "tmux.attach_plan",
        "tmux.capture_pane",
        "tmux.create_session",
        "tmux.kill_session",
        "tmux.list_panes",
        "tmux.list_sessions",
        "tmux.list_windows",
        "tmux.probe",
        "tmux.rename_session",
    ];
    assert_eq!(
        tool_names.len(),
        expected_tool_ids.len(),
        "tools/list changed; update Kerminal MCP capability docs and tests"
    );
    for expected_tool in expected_tool_ids {
        assert!(
            tool_names.contains(&expected_tool),
            "expected {expected_tool} in tools/list"
        );
    }

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
            .any(|tool| tool.name == "kerminal.app_guide"),
        "expected kerminal.app_guide in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.capabilities"),
        "expected kerminal.capabilities in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.config_guide"),
        "expected kerminal.config_guide in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.config.validate"),
        "expected kerminal.config.validate in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.tool_help"),
        "expected kerminal.tool_help in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.operation_guide"),
        "expected kerminal.operation_guide in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.host.upsert_with_credential"),
        "expected kerminal.host.upsert_with_credential in tools/list"
    );
    assert!(
        tools
            .tools
            .iter()
            .any(|tool| tool.name == "kerminal.vault.encrypt_secret"),
        "expected kerminal.vault.encrypt_secret in tools/list"
    );
    for tmux_tool in [
        "tmux.probe",
        "tmux.list_sessions",
        "tmux.capture_pane",
        "tmux.attach_plan",
    ] {
        assert!(
            tools.tools.iter().any(|tool| tool.name == tmux_tool),
            "expected {tmux_tool} in tools/list"
        );
    }
    for container_tool in [
        "container.inspect",
        "container.logs.tail",
        "container.stats",
        "container.start",
        "container.stop",
        "container.restart",
        "container.remove",
        "container.files.write_text",
        "container.files.upload",
        "container.files.download",
        "container.files.delete",
    ] {
        assert!(
            tools.tools.iter().any(|tool| tool.name == container_tool),
            "expected {container_tool} in tools/list"
        );
    }
    assert!(
        tools.tools.iter().any(|tool| {
            tool.name == "container.remove"
                && tool
                    .annotations
                    .as_ref()
                    .and_then(|annotations| annotations.destructive_hint)
                    == Some(true)
        }),
        "container.remove must stay marked destructive"
    );
    assert!(
        tools.tools.iter().any(|tool| {
            tool.name == "container.files.delete"
                && tool
                    .annotations
                    .as_ref()
                    .and_then(|annotations| annotations.destructive_hint)
                    == Some(true)
        }),
        "container.files.delete must stay marked destructive"
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
        "kerminal.host.migrate_legacy_secrets",
    ] {
        assert!(
            tools.tools.iter().all(|tool| tool.name != removed_tool),
            "{removed_tool} must stay out of tools/list"
        );
    }

    let mut host_credential_arguments = serde_json::Map::new();
    host_credential_arguments.insert(
        "name".to_owned(),
        Value::String("Agent Vault Host".to_owned()),
    );
    host_credential_arguments.insert(
        "host".to_owned(),
        Value::String("agent-vault.internal".to_owned()),
    );
    host_credential_arguments.insert("username".to_owned(), Value::String("deploy".to_owned()));
    host_credential_arguments.insert(
        "password".to_owned(),
        Value::String("test-password".to_owned()),
    );
    host_credential_arguments.insert("production".to_owned(), Value::Bool(false));
    let saved_host = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.host.upsert_with_credential")
                .with_arguments(host_credential_arguments),
        )
        .await
        .expect("call host credential upsert through mcp endpoint");
    assert_eq!(saved_host.is_error, Some(false));
    let saved_host_payload = saved_host
        .structured_content
        .as_ref()
        .expect("structured saved host content");
    let saved_host_id = saved_host_payload
        .pointer("/data/hostId")
        .and_then(Value::as_str)
        .expect("saved host id")
        .to_owned();
    assert!(
        saved_host_payload
            .pointer("/data/secretRef")
            .and_then(Value::as_str)
            .is_some_and(|secret_ref| secret_ref.starts_with("credential:kerminal:ssh-host:")),
        "expected host upsert to return vault secret_ref"
    );

    let mut vault_arguments = serde_json::Map::new();
    vault_arguments.insert("kind".to_owned(), Value::String("ssh-host".to_owned()));
    vault_arguments.insert("hostId".to_owned(), Value::String(saved_host_id));
    vault_arguments.insert("scope".to_owned(), Value::String("target".to_owned()));
    vault_arguments.insert("material".to_owned(), Value::String("password".to_owned()));
    vault_arguments.insert(
        "plaintext".to_owned(),
        Value::String("rotated-password".to_owned()),
    );
    let encrypted_secret = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.vault.encrypt_secret")
                .with_arguments(vault_arguments),
        )
        .await
        .expect("call vault encrypt secret through mcp endpoint");
    assert_eq!(encrypted_secret.is_error, Some(false));
    assert!(
        encrypted_secret
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/secretRef"))
            .and_then(Value::as_str)
            .is_some_and(|secret_ref| secret_ref.starts_with("credential:kerminal:ssh-host:")),
        "expected vault encrypt tool to return secret_ref"
    );

    let mut tmux_probe_arguments = serde_json::Map::new();
    tmux_probe_arguments.insert("targetKind".to_owned(), Value::String("local".to_owned()));
    let tmux_probe = client
        .peer()
        .call_tool(CallToolRequestParams::new("tmux.probe").with_arguments(tmux_probe_arguments))
        .await
        .expect("call tmux probe through mcp endpoint");
    assert_eq!(tmux_probe.is_error, Some(false));
    let tmux_probe_payload = tmux_probe
        .structured_content
        .as_ref()
        .expect("structured tmux probe content");
    assert_eq!(
        tmux_probe_payload
            .pointer("/data/status/targetRef")
            .and_then(Value::as_str),
        Some("local")
    );
    assert!(
        tmux_probe_payload
            .pointer("/data/status/available")
            .and_then(Value::as_bool)
            .is_some(),
        "expected tmux probe to return availability status"
    );

    let app_guide = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.app_guide"))
        .await
        .expect("call app guide through mcp endpoint");
    assert_eq!(app_guide.is_error, Some(false));
    let app_guide_payload = app_guide
        .structured_content
        .as_ref()
        .expect("structured app guide content");
    assert_eq!(
        app_guide_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert!(app_guide_payload
        .pointer("/data/applicationSurfaces")
        .and_then(Value::as_array)
        .is_some_and(|surfaces| surfaces.iter().any(|surface| {
            surface.pointer("/surface").and_then(Value::as_str) == Some("rightToolPanel")
                && surface
                    .pointer("/runtimeTools/container")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_ids| {
                        tool_ids
                            .iter()
                            .any(|tool_id| tool_id.as_str() == Some("container.files.write_text"))
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/taskRoutes")
        .and_then(Value::as_array)
        .is_some_and(|routes| routes.iter().any(|route| {
            route.pointer("/task").and_then(Value::as_str) == Some("edit-kerminal-config")
                && route
                    .pointer("/toolIds")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_ids| {
                        tool_ids
                            .iter()
                            .any(|tool_id| tool_id.as_str() == Some("kerminal.config_guide"))
                            && tool_ids
                                .iter()
                                .any(|tool_id| tool_id.as_str() == Some("kerminal.config.validate"))
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/taskRoutes")
        .and_then(Value::as_array)
        .is_some_and(|routes| routes.iter().any(|route| {
            route.pointer("/task").and_then(Value::as_str) == Some("discover-mcp-capabilities")
                && route
                    .pointer("/toolIds")
                    .and_then(Value::as_array)
                    .is_some_and(|tool_ids| {
                        tool_ids
                            .iter()
                            .any(|tool_id| tool_id.as_str() == Some("kerminal.capabilities"))
                    })
        })));
    assert!(app_guide_payload
        .pointer("/data/mcpBoundaries/configCrudAbsent")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));

    let config_reference_guide = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.config_guide"))
        .await
        .expect("call config guide through mcp endpoint");
    assert_eq!(config_reference_guide.is_error, Some(false));
    let config_reference_payload = config_reference_guide
        .structured_content
        .as_ref()
        .expect("structured config guide content");
    assert_eq!(
        config_reference_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        config_reference_payload
            .pointer("/data/guideFile")
            .and_then(Value::as_str),
        Some("kerminal-config.md")
    );
    assert_eq!(
        config_reference_payload
            .pointer("/data/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    assert!(config_reference_payload
        .pointer("/data/markdown")
        .and_then(Value::as_str)
        .is_some_and(|markdown| {
            markdown.contains("Kerminal Configuration Guide")
                && markdown.contains("Do not look for MCP CRUD tools")
                && markdown.contains("kerminal.host.upsert_with_credential")
                && markdown.contains("key_passphrase_ref")
                && markdown.contains("inline_private_key")
        }));
    assert!(config_reference_payload
        .pointer("/data/deliberatelyAbsentToolFamilies")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));

    let capability_guide = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.capabilities"))
        .await
        .expect("call capability guide through mcp endpoint");
    assert_eq!(capability_guide.is_error, Some(false));
    let capability_payload = capability_guide
        .structured_content
        .as_ref()
        .expect("structured capability guide content");
    assert_eq!(
        capability_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        capability_payload
            .pointer("/data/fileFirstConfiguration/manualGuideTool")
            .and_then(Value::as_str),
        Some("kerminal.config_guide")
    );
    assert_eq!(
        capability_payload
            .pointer("/data/fileFirstConfiguration/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    let capability_families = capability_payload
        .pointer("/data/runtimeToolFamilies")
        .and_then(Value::as_array)
        .expect("capability families");
    assert!(capability_families.iter().any(|family| {
        family
            .pointer("/family")
            .and_then(Value::as_str)
            .is_some_and(|name| name == "tmux")
            && family
                .pointer("/toolIds")
                .and_then(Value::as_array)
                .is_some_and(|tool_ids| {
                    tool_ids
                        .iter()
                        .any(|tool_id| tool_id.as_str() == Some("tmux.capture_pane"))
                })
    }));
    let deliberately_absent = capability_payload
        .pointer("/data/deliberatelyAbsentToolFamilies")
        .and_then(Value::as_array)
        .expect("absent tool families");
    assert!(deliberately_absent
        .iter()
        .any(|tool_family| tool_family.as_str() == Some("settings.*")));
    assert!(capability_payload
        .pointer("/data/sessionWorkspace/readFirst")
        .and_then(Value::as_array)
        .is_some_and(|paths| paths
            .iter()
            .any(|path| path.as_str() == Some("context/target-binding.json"))));
    assert!(capability_payload
        .pointer("/data/recommendedFirstCalls")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("kerminal.app_guide"))));
    assert!(capability_payload
        .pointer("/data/recommendedFirstCalls")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("kerminal.config_guide"))));
    assert!(capability_payload
        .pointer("/data/recommendedFirstCalls")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("kerminal.tool_help"))));
    assert!(capability_payload
        .pointer("/data/recommendedFirstCalls")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("kerminal.operation_guide"))));

    let mut terminal_tool_help_arguments = serde_json::Map::new();
    terminal_tool_help_arguments.insert(
        "toolId".to_owned(),
        Value::String("terminal.write".to_owned()),
    );
    terminal_tool_help_arguments.insert("includeSchemas".to_owned(), Value::Bool(true));
    let terminal_tool_help = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.tool_help")
                .with_arguments(terminal_tool_help_arguments),
        )
        .await
        .expect("call terminal tool help through mcp endpoint");
    assert_eq!(terminal_tool_help.is_error, Some(false));
    let terminal_tool_help_payload = terminal_tool_help
        .structured_content
        .as_ref()
        .expect("structured terminal tool help content");
    assert_eq!(
        terminal_tool_help_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        terminal_tool_help_payload
            .pointer("/data/matchMode")
            .and_then(Value::as_str),
        Some("toolId")
    );
    assert_tool_reference_examples_match_schema(terminal_tool_help_payload);
    assert!(terminal_tool_help_payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(|tool_references| {
            tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str) == Some("terminal.write")
                    && tool_reference
                        .pointer("/inputSchema/properties/data")
                        .is_some()
                    && tool_reference
                        .pointer("/exampleArguments/bindingGeneration")
                        .and_then(Value::as_u64)
                        .is_some()
                    && tool_reference
                        .pointer("/annotations/readOnlyHint")
                        .and_then(Value::as_bool)
                        == Some(false)
            })
        }));

    let mut container_tool_help_arguments = serde_json::Map::new();
    container_tool_help_arguments
        .insert("family".to_owned(), Value::String("container".to_owned()));
    let container_tool_help = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.tool_help")
                .with_arguments(container_tool_help_arguments),
        )
        .await
        .expect("call container tool help through mcp endpoint");
    assert_eq!(container_tool_help.is_error, Some(false));
    let container_tool_help_payload = container_tool_help
        .structured_content
        .as_ref()
        .expect("structured container tool help content");
    assert_eq!(
        container_tool_help_payload
            .pointer("/data/matchMode")
            .and_then(Value::as_str),
        Some("family")
    );
    assert_tool_reference_examples_match_schema(container_tool_help_payload);
    assert!(container_tool_help_payload
        .pointer("/data/availableToolIds")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("container.files.write_text"))));
    assert!(container_tool_help_payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(|tool_references| {
            tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str)
                    == Some("container.files.delete")
                    && tool_reference
                        .pointer("/annotations/destructiveHint")
                        .and_then(Value::as_bool)
                        == Some(true)
            })
        }));

    let mut absent_tool_help_arguments = serde_json::Map::new();
    absent_tool_help_arguments.insert(
        "query".to_owned(),
        Value::String("remote_host.tree".to_owned()),
    );
    let absent_tool_help = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.tool_help")
                .with_arguments(absent_tool_help_arguments),
        )
        .await
        .expect("call absent tool help through mcp endpoint");
    assert_eq!(absent_tool_help.is_error, Some(false));
    let absent_tool_help_payload = absent_tool_help
        .structured_content
        .as_ref()
        .expect("structured absent tool help content");
    assert_eq!(
        absent_tool_help_payload
            .pointer("/data/matchedToolCount")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert!(absent_tool_help_payload
        .pointer("/data/absentToolMatches")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));

    let mut config_guide_arguments = serde_json::Map::new();
    config_guide_arguments.insert("intent".to_owned(), Value::String("config".to_owned()));
    config_guide_arguments.insert(
        "goal".to_owned(),
        Value::String("update a host config".to_owned()),
    );
    let config_operation_guide = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.operation_guide")
                .with_arguments(config_guide_arguments),
        )
        .await
        .expect("call config operation guide through mcp endpoint");
    assert_eq!(config_operation_guide.is_error, Some(false));
    let config_guide_payload = config_operation_guide
        .structured_content
        .as_ref()
        .expect("structured config operation guide content");
    assert_eq!(
        config_guide_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        config_guide_payload
            .pointer("/data/intent")
            .and_then(Value::as_str),
        Some("config")
    );
    assert_eq!(
        config_guide_payload
            .pointer("/data/fileFirstConfiguration/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    assert!(config_guide_payload
        .pointer("/data/workflow")
        .and_then(Value::as_array)
        .is_some_and(|steps| steps
            .iter()
            .any(|step| step.pointer("/toolId").and_then(Value::as_str)
                == Some("kerminal.config_guide"))));
    assert!(config_guide_payload
        .pointer("/data/workflow")
        .and_then(Value::as_array)
        .is_some_and(|steps| steps
            .iter()
            .any(|step| step.pointer("/toolId").and_then(Value::as_str)
                == Some("kerminal.config.validate"))));
    assert!(config_guide_payload
        .pointer("/data/deliberatelyAbsentToolFamilies")
        .and_then(Value::as_array)
        .is_some_and(|families| families
            .iter()
            .any(|family| family.as_str() == Some("remote_host.*"))));
    assert_tool_reference_examples_match_schema(config_guide_payload);
    assert!(config_guide_payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(
            |tool_references| tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str)
                    == Some("kerminal.config_guide")
                    && tool_reference
                        .pointer("/exampleArguments")
                        .and_then(Value::as_object)
                        .is_some_and(|arguments| arguments.is_empty())
            })
        ));
    assert!(config_guide_payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(
            |tool_references| tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str)
                    == Some("kerminal.config.validate")
                    && tool_reference
                        .pointer("/exampleArguments/scope")
                        .and_then(Value::as_str)
                        == Some("all")
            })
        ));

    let mut session_guide_arguments = serde_json::Map::new();
    session_guide_arguments.insert(
        "intent".to_owned(),
        Value::String("session-terminal".to_owned()),
    );
    let session_operation_guide = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("kerminal.operation_guide")
                .with_arguments(session_guide_arguments),
        )
        .await
        .expect("call session operation guide through mcp endpoint");
    assert_eq!(session_operation_guide.is_error, Some(false));
    let session_guide_payload = session_operation_guide
        .structured_content
        .as_ref()
        .expect("structured session operation guide content");
    assert_eq!(
        session_guide_payload
            .pointer("/data/intent")
            .and_then(Value::as_str),
        Some("session-terminal")
    );
    assert!(session_guide_payload
        .pointer("/data/availableReferencedToolIds")
        .and_then(Value::as_array)
        .is_some_and(|tool_ids| tool_ids
            .iter()
            .any(|tool_id| tool_id.as_str() == Some("kerminal.agent.target_context"))));
    assert!(session_guide_payload
        .pointer("/data/workflow")
        .and_then(Value::as_array)
        .is_some_and(|steps| {
            steps.iter().any(|step| {
                step.pointer("/toolId").and_then(Value::as_str) == Some("terminal.write")
            })
        }));
    assert_tool_reference_examples_match_schema(session_guide_payload);
    assert!(session_guide_payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .is_some_and(
            |tool_references| tool_references.iter().any(|tool_reference| {
                tool_reference.pointer("/id").and_then(Value::as_str) == Some("terminal.write")
                    && tool_reference
                        .pointer("/exampleArguments/bindingGeneration")
                        .and_then(Value::as_u64)
                        .is_some()
            })
        ));

    for guide_intent in [
        "overview",
        "terminal",
        "session-terminal",
        "ssh-command",
        "sftp",
        "tmux",
        "container",
        "port-forward",
        "server-info",
        "history",
        "config",
        "credentials",
        "diagnostics",
    ] {
        let mut guide_arguments = serde_json::Map::new();
        guide_arguments.insert("intent".to_owned(), Value::String(guide_intent.to_owned()));
        let operation_guide = client
            .peer()
            .call_tool(
                CallToolRequestParams::new("kerminal.operation_guide")
                    .with_arguments(guide_arguments),
            )
            .await
            .expect("call operation guide intent through mcp endpoint");
        assert_eq!(operation_guide.is_error, Some(false));
        let guide_payload = operation_guide
            .structured_content
            .as_ref()
            .expect("structured operation guide content");
        assert_eq!(
            guide_payload
                .pointer("/data/intent")
                .and_then(Value::as_str),
            Some(guide_intent)
        );
        assert_tool_reference_examples_match_schema(guide_payload);
        if guide_intent == "container" {
            assert!(guide_payload
                .pointer("/data/availableReferencedToolIds")
                .and_then(Value::as_array)
                .is_some_and(|tool_ids| tool_ids
                    .iter()
                    .any(|tool_id| tool_id.as_str() == Some("container.remove"))));
            assert!(guide_payload
                .pointer("/data/availableReferencedToolIds")
                .and_then(Value::as_array)
                .is_some_and(|tool_ids| tool_ids
                    .iter()
                    .any(|tool_id| tool_id.as_str() == Some("container.files.write_text"))));
            assert!(guide_payload
                .pointer("/data/toolReference")
                .and_then(Value::as_array)
                .is_some_and(
                    |tool_references| tool_references.iter().any(|tool_reference| {
                        tool_reference.pointer("/id").and_then(Value::as_str)
                            == Some("container.remove")
                            && tool_reference
                                .pointer("/annotations/destructiveHint")
                                .and_then(Value::as_bool)
                                == Some(true)
                            && tool_reference
                                .pointer("/exampleArguments/force")
                                .and_then(Value::as_bool)
                                == Some(false)
                    })
                ));
            assert!(guide_payload
                .pointer("/data/toolReference")
                .and_then(Value::as_array)
                .is_some_and(
                    |tool_references| tool_references.iter().any(|tool_reference| {
                        tool_reference.pointer("/id").and_then(Value::as_str)
                            == Some("container.files.delete")
                            && tool_reference
                                .pointer("/annotations/destructiveHint")
                                .and_then(Value::as_bool)
                                == Some(true)
                            && tool_reference
                                .pointer("/exampleArguments/directory")
                                .and_then(Value::as_bool)
                                == Some(false)
                    })
                ));
        }
    }

    let runtime_snapshot = client
        .peer()
        .call_tool(CallToolRequestParams::new("kerminal.runtime_snapshot"))
        .await
        .expect("call runtime snapshot through mcp endpoint");
    assert_eq!(runtime_snapshot.is_error, Some(false));
    let runtime_snapshot_payload = runtime_snapshot
        .structured_content
        .as_ref()
        .expect("structured runtime snapshot content");
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/schemaVersion")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/toolsOnly")
            .and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/selfDiscoveryTool")
            .and_then(Value::as_str),
        Some("kerminal.capabilities")
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/appGuideTool")
            .and_then(Value::as_str),
        Some("kerminal.app_guide")
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/configGuideTool")
            .and_then(Value::as_str),
        Some("kerminal.config_guide")
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/toolHelpTool")
            .and_then(Value::as_str),
        Some("kerminal.tool_help")
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/operationGuideTool")
            .and_then(Value::as_str),
        Some("kerminal.operation_guide")
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/mcp/exposedToolCount")
            .and_then(Value::as_u64),
        Some(expected_tool_ids.len() as u64)
    );
    assert_eq!(
        runtime_snapshot_payload
            .pointer("/data/fileFirstConfiguration/validator")
            .and_then(Value::as_str),
        Some("kerminal.config.validate")
    );
    assert!(runtime_snapshot_payload
        .pointer("/data/fileFirstConfiguration/hostDiscovery")
        .and_then(Value::as_str)
        .is_some_and(|rule| rule.contains("hosts/*.toml") && rule.contains("remote_host.*")));

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

#[test]
fn parses_tmux_probe_arguments_from_flat_mcp_shape() {
    let mut arguments = serde_json::Map::new();
    arguments.insert("targetKind".to_owned(), Value::String("ssh".to_owned()));
    arguments.insert("hostId".to_owned(), Value::String("prod-web".to_owned()));
    arguments.insert("socketName".to_owned(), Value::String("work".to_owned()));
    arguments.insert(
        "tmuxPath".to_owned(),
        Value::String("/usr/bin/tmux".to_owned()),
    );

    let request =
        executor_rules::tmux_probe_request_from_arguments(&arguments).expect("tmux request");

    assert_eq!(
        request.target.target,
        RemoteTargetRef::Ssh {
            host_id: "prod-web".to_owned()
        }
    );
    assert_eq!(request.target.socket_name.as_deref(), Some("work"));
    assert_eq!(request.target.socket_path, None);
    assert_eq!(request.target.tmux_path.as_deref(), Some("/usr/bin/tmux"));
}

fn assert_tool_reference_examples_match_schema(payload: &Value) {
    let tool_references = payload
        .pointer("/data/toolReference")
        .and_then(Value::as_array)
        .expect("operation guide toolReference");
    assert!(
        !tool_references.is_empty(),
        "operation guide should include schema-backed tool references"
    );

    for tool_reference in tool_references {
        let tool_id = tool_reference
            .pointer("/id")
            .and_then(Value::as_str)
            .expect("tool reference id");
        let schema_properties = tool_reference
            .pointer("/inputSchema/properties")
            .and_then(Value::as_object)
            .expect("tool reference input schema properties");
        let Some(example_arguments) = tool_reference
            .pointer("/exampleArguments")
            .and_then(Value::as_object)
        else {
            continue;
        };

        for key in example_arguments.keys() {
            assert!(
                schema_properties.contains_key(key),
                "exampleArguments for {tool_id} contains `{key}`, but inputSchema does not"
            );
        }
    }
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
