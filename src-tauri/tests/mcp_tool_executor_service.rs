//! MCP tool executor rule tests.
//!
//! @author kongweiguang

mod support;

use kerminal_lib::{
    models::{
        agent_session::{AgentId, AgentSessionCreateRequest},
        port_forward::{
            PortForwardKind, PortForwardOrigin, PortForwardProxyApplyScope,
            PortForwardProxyProtocol, PortForwardRemoteAccessScope,
        },
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
        settings::{AppSettings, ExternalLaunchToolSetting},
        sftp::SftpTransferKind,
    },
    paths::KerminalPaths,
    services::{
        docker_host_service::rules::write_tar_stream,
        external_launch::{ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint},
        mcp_tool_executor_service::{
            rules::{
                port_forward_create_request_from_arguments, ssh_command_request_from_arguments,
            },
            McpToolExecutionContext, McpToolExecutionStatus,
        },
        ssh_command_service::SshCommandService,
        ssh_runtime::{ManagedSshSessionManager, SshAuthIdentity, SshAuthSecretKind},
    },
    state::AppState,
};
use serde_json::{json, Value};
use std::{fs, io::Read, path::Path, sync::Arc};
use support::managed_ssh_runtime::{ssh_command_service_with_fake_runtime, FakeManagedSshRuntime};
use tempfile::{tempdir, TempDir};

#[test]
fn parses_remote_dynamic_socks_arguments_for_mcp_tool_invocations() {
    let arguments = json!({
        "hostId": "host-a",
        "kind": "remoteDynamic",
        "proxyProtocol": "socks5",
        "remoteBindHost": "0.0.0.0",
        "remoteAccessScope": "allInterfaces",
        "proxyApplyScope": "toolOnly",
        "sourcePort": 18080
    });
    let arguments = arguments.as_object().expect("object args");

    let request =
        port_forward_create_request_from_arguments(arguments).expect("parse remote SOCKS");

    assert_eq!(request.host_id, "host-a");
    assert_eq!(request.origin, PortForwardOrigin::McpTool);
    assert_eq!(request.kind, PortForwardKind::RemoteDynamic);
    assert_eq!(
        request.proxy_protocol,
        Some(PortForwardProxyProtocol::Socks5)
    );
    assert_eq!(
        request.remote_access_scope,
        Some(PortForwardRemoteAccessScope::AllInterfaces)
    );
    assert_eq!(
        request.proxy_apply_scope,
        PortForwardProxyApplyScope::ToolOnly
    );
    assert_eq!(request.remote_bind_host.as_deref(), Some("0.0.0.0"));
    assert_eq!(request.local_endpoint, None);
}

#[test]
fn rejects_removed_http_proxy_protocol() {
    let arguments = json!({
        "hostId": "host-a",
        "kind": "remoteDynamic",
        "proxyProtocol": "http",
        "sourcePort": 18080
    });
    let arguments = arguments.as_object().expect("object args");

    let error =
        port_forward_create_request_from_arguments(arguments).expect_err("invalid proxy protocol");

    assert!(error.to_string().contains("proxyProtocol 只支持"));
}

#[test]
fn wraps_agent_ssh_command_with_http_proxy_exports() {
    let arguments = json!({
        "hostId": "host-a",
        "command": "curl -I https://example.com",
        "proxyUrl": "http://127.0.0.1:18080",
        "proxyProtocol": "http"
    });
    let arguments = arguments.as_object().expect("object args");

    let request = ssh_command_request_from_arguments(arguments).expect("parse ssh command");

    assert_eq!(request.host_id, "host-a");
    assert!(request
        .command
        .starts_with("export HTTP_PROXY='http://127.0.0.1:18080'\n"));
    assert!(request
        .command
        .contains("export HTTPS_PROXY='http://127.0.0.1:18080'\n"));
    assert!(request.command.ends_with("curl -I https://example.com"));
}

#[test]
fn wraps_agent_ssh_command_with_socks_proxy_exports() {
    let arguments = json!({
        "hostId": "host-a",
        "command": "git ls-remote origin",
        "proxyUrl": "socks5h://127.0.0.1:18080"
    });
    let arguments = arguments.as_object().expect("object args");

    let request = ssh_command_request_from_arguments(arguments).expect("parse ssh command");

    assert!(request
        .command
        .starts_with("export ALL_PROXY='socks5h://127.0.0.1:18080'\n"));
    assert!(request.command.ends_with("git ls-remote origin"));
}

