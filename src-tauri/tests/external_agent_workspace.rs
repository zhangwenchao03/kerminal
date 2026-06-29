//! External agent workspace behavior tests.
//!
//! @author kongweiguang

#[cfg(windows)]
use std::process::{Command, Stdio};
use std::{fs, path::Path};

use kerminal_lib::{
    models::agent_session::{
        AgentId, AgentProviderSession, AgentSession, AgentSessionId, AgentSessionLaunch,
        AgentSessionStatus, AgentSessionTarget, AgentTargetLiveStatus,
        AGENT_SESSION_SCHEMA_VERSION,
    },
    services::{
        agent_session_file_store::AgentSessionFileStore,
        external_agent_workspace::{
            rules, ExternalAgentFileAction, ExternalAgentLaunchSpec, ExternalAgentOverwritePolicy,
            ExternalAgentWorkspaceService, PrepareExternalAgentWorkspaceRequest,
        },
    },
};
use serde_json::Value;

const CONFIG_REFERENCE_FILE_NAME: &str = "kerminal-config.md";
const MANAGED_BLOCK_START: &str = "<!-- KERMINAL_EXTERNAL_AGENT_START -->";

#[test]
fn prepare_codex_writes_managed_files_without_clobbering_user_content() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3000/mcp".to_owned()),
        true,
    );
    fs::write(temp.path().join("AGENTS.md"), "# User notes\n").expect("seed agents");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex");

    assert_agent_launch_command(&spec, "codex");
    assert_eq!(spec.cwd, path_to_string(temp.path()));
    let agents = fs::read_to_string(temp.path().join("AGENTS.md")).expect("agents");
    assert!(agents.contains("# User notes"));
    assert!(agents.contains(MANAGED_BLOCK_START));
    let codex = fs::read_to_string(temp.path().join(".codex").join("config.toml")).expect("codex");
    assert!(codex.contains("[mcp_servers.kerminal]"));
    assert!(codex.contains("http://127.0.0.1:3000/mcp"));
    let config_reference =
        fs::read_to_string(temp.path().join(CONFIG_REFERENCE_FILE_NAME)).expect("config guide");
    assert!(config_reference.contains("Kerminal Configuration Guide"));
    assert!(config_reference.contains("File Relationships"));
    assert!(config_reference.contains("Required Field Matrix"));
    assert!(config_reference.contains("Common Change Recipes"));
    assert!(config_reference.contains("Runtime MCP Boundaries"));
    assert!(config_reference.contains("kerminal.app_guide"));
    assert!(config_reference.contains("kerminal.config_guide"));
    assert!(config_reference.contains("kerminal.tool_help"));
    assert!(config_reference.contains("container.files.write_text"));
    assert!(config_reference.contains("container.files.delete"));
    assert!(config_reference.contains("hosts/groups.toml"));
    assert!(config_reference.contains("Host creation checklist"));
    assert!(config_reference.contains(r#"cwd = "~/.kerminal""#));
    assert!(config_reference.contains(r#"credential_ref = "~/.ssh/id_ed25519""#));
    assert!(config_reference.contains("secrets/vault.toml"));
    assert!(config_reference.contains("secret_ref"));
    assert!(config_reference.contains("key_passphrase_ref"));
    assert!(config_reference.contains("inline_private_key"));
    assert!(config_reference.contains("[[ssh_options.jump_hosts]]"));
    assert!(config_reference.contains("kerminal.host.upsert_with_credential"));
    assert!(config_reference.contains("kerminal.vault.encrypt_secret"));
    assert!(config_reference.contains("Never add plaintext keys such as `password`"));
    assert!(!config_reference.contains("secrets/hosts/*.toml"));
    assert!(config_reference.contains("production = true"));
    assert!(config_reference.contains("production = false"));
    assert!(config_reference.contains("production` is required"));
    assert!(config_reference.contains("kerminal.config.validate"));
    assert!(!config_reference.contains("validate-kerminal-config.mjs"));
    assert!(config_reference.contains("macOS/Linux example"));
    assert!(config_reference.contains(r#"shell = "zsh""#));
    assert!(config_reference.contains("Windows example"));
    assert!(config_reference.contains(r#"shell = "pwsh""#));
    assert!(config_reference.contains("Kerminal expands `~`, `~/...`, and `~\\...`"));
    assert!(config_reference.contains("kerminal.config.validate"));
    assert!(!config_reference.contains("validate-kerminal-config.mjs"));
    assert!(!config_reference.contains("requires Node.js"));
    assert!(!config_reference.contains("C:/Users/me"));
    assert!(!config_reference.contains("C:/dev"));
    assert!(agents.contains("Kerminal runtime workspace"));
    assert!(agents.contains("Operate Kerminal through MCP"));
    assert!(agents.contains("MCP host policy owns confirmation"));
    assert!(agents.contains("Prefer direct file edits"));
    assert!(agents.contains("terminal.write"));
    assert!(agents.contains("bindingGeneration"));
    assert!(agents.contains("kerminal.agent.target_context"));
    assert!(agents.contains("kerminal.app_guide"));
    assert!(agents.contains("kerminal.config_guide"));
    assert!(agents.contains("kerminal.capabilities"));
    assert!(agents.contains("kerminal.tool_help"));
    assert!(agents.contains("kerminal.operation_guide"));
    assert!(agents.contains("kerminal.runtime_snapshot"));
    assert!(agents.contains("Before editing Kerminal configuration files"));
    assert!(agents.contains(CONFIG_REFERENCE_FILE_NAME));
    assert!(agents.contains("Do not use Kerminal MCP tools for settings"));
    assert!(agents.contains("remote_host.*"));
    assert!(agents.contains("history.search"));
    assert!(agents.contains("tmux.*"));
    assert!(agents.contains("container.files.write_text"));
    assert!(agents.contains("container.files.delete"));
    assert!(agents.contains("kerminal.config.validate"));
    assert!(agents.contains("kerminal.host.upsert_with_credential"));
    assert!(agents.contains("kerminal.vault.encrypt_secret"));
    assert!(agents.contains("host files only keep `secret_ref` / `key_passphrase_ref`"));
    assert!(
        agents.contains("never write `password =`, `credential_secret`, or `inline_private_key`")
    );
    assert!(!agents.contains("use `credential_secret`, never `password`"));
    assert!(!agents.contains("validate-kerminal-config.mjs"));
    assert!(!agents.contains("C:/Users"));
    assert!(!agents.contains("C:\\Users"));
    assert!(!agents.contains("C:/dev"));
    assert!(!agents.contains("C:\\dev"));
}

#[test]
fn default_initialization_writes_codex_claude_and_config_guide_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3002/mcp".to_owned()),
        false,
    );

    service.ensure_default_agent_files().expect("default files");

    assert!(temp.path().join("AGENTS.md").is_file());
    assert!(temp.path().join("CLAUDE.md").is_file());
    assert!(temp.path().join(CONFIG_REFERENCE_FILE_NAME).is_file());
    assert!(temp.path().join(".codex").join("config.toml").is_file());
    assert!(temp.path().join(".mcp.json").is_file());
    assert!(!temp.path().join("custom-agent.toml").exists());
    assert!(!temp.path().join(".custom-agent").exists());
}

#[test]
fn prepare_claude_merges_mcp_json() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(
        temp.path().join(".mcp.json"),
        r#"{"mcpServers":{"other":{"type":"http","url":"http://x"}}}"#,
    )
    .expect("seed mcp");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3001/mcp".to_owned()),
        true,
    );

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare claude");

    assert_agent_launch_command(&spec, "claude");
    let root: Value =
        serde_json::from_str(&fs::read_to_string(temp.path().join(".mcp.json")).expect("mcp"))
            .expect("json");
    assert_eq!(
        root.pointer("/mcpServers/other/url")
            .and_then(Value::as_str),
        Some("http://x")
    );
    assert_eq!(
        root.pointer("/mcpServers/kerminal/url")
            .and_then(Value::as_str),
        Some("http://127.0.0.1:3001/mcp")
    );
    let claude = fs::read_to_string(temp.path().join("CLAUDE.md")).expect("claude");
    assert!(claude.contains("@AGENTS.md"));
    assert!(claude.contains("Follow `AGENTS.md` first"));
    assert!(claude.contains("Kerminal runtime workspace"));
    assert!(claude.contains("MCP host policy owns confirmation"));
    assert!(claude.contains("terminal.write"));
    assert!(claude.contains("bindingGeneration"));
    assert!(claude.contains("kerminal.app_guide"));
    assert!(claude.contains("kerminal.config_guide"));
    assert!(claude.contains("kerminal.capabilities"));
    assert!(claude.contains("kerminal.tool_help"));
    assert!(claude.contains("kerminal.operation_guide"));
    assert!(claude.contains("kerminal.runtime_snapshot"));
    assert!(claude.contains("context/target-binding.json"));
    assert!(claude.contains("context/terminal-snapshot.json"));
    assert!(claude.contains(CONFIG_REFERENCE_FILE_NAME));
    assert!(claude.contains("Prefer direct file edits"));
    assert!(claude.contains("Do not use Kerminal MCP tools for settings"));
    assert!(claude.contains("remote_host.*"));
    assert!(claude.contains("history.search"));
    assert!(claude.contains("tmux"));
    assert!(claude.contains("container.files.write_text"));
    assert!(claude.contains("container.files.delete"));
    assert!(claude.contains("ssh.command_on_resolved_host"));
    assert!(claude.contains("server_info.snapshot"));
    assert!(claude.contains("kerminal.config.validate"));
    assert!(claude.contains("kerminal.host.upsert_with_credential"));
    assert!(claude.contains("kerminal.vault.encrypt_secret"));
    assert!(claude.contains("key_passphrase_ref"));
    assert!(claude.contains("inline_private_key"));
    assert!(!claude.contains("use `credential_secret`, never `password`"));
    assert!(!claude.contains("validate-kerminal-config.mjs"));
}

#[test]
fn prepare_custom_uses_explicit_command_without_default_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3003/mcp".to_owned()),
        true,
    );

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "custom".to_owned(),
            agent_session_id: None,
            custom_command: Some("qwen --model max".to_owned()),
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare custom");

    assert_agent_launch_command(&spec, "qwen --model max");
    assert_eq!(spec.cwd, path_to_string(temp.path()));
    assert!(!temp.path().join("custom-agent.toml").exists());
    assert!(!temp.path().join(".custom-agent").exists());
    assert!(!temp.path().join(".codex").exists());
    assert!(!temp.path().join(".mcp.json").exists());
}

#[test]
fn custom_command_parser_preserves_windows_paths() {
    let plain = prepare_custom_command_spec(r#"C:\Tools\kimi.exe --fast"#);
    assert_launch_parts(&plain.shell, &plain.args, r#"C:\Tools\kimi.exe --fast"#);

    let quoted = prepare_custom_command_spec(r#""C:\Program Files\Kimi\kimi.exe" --fast"#);
    assert_launch_parts(
        &quoted.shell,
        &quoted.args,
        r#""C:\Program Files\Kimi\kimi.exe" --fast"#,
    );
}

#[test]
fn windows_agent_launch_command_prefers_pwsh_when_available() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3004/mcp".to_owned()),
        true,
    );

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex");

    assert_launch_parts(&spec.shell, &spec.args, "codex");
    #[cfg(windows)]
    if windows_command_available("pwsh.exe") {
        assert_eq!(spec.shell, "pwsh.exe");
    }
}

#[test]
fn windows_executable_names_skip_extensionless_shims() {
    let names = rules::executable_names("codex")
        .into_iter()
        .map(|name| name.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    #[cfg(windows)]
    {
        assert!(names
            .iter()
            .any(|name| name.eq_ignore_ascii_case("codex.cmd")));
        assert!(!names.iter().any(|name| name == "codex"));
    }

    #[cfg(not(windows))]
    {
        assert_eq!(names, vec!["codex"]);
    }
}

#[test]
fn dry_run_codex_reports_diff_without_writing_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3010/mcp".to_owned()),
        true,
    );

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: true,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("dry run codex");

    assert!(spec.dry_run);
    assert_eq!(spec.operations.len(), 3);
    assert!(spec.operations.iter().all(|operation| operation.dry_run));
    assert!(spec.operations.iter().all(|operation| operation.changed));
    assert!(spec.operations.iter().any(|operation| operation
        .diff
        .as_deref()
        .unwrap_or_default()
        .contains("3010")));
    assert!(!temp.path().join("AGENTS.md").exists());
    assert!(!temp.path().join(CONFIG_REFERENCE_FILE_NAME).exists());
    assert!(!temp.path().join(".codex").exists());
}

#[test]
fn endpoint_change_updates_managed_codex_table_and_reports_backup() {
    let temp = tempfile::tempdir().expect("tempdir");
    let codex_path = temp.path().join(".codex").join("config.toml");
    fs::create_dir_all(codex_path.parent().expect("parent")).expect("mkdir");
    fs::write(
        &codex_path,
        r#"[profile]
name = "keep"

[mcp_servers.kerminal]
url = "http://127.0.0.1:3000/mcp"

[mcp_servers.other]
url = "http://other"
"#,
    )
    .expect("seed codex");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3011/mcp".to_owned()),
        true,
    );

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex");

    let codex_operation = spec
        .operations
        .iter()
        .find(|operation| operation.path.ends_with("config.toml"))
        .expect("codex operation");
    assert_eq!(codex_operation.action, ExternalAgentFileAction::Updated);
    let backup_path = codex_operation.backup_path.as_ref().expect("backup path");
    assert!(Path::new(backup_path).is_file());
    assert!(codex_operation
        .diff
        .as_deref()
        .unwrap_or_default()
        .contains("3011"));

    let next = fs::read_to_string(&codex_path).expect("codex");
    assert!(next.contains("name = \"keep\""));
    assert!(next.contains("[mcp_servers.other]"));
    assert!(next.contains("http://127.0.0.1:3011/mcp"));
    assert!(!next.contains("http://127.0.0.1:3000/mcp"));
}

