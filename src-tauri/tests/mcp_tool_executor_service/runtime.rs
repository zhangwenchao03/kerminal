use super::fixtures::*;

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