#[test]
fn rejects_invalid_agent_ssh_command_proxy_url() {
    let arguments = json!({
        "hostId": "host-a",
        "command": "curl example.com",
        "proxyUrl": "file:///tmp/proxy"
    });
    let arguments = arguments.as_object().expect("object args");

    let error = ssh_command_request_from_arguments(arguments).expect_err("invalid proxy url");

    assert!(error.to_string().contains("proxyUrl 只支持"));
}

#[tokio::test]
async fn mcp_ssh_command_uses_managed_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("mcp-managed\n"));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, &ssh_commands),
            &tools,
            "ssh.command",
            json!({
                "hostId": host_id,
                "command": "printf mcp-managed"
            }),
        )
        .await
        .expect("execute MCP ssh.command through managed exec");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    assert_eq!(
        backend.last_exec_script(),
        Some("printf mcp-managed\n".to_owned())
    );
    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ..
        }
    ));
    assert!(!format!("{key:?}").contains("correct horse"));
}

#[tokio::test]
async fn mcp_container_files_upload_uses_managed_streaming_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    backend.set_streaming_output(Vec::new(), Vec::new(), Some(0));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();
    let temp = tempdir().expect("tempdir");
    let source = temp.path().join("source.txt");
    std::fs::write(&source, "hello from mcp container upload").expect("write source");

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, &ssh_commands),
            &tools,
            "container.files.upload",
            json!({
                "hostId": host_id,
                "containerId": "container-1",
                "runtime": "docker",
                "remotePath": "/var/lib/app/target.txt",
                "localPath": source.to_string_lossy(),
                "kind": "file"
            }),
        )
        .await
        .expect("execute MCP container upload through managed streaming exec");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert!(output
        .summary
        .as_deref()
        .expect("upload summary")
        .contains("已上传到容器"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 0);
    assert_eq!(backend.streaming_exec_count(), 1);
    let command = backend
        .last_streaming_exec_command()
        .expect("streaming exec command");
    assert!(command.contains("docker"));
    assert!(command.contains("cp -"));
    assert!(command.contains("container-1:/var/lib/app"));

    let mut archive = tar::Archive::new(std::io::Cursor::new(backend.last_streaming_stdin()));
    let mut entries = archive.entries().expect("tar entries");
    let mut entry = entries
        .next()
        .expect("first tar entry")
        .expect("read tar entry");
    assert_eq!(
        entry.path().expect("entry path").as_ref(),
        Path::new("target.txt")
    );
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .expect("read uploaded tar");
    assert_eq!(content, "hello from mcp container upload");

    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ..
        }
    ));
    let serialized = format!(
        "{}{}{:?}",
        output.data,
        output.summary.as_deref().unwrap_or_default(),
        key
    );
    assert!(!serialized.contains("correct horse"));
    assert!(!serialized.contains("battery staple"));
}

#[tokio::test]
async fn mcp_container_files_download_uses_managed_streaming_exec_runtime() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::default());
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();
    let temp = tempdir().expect("tempdir");
    let remote_source = temp.path().join("remote.txt");
    let local_target = temp.path().join("downloaded.txt");
    std::fs::write(&remote_source, "downloaded through mcp managed stream").expect("write remote");
    let mut tar_bytes = Vec::new();
    write_tar_stream(
        &mut tar_bytes,
        &remote_source,
        "remote.txt",
        SftpTransferKind::File,
    )
    .expect("build remote tar");
    backend.set_streaming_output(tar_bytes, Vec::new(), Some(0));

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, &ssh_commands),
            &tools,
            "container.files.download",
            json!({
                "hostId": host_id,
                "containerId": "container-1",
                "runtime": "docker",
                "remotePath": "/var/lib/app/remote.txt",
                "localPath": local_target.to_string_lossy(),
                "kind": "file"
            }),
        )
        .await
        .expect("execute MCP container download through managed streaming exec");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert!(output
        .summary
        .as_deref()
        .expect("download summary")
        .contains("已下载到本地"));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 0);
    assert_eq!(backend.streaming_exec_count(), 1);
    let command = backend
        .last_streaming_exec_command()
        .expect("streaming exec command");
    assert!(command.contains("docker"));
    assert!(command.contains("cp"));
    assert!(command.contains("container-1:/var/lib/app/remote.txt"));
    assert!(command.ends_with(" -"));
    assert_eq!(
        std::fs::read_to_string(&local_target).expect("read downloaded"),
        "downloaded through mcp managed stream"
    );
    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    let serialized = format!(
        "{}{}{:?}",
        output.data,
        output.summary.as_deref().unwrap_or_default(),
        key
    );
    assert!(!serialized.contains("correct horse"));
    assert!(!serialized.contains("battery staple"));
}