#[test]
fn preserve_policy_rejects_invalid_claude_mcp_json() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join(".mcp.json"), "not json").expect("seed mcp");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3012/mcp".to_owned()),
        true,
    );

    let error = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::PreserveUserContent,
        })
        .expect_err("invalid json should fail");

    assert!(error.to_string().contains("backupAndReplaceInvalid"));
    assert_eq!(
        fs::read_to_string(temp.path().join(".mcp.json")).expect("mcp"),
        "not json"
    );
}

#[test]
fn default_policy_repairs_invalid_claude_mcp_json_with_backup() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mcp_path = temp.path().join(".mcp.json");
    fs::write(&mcp_path, "not json").expect("seed mcp");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3013/mcp".to_owned()),
        true,
    );

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("repair mcp json");

    let mcp_operation = spec
        .operations
        .iter()
        .find(|operation| operation.path.ends_with(".mcp.json"))
        .expect("mcp operation");
    assert_eq!(mcp_operation.action, ExternalAgentFileAction::Updated);
    let backup_path = mcp_operation.backup_path.as_ref().expect("backup path");
    assert_eq!(fs::read_to_string(backup_path).expect("backup"), "not json");
    let root: Value =
        serde_json::from_str(&fs::read_to_string(&mcp_path).expect("mcp")).expect("json");
    assert_eq!(
        root.pointer("/mcpServers/kerminal/url")
            .and_then(Value::as_str),
        Some("http://127.0.0.1:3013/mcp")
    );
}

