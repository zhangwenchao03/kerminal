use super::support::*;

#[tokio::test]
async fn ssh_command_service_executes_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize external launch");
    fixture
        .intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");

    let backend = Arc::new(RecordingExecBackend::default());
    let manager = ManagedSshSessionManager::with_backend(Arc::clone(&backend));
    let service = SshCommandService::with_ssh_runtime(
        manager,
        fixture.auth_broker.clone(),
        fixture.materializer.clone(),
    );

    let output = service
        .execute_native(
            &fixture.paths,
            SshCommandRequest {
                host_id: target.host_id.clone(),
                command: "whoami".to_owned(),
                timeout_seconds: Some(5),
                max_output_bytes: Some(1024),
            },
        )
        .await
        .expect("execute managed external command");

    assert!(output.success);
    assert_eq!(output.host_id, target.host_id);
    assert_eq!(output.stdout, "external-exec: whoami\n");

    let key = backend.last_key().expect("runtime key");
    assert_eq!(key.target.host_id.as_deref(), Some(target.host_id.as_str()));
    assert_eq!(key.target.host, "example.internal");
    assert_eq!(key.target.username, "deploy");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::SessionOnly { ref prompt_id }
            if prompt_id == "ssh-auth:target:deploy@example.internal:2202:password"
    ));
    assert!(!format!("{key:?}").contains(PASSWORD_SECRET));
}

#[tokio::test]
async fn server_info_snapshot_native_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));
    let remote_hosts = empty_remote_hosts(&fixture.paths);

    let snapshot = ServerInfoService::new()
        .snapshot_native(
            &remote_hosts,
            &fixture.paths,
            &ssh_commands,
            ServerInfoRequest {
                host_id: target.host_id.clone(),
                target: RemoteTargetRef::Ssh {
                    host_id: target.host_id.clone(),
                },
            },
        )
        .await
        .expect("snapshot external target");

    assert_eq!(snapshot.host_id, target.host_id);
    assert_eq!(snapshot.host, "example.internal");
    assert_eq!(snapshot.port, 2202);
    assert_eq!(snapshot.username, "deploy");
    assert!(backend
        .scripts()
        .iter()
        .any(|script| script.contains("/proc/meminfo")));
}

#[tokio::test]
async fn tmux_probe_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));

    let status = TmuxService::new()
        .probe(
            &fixture.paths,
            &ssh_commands,
            TmuxProbeRequest {
                target: TmuxTargetRef {
                    target: RemoteTargetRef::Ssh {
                        host_id: target.host_id.clone(),
                    },
                    socket_name: None,
                    socket_path: None,
                    tmux_path: None,
                },
            },
        )
        .await
        .expect("probe tmux on external target");

    assert!(status.available);
    assert_eq!(status.version.as_deref(), Some("tmux 3.4"));
    assert!(backend
        .scripts()
        .iter()
        .any(|script| script.contains("'tmux' '-V'")));
}

#[tokio::test]
async fn docker_list_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));

    let containers = DockerHostService::new()
        .list_containers(
            &fixture.paths,
            &ssh_commands,
            DockerContainerListRequest {
                host_id: target.host_id.clone(),
                runtime: ContainerRuntime::Docker,
                include_stopped: false,
            },
        )
        .await
        .expect("list containers through external target");

    assert_eq!(containers.len(), 1);
    assert_eq!(containers[0].host_id, target.host_id);
    assert_eq!(containers[0].name, "api");
    assert!(backend
        .scripts()
        .iter()
        .any(|script| script.contains("docker") && script.contains(" ps")));
}

#[test]
fn port_forward_plan_uses_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let remote_hosts = empty_remote_hosts(&fixture.paths);
    let service = PortForwardService::with_external_targets(fixture.materializer.clone());

    let plan = service
        .build_plan_with_context(
            &remote_hosts,
            &fixture.paths,
            "ssh".to_owned(),
            &PortForwardCreateRequest {
                host_id: target.host_id.clone(),
                name: Some("external tunnel".to_owned()),
                kind: PortForwardKind::Local,
                bind_host: Some("127.0.0.1".to_owned()),
                source_port: 15432,
                target_host: Some("127.0.0.1".to_owned()),
                target_port: Some(5432),
                ..Default::default()
            },
        )
        .expect("build forward plan for external target");

    assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2202"]));
    assert_eq!(
        plan.args.last().map(String::as_str),
        Some("deploy@example.internal")
    );
    assert!(plan.command_preview.contains("-L"));
    assert!(!format!("{plan:?}").contains(PASSWORD_SECRET));
}

#[tokio::test]
async fn mcp_tools_use_materialized_external_target_without_host_toml() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let target = materialize_and_ack(&fixture, &launch_id);
    let state =
        AppState::initialize_with_paths(fixture.paths.clone()).expect("initialize app state");
    let backend = Arc::new(RecordingExecBackend::default());
    let ssh_commands = ssh_command_service_with_backend(&fixture, Arc::clone(&backend));
    let tools = state.mcp_tool_catalog().list_tools();
    let context = mcp_context(&state, &ssh_commands);

    let ssh_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "ssh.command",
            json!({
                "hostId": target.host_id,
                "command": "whoami"
            }),
        )
        .await
        .expect("execute MCP ssh.command");
    assert_eq!(ssh_output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        ssh_output.data["output"]["stdout"].as_str(),
        Some("external-exec: whoami\n")
    );

    let server_info_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "server_info.snapshot",
            json!({ "hostId": target.host_id }),
        )
        .await
        .expect("execute MCP server_info.snapshot");
    assert_eq!(server_info_output.status, McpToolExecutionStatus::Succeeded);

    let tmux_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "tmux.probe",
            json!({
                "targetKind": "ssh",
                "hostId": target.host_id
            }),
        )
        .await
        .expect("execute MCP tmux.probe");
    assert_eq!(tmux_output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(
        tmux_output.data["status"]["version"].as_str(),
        Some("tmux 3.4")
    );

    let container_output = state
        .mcp_tool_executor()
        .execute(
            context,
            &tools,
            "container.list",
            json!({
                "hostId": target.host_id,
                "runtime": "docker",
                "includeStopped": false
            }),
        )
        .await
        .expect("execute MCP container.list");
    assert_eq!(container_output.status, McpToolExecutionStatus::Succeeded);

    let scripts = backend.scripts();
    assert!(scripts.iter().any(|script| script == "whoami\n"));
    assert!(scripts
        .iter()
        .any(|script| script.contains("/proc/meminfo")));
    assert!(scripts.iter().any(|script| script.contains("'tmux' '-V'")));
    assert!(scripts
        .iter()
        .any(|script| script.contains("docker") && script.contains(" ps")));
    assert!(
        !format!("{ssh_output:?}{server_info_output:?}{tmux_output:?}{container_output:?}")
            .contains(PASSWORD_SECRET)
    );
}