#[tokio::test]
async fn mcp_runtime_snapshot_reports_external_launch_policy_without_secrets() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();
    let mut settings = AppSettings::default();
    settings.external_launch.enabled = false;
    settings.external_launch.accept_vendor_args = false;
    settings.external_launch.shim_bridge.enabled = false;
    settings.external_launch.auto_open_sftp = true;
    settings.external_launch.disabled_tools = vec![ExternalLaunchToolSetting::Putty];
    state
        .update_settings(settings)
        .expect("configure external launch policy");

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["enabled"],
        false
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["acceptVendorArgs"],
        false
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["shimBridgeEnabled"],
        false
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["autoOpenSftp"],
        true
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["policy"]["disabledTools"],
        json!(["putty"])
    );
    assert_eq!(output.data["runtime"]["externalLaunchPendingCount"], 0);
    assert_eq!(output.data["runtime"]["externalLaunchActiveSecretCount"], 0);
    let serialized = output.data.to_string();
    assert!(!serialized.contains("external-secret:"));
    assert!(!serialized.contains("correct horse"));
}

#[tokio::test]
async fn mcp_runtime_snapshot_reports_external_launch_rejection_without_raw_args_or_secrets() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let outcome = state
        .external_launch_intake()
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "not-a-port".to_owned(),
                "-pw".to_owned(),
                "KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("record rejected launch");
    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Rejected(_)));

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["externalLaunch"]["intake"]["rejectedCount"], 1);
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["entrypoint"],
        "direct-argv"
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["sourceTool"],
        "putty"
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["argCount"],
        7
    );
    assert_eq!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["cwdPresent"],
        true
    );
    assert!(
        output.data["externalLaunch"]["intake"]["lastRejection"]["rawHash"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );

    let serialized = output.data.to_string();
    assert!(!serialized.contains("KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE"));
    assert!(!serialized.contains("ops@example.internal"));
    assert!(!serialized.contains("not-a-port"));
    assert!(!serialized.contains("-pw"));
}

#[tokio::test]
async fn mcp_capabilities_exposes_managed_ssh_runtime_guidance() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.capabilities",
            json!({}),
        )
        .await
        .expect("capabilities");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        output.data["managedSshRuntime"]["inspectTool"],
        "kerminal.runtime_snapshot"
    );
    assert_eq!(
        output.data["managedSshRuntime"]["snapshotPath"],
        "managedSsh"
    );
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["appliesToFamilies"],
        "sftp"
    ));
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["appliesToFamilies"],
        "portForward"
    ));

    let ssh_family = output.data["runtimeToolFamilies"]
        .as_array()
        .and_then(|families| {
            families
                .iter()
                .find(|family| family["family"].as_str() == Some("ssh"))
        })
        .expect("ssh family");
    assert!(ssh_family["useWhen"]
        .as_str()
        .expect("ssh useWhen")
        .contains("managed SSH exec facade"));
}

#[tokio::test]
async fn mcp_tool_help_query_managed_ssh_discovers_runtime_snapshot() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.tool_help",
            json!({
                "query": "managed ssh session reuse",
                "includeSchemas": false
            }),
        )
        .await
        .expect("tool help managed ssh query");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["matchMode"], "query");
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.runtime_snapshot"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "ssh.command"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "sftp.list"
    ));
    assert_eq!(
        output.data["managedSshRuntime"]["snapshotPath"],
        "managedSsh"
    );
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].pendingExecRequests"
    ));
    assert!(value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].lastError"
    ));
    assert!(!value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].queueDepth"
    ));
    assert!(!value_array_contains_str(
        &output.data["managedSshRuntime"]["diagnosticFields"],
        "managedSsh.sessions[].recentFailure"
    ));
    assert!(output.data["managedSshRuntime"]["fallbackRule"]
        .as_str()
        .expect("fallback rule")
        .contains("unsupported or unwired"));
}