#[test]
fn shared_agents_instructions_include_config_boundaries_and_validator() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3014/mcp".to_owned()),
        true,
    );

    service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: None,
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex");

    let agents = fs::read_to_string(temp.path().join("AGENTS.md")).expect("agents");
    assert!(agents.contains("settings.toml"));
    assert!(agents.contains(CONFIG_REFERENCE_FILE_NAME));
    assert!(agents.contains("file purposes"));
    assert!(agents.contains("profiles/*.toml"));
    assert!(agents.contains("hosts/*.toml"));
    assert!(agents.contains("data/"));
    assert!(agents.contains("logs/"));
    assert!(agents.contains("secrets/"));
    assert!(agents.contains("kerminal.config.validate"));
    assert!(!agents.contains("validate-kerminal-config.mjs"));
    assert!(agents.contains("Kerminal runtime workspace"));
    assert!(agents.contains("MCP host policy owns confirmation"));
    assert!(agents.contains("terminal.write"));
    assert!(agents.contains("bindingGeneration"));
    assert!(agents.contains("kerminal.agent.target_context"));
    assert!(agents.contains("kerminal.app_guide"));
    assert!(agents.contains("kerminal.config_guide"));
    assert!(agents.contains("kerminal.capabilities"));
    assert!(agents.contains("kerminal.tool_help"));
    assert!(agents.contains("kerminal.operation_guide"));
    assert!(agents.contains("kerminal.runtime_snapshot"));
    assert!(agents.contains("context/target-binding.json"));
    assert!(agents.contains("context/terminal-snapshot.json"));
    assert!(agents.contains("Prefer direct file edits"));
    assert!(agents.contains("use MCP for runtime operation"));
    assert!(agents.contains("Do not use Kerminal MCP tools for settings"));
    assert!(agents.contains("settings.*"));
    assert!(agents.contains("terminal.create"));
    assert!(agents.contains("data/command.sqlite"));
    assert!(agents.contains("tmux.*"));
    assert!(agents.contains("container.files.write_text"));
    assert!(agents.contains("container.files.delete"));
    assert!(agents.contains("kerminal.host.upsert_with_credential"));
    assert!(agents.contains("kerminal.vault.encrypt_secret"));
}

#[test]
fn default_kerminal_workspace_paths_are_home_relative_in_agent_instructions() {
    let temp = tempfile::tempdir().expect("tempdir");
    let workspace_root = temp.path().join(".kerminal");
    let service = ExternalAgentWorkspaceService::new(
        &workspace_root,
        Some("http://127.0.0.1:3015/mcp".to_owned()),
        true,
    );
    let agent_session_id = "ags_display_20260624";

    service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.to_owned()),
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex session");

    let session_agents = fs::read_to_string(
        workspace_root
            .join("agents")
            .join("sessions")
            .join(agent_session_id)
            .join("AGENTS.md"),
    )
    .expect("session agents");
    assert!(session_agents.contains("Kerminal workspace root: `~/.kerminal`"));
    assert!(session_agents
        .contains("This session root: `~/.kerminal/agents/sessions/ags_display_20260624`"));
    assert!(!session_agents.contains(&path_to_string(temp.path())));
    let agents = fs::read_to_string(workspace_root.join("AGENTS.md")).expect("agents");
    assert!(agents.contains("kerminal.config.validate"));
    assert!(agents.contains("kerminal.app_guide"));
    assert!(agents.contains("kerminal.config_guide"));
    assert!(agents.contains("kerminal.capabilities"));
    assert!(agents.contains("kerminal.tool_help"));
    assert!(agents.contains("kerminal.operation_guide"));
    assert!(agents.contains("kerminal.runtime_snapshot"));
    assert!(agents.contains("tmux.*"));
    assert!(agents.contains("container.files.write_text"));
    assert!(agents.contains("container.files.delete"));
    assert!(agents.contains("kerminal.host.upsert_with_credential"));
    assert!(agents.contains("kerminal.vault.encrypt_secret"));
    assert!(!agents.contains("validate-kerminal-config.mjs"));
    assert!(!agents.contains(&path_to_string(temp.path())));
}