#[tokio::test]
async fn mcp_tool_help_query_external_launch_discovers_runtime_and_config_without_control_tools() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.tool_help",
            json!({
                "query": "external launch bastion putty jump host",
                "includeSchemas": false
            }),
        )
        .await
        .expect("tool help external launch query");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["matchMode"], "query");
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.runtime_snapshot"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.config_guide"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.operation_guide"
    ));
    assert!(value_array_contains_str(
        &output.data["availableToolIds"],
        "kerminal.config.validate"
    ));
    assert!(output.data["availableToolIds"]
        .as_array()
        .expect("available tool ids")
        .iter()
        .all(|tool_id| !tool_id
            .as_str()
            .unwrap_or_default()
            .starts_with("external_launch.")));
    assert!(output.data["safetyBoundaries"]["externalLaunch"]
        .as_str()
        .expect("external launch boundary")
        .contains("redacted rejection metadata"));

    let serialized = output.data.to_string();
    assert!(!serialized.contains("KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE"));
    assert!(!serialized.contains("external-secret:"));
}

#[tokio::test]
async fn mcp_operation_guide_sftp_requires_managed_ssh_runtime_inspection() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.operation_guide",
            json!({ "intent": "sftp" }),
        )
        .await
        .expect("sftp operation guide");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["intent"], "sftp");
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.runtime_snapshot"
    ));
    assert_eq!(
        output.data["managedSshRuntime"]["inspectTool"],
        "kerminal.runtime_snapshot"
    );
    let workflow = output.data["workflow"].as_array().expect("workflow");
    assert_eq!(workflow[0]["phase"], "inspect-runtime");
    assert_eq!(workflow[0]["toolId"], "kerminal.runtime_snapshot");
    assert!(workflow[0]["action"]
        .as_str()
        .expect("inspect runtime action")
        .contains("managedSsh session/channel diagnostics"));
}

#[tokio::test]
async fn mcp_operation_guide_external_launch_uses_file_first_redacted_policy() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "kerminal.operation_guide",
            json!({ "intent": "external-launch" }),
        )
        .await
        .expect("external launch operation guide");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["intent"], "external-launch");
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.runtime_snapshot"
    ));
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.config_guide"
    ));
    assert!(value_array_contains_str(
        &output.data["recommendedFirstCalls"],
        "kerminal.config.validate"
    ));
    let workflow = output.data["workflow"].as_array().expect("workflow");
    assert_eq!(workflow[0]["phase"], "inspect-runtime");
    assert_eq!(workflow[0]["toolId"], "kerminal.runtime_snapshot");
    assert!(workflow[0]["action"]
        .as_str()
        .expect("inspect action")
        .contains("redacted last rejection"));
    assert_eq!(workflow[1]["phase"], "read-config-rules");
    assert_eq!(workflow[1]["toolId"], "kerminal.config_guide");
    assert!(workflow[2]["action"]
        .as_str()
        .expect("edit policy action")
        .contains("settings.toml externalLaunch"));
    assert!(output.data["safetyBoundaries"]["externalLaunch"]
        .as_str()
        .expect("external launch boundary")
        .contains("settings.toml externalLaunch"));

    let serialized = output.data.to_string();
    assert!(!serialized.contains("KERM_FIXTURE_MCP_REJECTED_SECRET_DO_NOT_USE"));
    assert!(!serialized.contains("external-secret:"));
}

#[tokio::test]
async fn mcp_runtime_snapshot_reports_managed_ssh_runtime_without_secrets() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("managed snapshot\n"));
    let ssh_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let ssh_commands = SshCommandService::with_ssh_runtime(
        ssh_runtime.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let tools = state.mcp_tool_catalog().list_tools();

    state
        .mcp_tool_executor()
        .execute(
            mcp_context_with_ssh_runtime(&state, &ssh_commands, &ssh_runtime),
            &tools,
            "ssh.command",
            json!({
                "hostId": host_id,
                "command": "printf managed-snapshot"
            }),
        )
        .await
        .expect("prime managed SSH runtime through MCP ssh.command");

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context_with_ssh_runtime(&state, &ssh_commands, &ssh_runtime),
            &tools,
            "kerminal.runtime_snapshot",
            json!({}),
        )
        .await
        .expect("runtime snapshot with managed SSH diagnostics");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["runtime"]["managedSshActiveSessionCount"], 1);
    assert_eq!(output.data["runtime"]["managedSshActiveChannelCount"], 0);
    assert_eq!(output.data["managedSsh"]["activeSessions"], 1);
    assert_eq!(output.data["managedSsh"]["activeChannels"], 0);
    assert_eq!(
        output.data["managedSsh"]["recentLegacyFallbacks"],
        json!([])
    );
    assert_eq!(
        output.data["managedSsh"]["sessions"][0]["key"]["target"],
        "deploy@dev.internal:2222"
    );
    assert_eq!(
        output.data["managedSsh"]["sessions"][0]["channelCounts"]["exec"],
        1
    );
    assert_eq!(backend.connect_count(), 1);

    let serialized = output.data.to_string();
    assert!(!serialized.contains("correct horse"));
    assert!(!serialized.contains("battery staple"));
    assert!(!serialized.contains("kerminal://host/"));
}