#[test]
fn prepare_codex_agent_session_workspace_writes_scoped_files_and_env() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3020/mcp".to_owned()),
        true,
    );
    let agent_session_id = "ags_20260624_203124_ab12";
    let scoped_endpoint = format!("http://127.0.0.1:3020/mcp/agents/{agent_session_id}");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.to_owned()),
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex session");

    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id);
    assert_agent_launch_command(&spec, "codex");
    assert_eq!(spec.cwd, path_to_string(&session_root));
    assert_session_env(
        &spec,
        agent_session_id,
        temp.path(),
        &session_root,
        &scoped_endpoint,
    );
    assert!(temp.path().join("AGENTS.md").is_file());
    assert!(temp.path().join(CONFIG_REFERENCE_FILE_NAME).is_file());
    assert!(temp.path().join(".codex").join("config.toml").is_file());
    assert!(session_root.join("AGENTS.md").is_file());
    assert!(session_root.join("CLAUDE.md").is_file());
    assert!(session_root.join(".codex").join("config.toml").is_file());
    assert!(session_root.join(".mcp.json").is_file());
    assert!(session_root
        .join("context")
        .join("target-binding.json")
        .is_file());
    assert!(session_root
        .join("context")
        .join("terminal-snapshot.json")
        .is_file());

    let agents = fs::read_to_string(session_root.join("AGENTS.md")).expect("session agents");
    assert!(agents.contains(agent_session_id));
    assert!(agents.contains("Kerminal MCP is tools-only"));
    assert!(agents.contains("file-first"));
    assert!(agents.contains(CONFIG_REFERENCE_FILE_NAME));
    assert!(agents.contains("agentSessionId"));
    assert!(agents.contains("bindingGeneration"));
    assert!(agents.contains("terminal.write"));
    assert!(agents.contains("stale"));
    assert!(agents.contains("rebind"));
    assert!(agents.contains("kerminal.config.validate"));
    assert!(agents.contains("kerminal.app_guide"));
    assert!(agents.contains("kerminal.config_guide"));
    assert!(agents.contains("kerminal.capabilities"));
    assert!(agents.contains("kerminal.tool_help"));
    assert!(agents.contains("kerminal.operation_guide"));
    assert!(agents.contains("kerminal.runtime_snapshot"));
    assert!(agents.contains("tmux.*"));
    assert!(agents.contains("container.files.write_text"));
    assert!(agents.contains("container.files.delete"));
    assert!(agents.contains("kerminal.host.upsert_with_credential"));
    assert!(agents.contains("kerminal.vault.encrypt_secret"));
    assert!(agents.contains("key_passphrase_ref"));
    assert!(agents.contains("inline_private_key"));
    assert!(!agents.contains("use `credential_secret`, never `password`"));
    assert!(!agents.contains("validate-kerminal-config.mjs"));

    let codex = fs::read_to_string(session_root.join(".codex").join("config.toml")).expect("codex");
    assert!(codex.contains("[mcp_servers.kerminal]"));
    assert!(codex.contains(&scoped_endpoint));

    let mcp_root: Value =
        serde_json::from_str(&fs::read_to_string(session_root.join(".mcp.json")).expect("mcp"))
            .expect("mcp json");
    assert_eq!(
        mcp_root
            .pointer("/mcpServers/kerminal/url")
            .and_then(Value::as_str),
        Some(scoped_endpoint.as_str())
    );

    let endpoint_context: Value = serde_json::from_str(
        &fs::read_to_string(session_root.join("context").join("mcp-endpoint.json"))
            .expect("endpoint context"),
    )
    .expect("endpoint json");
    assert_eq!(
        endpoint_context
            .pointer("/endpoint")
            .and_then(Value::as_str),
        Some(scoped_endpoint.as_str())
    );
    assert_eq!(
        endpoint_context
            .pointer("/agentSessionId")
            .and_then(Value::as_str),
        Some(agent_session_id)
    );
    assert_eq!(
        endpoint_context
            .pointer("/env/KERMINAL_AGENT_SESSION_ID")
            .and_then(Value::as_str),
        Some(agent_session_id)
    );
    assert_eq!(
        endpoint_context
            .pointer("/toolsOnly")
            .and_then(Value::as_bool),
        Some(true)
    );

    let target_context: Value = serde_json::from_str(
        &fs::read_to_string(session_root.join("context").join("target-binding.json"))
            .expect("target context"),
    )
    .expect("target json");
    assert_eq!(
        target_context
            .pointer("/agentSessionId")
            .and_then(Value::as_str),
        Some(agent_session_id)
    );
    assert_eq!(
        target_context
            .pointer("/binding/status")
            .and_then(Value::as_str),
        Some("unbound")
    );
    assert_eq!(
        target_context
            .pointer("/binding/generation")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert_eq!(
        target_context
            .pointer("/binding/stale")
            .and_then(Value::as_bool),
        Some(false)
    );

    let terminal_snapshot: Value = serde_json::from_str(
        &fs::read_to_string(session_root.join("context").join("terminal-snapshot.json"))
            .expect("terminal snapshot"),
    )
    .expect("terminal snapshot json");
    assert_eq!(
        terminal_snapshot
            .pointer("/agentSessionId")
            .and_then(Value::as_str),
        Some(agent_session_id)
    );
    assert_eq!(
        terminal_snapshot
            .pointer("/capturedBytes")
            .and_then(Value::as_u64),
        Some(0)
    );
    assert_eq!(
        terminal_snapshot.pointer("/output").and_then(Value::as_str),
        Some("")
    );
    assert_eq!(
        terminal_snapshot
            .pointer("/maxBytes")
            .and_then(Value::as_u64),
        Some(24 * 1024)
    );
}

#[test]
fn prepare_agent_session_workspace_seeds_target_binding_from_session_toml() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3026/mcp".to_owned()),
        true,
    );
    let store = AgentSessionFileStore::new(temp.path());
    let agent_session_id = AgentSessionId::new("ags_bound_target_20260629".to_owned()).expect("id");
    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id.as_str());
    store
        .write_session(&AgentSession {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id: agent_session_id.clone(),
            agent_id: AgentId::Codex,
            title: "Codex".to_owned(),
            created_at: "20260629200000".to_owned(),
            updated_at: "20260629200000".to_owned(),
            status: AgentSessionStatus::Active,
            workspace_root: path_to_string(temp.path()),
            session_root: path_to_string(&session_root),
            launch: AgentSessionLaunch {
                command_label: "codex".to_owned(),
                shell: "codex".to_owned(),
                args: Vec::new(),
                cwd: path_to_string(&session_root),
            },
            target: Some(AgentSessionTarget {
                binding_id: Some("binding-1".to_owned()),
                binding_generation: 7,
                pane_id: Some("pane-1".to_owned()),
                tab_id: Some("tab-1".to_owned()),
                target_terminal_session_id: Some("terminal-1".to_owned()),
                target_ref: Some("ssh:prod-web".to_owned()),
                target_kind: Some("ssh".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                live_status: AgentTargetLiveStatus::Ready,
                last_seen_at: Some("20260629200001".to_owned()),
            }),
        })
        .expect("write session");

    service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.as_str().to_owned()),
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex session");

    let target_context: Value = serde_json::from_str(
        &fs::read_to_string(session_root.join("context").join("target-binding.json"))
            .expect("target context"),
    )
    .expect("target json");
    assert_eq!(
        target_context
            .pointer("/binding/status")
            .and_then(Value::as_str),
        Some("ready")
    );
    assert_eq!(
        target_context
            .pointer("/binding/generation")
            .and_then(Value::as_u64),
        Some(7)
    );
    assert_eq!(
        target_context
            .pointer("/binding/targetTerminalSessionId")
            .and_then(Value::as_str),
        Some("terminal-1")
    );
    assert_eq!(
        target_context
            .pointer("/binding/targetRef")
            .and_then(Value::as_str),
        Some("ssh:prod-web")
    );
    assert_eq!(
        target_context
            .pointer("/binding/cwd")
            .and_then(Value::as_str),
        Some("/srv/app")
    );
}

#[test]
fn prepare_codex_agent_session_resume_uses_provider_resume_command() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3023/mcp".to_owned()),
        true,
    );
    let agent_session_id = "ags_codex_resume_20260624";
    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id);
    fs::create_dir_all(&session_root).expect("session root");
    fs::write(
        session_root.join("provider.toml"),
        toml::to_string_pretty(&AgentProviderSession::for_agent(AgentId::Codex))
            .expect("provider toml"),
    )
    .expect("write provider");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.to_owned()),
            custom_command: None,
            resume_provider_session: true,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex resume session");

    assert_agent_launch_command(&spec, "codex resume --last");
    assert_eq!(spec.cwd, path_to_string(&session_root));
}

#[test]
fn prepare_claude_agent_session_resume_without_command_falls_back_to_plain_cli() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3024/mcp".to_owned()),
        true,
    );
    let agent_session_id = "ags_claude_resume_20260624";
    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id);
    fs::create_dir_all(&session_root).expect("session root");
    fs::write(
        session_root.join("provider.toml"),
        toml::to_string_pretty(&AgentProviderSession::for_agent(AgentId::Claude))
            .expect("provider toml"),
    )
    .expect("write provider");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: Some(agent_session_id.to_owned()),
            custom_command: None,
            resume_provider_session: true,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare claude resume session");

    assert_agent_launch_command(&spec, "claude");
    assert_eq!(spec.cwd, path_to_string(&session_root));
}