#[tokio::test]
async fn mcp_tool_call_log_includes_redacted_runtime_audit() {
    let (_home, state) = test_state();
    let agent = state
        .agent_sessions()
        .create_session(AgentSessionCreateRequest {
            agent_id: AgentId::Codex,
            title: Some("runtime audit".to_owned()),
            launch: None,
            target: None,
            provider: None,
            mcp_endpoint: None,
        })
        .expect("create agent session");
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout("audit ok\n"));
    let ssh_runtime = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let ssh_commands = SshCommandService::with_ssh_runtime(
        ssh_runtime.clone(),
        state.ssh_auth_broker().clone(),
        state.external_session_materializer().clone(),
    );
    let tools = state.mcp_tool_catalog().list_tools();

    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context_with_ssh_runtime(&state, &ssh_commands, &ssh_runtime),
            &tools,
            "ssh.command",
            json!({
                "agentSessionId": agent.session.agent_session_id.as_str(),
                "hostId": host_id,
                "command": "printf audit"
            }),
        )
        .await
        .expect("execute MCP ssh.command with agent call log");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    let log_path = Path::new(&agent.paths.session_root)
        .join("logs")
        .join("mcp-calls.jsonl");
    let log = fs::read_to_string(log_path).expect("mcp call log");
    let line: Value = serde_json::from_str(log.trim()).expect("log json");
    let audit = line
        .pointer("/runtimeAudit")
        .and_then(Value::as_str)
        .expect("runtime audit");

    assert!(audit.contains("tool=ssh.command"));
    assert!(audit.contains("hostId="));
    assert!(audit.contains("backend=managed-ssh-runtime"));
    assert!(audit.contains("activeSessions=1"));
    assert!(audit.contains("deploy@dev.internal:2222"));
    assert!(!log.contains("correct horse"));
    assert!(!log.contains("battery staple"));
    assert!(!log.contains("kerminal://host/"));
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn mcp_context<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
) -> McpToolExecutionContext<'a> {
    mcp_context_with_ssh_runtime(state, ssh_commands, state.ssh_runtime())
}

fn mcp_context_with_ssh_runtime<'a>(
    state: &'a AppState,
    ssh_commands: &'a SshCommandService,
    ssh_runtime: &'a ManagedSshSessionManager,
) -> McpToolExecutionContext<'a> {
    McpToolExecutionContext {
        agent_sessions: state.agent_sessions(),
        command_history: state.command_history(),
        command_store: state.command_store(),
        diagnostics: state.diagnostics(),
        docker_hosts: state.docker_hosts(),
        external_launch_intake: state.external_launch_intake(),
        external_launch_tasks: state.external_launch_tasks(),
        paths: state.paths(),
        port_forwards: state.port_forwards(),
        remote_hosts: state.remote_hosts(),
        server_info: state.server_info(),
        settings: state.settings(),
        sftp: state.sftp(),
        ssh_commands,
        ssh_runtime,
        storage: state.storage(),
        terminal_session_bindings: state.terminal_session_bindings(),
        terminals: state.terminals(),
        tmux: state.tmux(),
    }
}

fn create_saved_password_host(state: &AppState) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("correct horse battery staple".to_owned()),
            group_id: None,
            host: "dev.internal".to_owned(),
            name: "dev".to_owned(),
            port: 2222,
            production: false,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
        })
        .expect("create saved password host")
        .id
}

fn value_array_contains_str(value: &Value, expected: &str) -> bool {
    value
        .as_array()
        .map(|items| items.iter().any(|item| item.as_str() == Some(expected)))
        .unwrap_or(false)
}