#[test]
fn prepare_agent_session_resume_syncs_launch_back_to_session_toml() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3025/mcp".to_owned()),
        true,
    );
    let store = AgentSessionFileStore::new(temp.path());
    let agent_session_id =
        AgentSessionId::new("ags_codex_sync_resume_20260624".to_owned()).expect("id");
    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id.as_str());
    store
        .write_session(&AgentSession {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id: agent_session_id.clone(),
            agent_id: AgentId::Codex,
            title: "Codex".to_owned(),
            created_at: "20260624200000".to_owned(),
            updated_at: "20260624200000".to_owned(),
            status: AgentSessionStatus::Active,
            workspace_root: path_to_string(temp.path()),
            session_root: path_to_string(&session_root),
            launch: AgentSessionLaunch {
                command_label: "codex".to_owned(),
                shell: "codex".to_owned(),
                args: Vec::new(),
                cwd: path_to_string(&session_root),
            },
            target: None,
        })
        .expect("write session");
    fs::write(
        session_root.join("provider.toml"),
        toml::to_string_pretty(&AgentProviderSession::for_agent(AgentId::Codex))
            .expect("provider toml"),
    )
    .expect("write provider");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "codex".to_owned(),
            agent_session_id: Some(agent_session_id.as_str().to_owned()),
            custom_command: None,
            resume_provider_session: true,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare codex resume session");

    assert_agent_launch_command(&spec, "codex resume --last");
    let saved = store.read_session(&agent_session_id).expect("read session");
    assert_eq!(saved.launch.command_label, "codex resume --last");
    assert_eq!(saved.launch.cwd, path_to_string(&session_root));
    assert_launch_parts(
        &saved.launch.shell,
        &saved.launch.args,
        "codex resume --last",
    );
}

#[test]
fn prepare_claude_agent_session_workspace_writes_default_provider_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3021/mcp/".to_owned()),
        true,
    );
    let agent_session_id = "ags_claude_20260624";
    let scoped_endpoint = format!("http://127.0.0.1:3021/mcp/agents/{agent_session_id}");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "claude".to_owned(),
            agent_session_id: Some(agent_session_id.to_owned()),
            custom_command: None,
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare claude session");

    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id);
    assert_agent_launch_command(&spec, "claude");
    assert_eq!(spec.cwd, path_to_string(&session_root));
    assert_session_env(
        &spec,
        agent_session_id,
        temp.path(),
        &session_root,
        &scoped_endpoint,
    );

    let claude = fs::read_to_string(session_root.join("CLAUDE.md")).expect("claude");
    assert!(claude.contains("@AGENTS.md"));
    assert!(claude.contains("tools-only"));
    assert!(claude.contains("MCP host policy owns confirmation"));
    assert!(claude.contains("bindingGeneration"));
    assert!(claude.contains(CONFIG_REFERENCE_FILE_NAME));
    assert!(claude.contains("rebind"));
    assert!(claude.contains("kerminal.config.validate"));
    assert!(claude.contains("kerminal.app_guide"));
    assert!(claude.contains("kerminal.config_guide"));
    assert!(claude.contains("kerminal.capabilities"));
    assert!(claude.contains("kerminal.operation_guide"));
    assert!(claude.contains("kerminal.runtime_snapshot"));
    assert!(claude.contains("tmux.*"));
    assert!(claude.contains("container.files.write_text"));
    assert!(claude.contains("container.files.delete"));
    assert!(claude.contains("ssh.command_on_resolved_host"));
    assert!(claude.contains("server_info.snapshot"));
    assert!(claude.contains("kerminal.host.upsert_with_credential"));
    assert!(claude.contains("kerminal.vault.encrypt_secret"));
    assert!(claude.contains("key_passphrase_ref"));
    assert!(claude.contains("inline_private_key"));
    assert!(!claude.contains("use `credential_secret`, never `password`"));
    assert!(!claude.contains("validate-kerminal-config.mjs"));
    assert!(session_root.join(".codex").join("config.toml").is_file());
    let mcp_root: Value =
        serde_json::from_str(&fs::read_to_string(session_root.join(".mcp.json")).expect("mcp"))
            .expect("mcp json");
    assert_eq!(
        mcp_root
            .pointer("/mcpServers/kerminal/url")
            .and_then(Value::as_str),
        Some(scoped_endpoint.as_str())
    );
}

#[test]
fn prepare_custom_agent_session_workspace_skips_provider_specific_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3022/mcp".to_owned()),
        true,
    );
    let agent_session_id = "ags_custom_20260624";
    let scoped_endpoint = format!("http://127.0.0.1:3022/mcp/agents/{agent_session_id}");

    let spec = service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "custom".to_owned(),
            agent_session_id: Some(agent_session_id.to_owned()),
            custom_command: Some("qwen --model max".to_owned()),
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare custom session");

    let session_root = temp
        .path()
        .join("agents")
        .join("sessions")
        .join(agent_session_id);
    assert_agent_launch_command(&spec, "qwen --model max");
    assert_eq!(spec.cwd, path_to_string(&session_root));
    assert_session_env(
        &spec,
        agent_session_id,
        temp.path(),
        &session_root,
        &scoped_endpoint,
    );
    assert!(session_root.join("AGENTS.md").is_file());
    assert!(session_root
        .join("context")
        .join("mcp-endpoint.json")
        .is_file());
    assert!(session_root
        .join("context")
        .join("target-binding.json")
        .is_file());
    assert!(session_root
        .join("context")
        .join("terminal-snapshot.json")
        .is_file());
    assert!(!session_root.join("CLAUDE.md").exists());
    assert!(!session_root.join(".codex").exists());
    assert!(!session_root.join(".mcp.json").exists());

    let endpoint_context: Value = serde_json::from_str(
        &fs::read_to_string(session_root.join("context").join("mcp-endpoint.json"))
            .expect("endpoint context"),
    )
    .expect("endpoint json");
    assert_eq!(
        endpoint_context
            .pointer("/endpoint")
            .and_then(Value::as_str),
        Some(scoped_endpoint.as_str())
    );
    assert_eq!(
        endpoint_context
            .pointer("/toolsOnly")
            .and_then(Value::as_bool),
        Some(true)
    );
}

fn assert_agent_launch_command(spec: &ExternalAgentLaunchSpec, command: &str) {
    assert_launch_parts(&spec.shell, &spec.args, command);
}

fn assert_launch_parts(shell: &str, args: &[String], command: &str) {
    #[cfg(windows)]
    {
        if shell.eq_ignore_ascii_case("cmd.exe") {
            let expected_args = vec![
                "/d".to_owned(),
                "/s".to_owned(),
                "/k".to_owned(),
                command.to_owned(),
            ];
            assert_eq!(args, expected_args.as_slice());
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
        let (expected_shell, expected_args) = split_command_line(command);
        assert_eq!(shell, expected_shell);
        assert_eq!(args, expected_args);
    }
}

#[cfg(windows)]
fn windows_command_available(command: &str) -> bool {
    Command::new(command)
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("$PSVersionTable.PSVersion.ToString()")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn prepare_custom_command_spec(command: &str) -> ExternalAgentLaunchSpec {
    let temp = tempfile::tempdir().expect("tempdir");
    let service = ExternalAgentWorkspaceService::new(
        temp.path(),
        Some("http://127.0.0.1:3005/mcp".to_owned()),
        true,
    );

    service
        .prepare(&PrepareExternalAgentWorkspaceRequest {
            agent_id: "custom".to_owned(),
            agent_session_id: None,
            custom_command: Some(command.to_owned()),
            resume_provider_session: false,
            dry_run: false,
            overwrite_policy: ExternalAgentOverwritePolicy::BackupAndReplaceInvalid,
        })
        .expect("prepare custom command")
}

#[cfg(not(windows))]
fn split_command_line(input: &str) -> (String, Vec<String>) {
    let chars = input.chars().collect::<Vec<_>>();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;

    while index < chars.len() {
        let char = chars[index];
        if char == '\\' {
            if let Some(next) = chars.get(index + 1).copied() {
                if next == '"' || next == '\'' || next == '\\' || next.is_whitespace() {
                    current.push(next);
                    index += 2;
                    continue;
                }
            }
            current.push(char);
            index += 1;
            continue;
        }
        if let Some(active_quote) = quote {
            if char == active_quote {
                quote = None;
            } else {
                current.push(char);
            }
            index += 1;
            continue;
        }
        if char == '"' || char == '\'' {
            quote = Some(char);
            index += 1;
            continue;
        }
        if char.is_whitespace() {
            if !current.is_empty() {
                parts.push(std::mem::take(&mut current));
            }
            index += 1;
            continue;
        }
        current.push(char);
        index += 1;
    }

    if !current.is_empty() {
        parts.push(current);
    }

    let shell = parts.first().cloned().expect("command shell");
    (shell, parts[1..].to_vec())
}

fn assert_session_env(
    spec: &ExternalAgentLaunchSpec,
    agent_session_id: &str,
    workspace_root: &Path,
    session_root: &Path,
    mcp_endpoint: &str,
) {
    let env = spec.env.as_ref().expect("session env");
    let expected_workspace_root = path_to_string(workspace_root);
    let expected_session_root = path_to_string(session_root);
    assert_eq!(
        env.get("KERMINAL_AGENT_SESSION_ID").map(String::as_str),
        Some(agent_session_id)
    );
    assert_eq!(
        env.get("KERMINAL_WORKSPACE_ROOT").map(String::as_str),
        Some(expected_workspace_root.as_str())
    );
    assert_eq!(
        env.get("KERMINAL_AGENT_SESSION_ROOT").map(String::as_str),
        Some(expected_session_root.as_str())
    );
    assert_eq!(
        env.get("KERMINAL_MCP_ENDPOINT").map(String::as_str),
        Some(mcp_endpoint)
    );
}
