use super::*;

#[tokio::test]
async fn native_sftp_service_uses_real_ssh_sftp_protocol() {
    let server_root = tempdir().expect("server root");
    fs::write(
        server_root.path().join("hello.txt"),
        b"hello from native loopback",
    )
    .await
    .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "loopback", server.addr.port());
    let known_hosts_path = state.paths().root.join("known_hosts");

    let strict_error = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect_err("strict host key policy rejects unknown loopback key");
    assert!(matches!(strict_error, AppError::Sftp(_)));
    assert!(
        !known_hosts_path.exists(),
        "strict SFTP connection must not learn an unknown host key"
    );

    trust_loopback_host(&state, &host_id).await;
    assert!(
        known_hosts_path.exists(),
        "explicit trust should persist the loopback host key"
    );

    let listing = state
        .sftp()
        .list_directory(
            state.paths(),
            SftpListDirectoryRequest {
                host_id: host_id.clone(),
                path: "/".to_owned(),
            },
        )
        .await
        .expect("list real SFTP directory");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "hello.txt" && entry.kind == SftpEntryKind::File));

    let preview = state
        .sftp()
        .preview_file(
            state.paths(),
            SftpPreviewRequest {
                host_id: host_id.clone(),
                path: "/hello.txt".to_owned(),
                max_bytes: Some(256),
            },
        )
        .await
        .expect("preview real SFTP file");
    assert_eq!(preview.content, "hello from native loopback");
    assert!(!preview.truncated);

    state
        .sftp()
        .create_directory(
            state.paths(),
            SftpPathRequest {
                host_id: host_id.clone(),
                path: "/managed".to_owned(),
            },
        )
        .await
        .expect("create real SFTP directory");
    assert!(server_root.path().join("managed").is_dir());
    fs::create_dir_all(server_root.path().join("managed/nested"))
        .await
        .expect("create nested remote directory");
    fs::write(
        server_root.path().join("managed/nested/app.log"),
        b"nested content",
    )
    .await
    .expect("write nested remote file");

    let client_root = tempdir().expect("client root");
    let upload_source = client_root.path().join("upload-source.txt");
    fs::write(&upload_source, b"uploaded over native SFTP")
        .await
        .expect("write local upload source");
    fs::write(
        server_root.path().join("uploaded.txt"),
        b"old remote content",
    )
    .await
    .expect("seed existing remote upload target");
    fs::write(
        server_root.path().join("uploaded.txt.kerminal-part"),
        b"uploaded over ",
    )
    .await
    .expect("seed resumable remote upload partial");
    state
        .sftp()
        .upload(
            state.paths(),
            SftpTransferRequest {
                host_id: host_id.clone(),
                remote_path: "/uploaded.txt".to_owned(),
                local_path: upload_source.to_string_lossy().into_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("upload over real SFTP");
    assert_eq!(
        fs::read_to_string(server_root.path().join("uploaded.txt"))
            .await
            .expect("read uploaded file"),
        "uploaded over native SFTP"
    );
    assert!(
        !server_root
            .path()
            .join("uploaded.txt.kerminal-part")
            .exists(),
        "successful upload should commit and remove the remote partial file"
    );

    state
        .sftp()
        .rename(
            state.paths(),
            SftpRenameRequest {
                host_id: host_id.clone(),
                from_path: "/uploaded.txt".to_owned(),
                to_path: "/renamed.txt".to_owned(),
            },
        )
        .await
        .expect("rename real SFTP file");
    state
        .sftp()
        .chmod(
            state.paths(),
            SftpChmodRequest {
                host_id: host_id.clone(),
                path: "/renamed.txt".to_owned(),
                mode: "600".to_owned(),
            },
        )
        .await
        .expect("chmod real SFTP file");

    let download_target = client_root.path().join("downloaded.txt");
    fs::write(&download_target, b"old local content")
        .await
        .expect("seed existing local download target");
    fs::write(
        client_root.path().join("downloaded.txt.kerminal-part"),
        b"hello ",
    )
    .await
    .expect("seed resumable local download partial");
    state
        .sftp()
        .download(
            state.paths(),
            SftpTransferRequest {
                host_id: host_id.clone(),
                remote_path: "/hello.txt".to_owned(),
                local_path: download_target.to_string_lossy().into_owned(),
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
            },
        )
        .await
        .expect("download over real SFTP");
    assert_eq!(
        fs::read_to_string(download_target)
            .await
            .expect("read downloaded file"),
        "hello from native loopback"
    );
    assert!(
        !client_root
            .path()
            .join("downloaded.txt.kerminal-part")
            .exists(),
        "successful download should commit and remove the local partial file"
    );

    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id: host_id.clone(),
                path: "/renamed.txt".to_owned(),
                directory: false,
            },
        )
        .await
        .expect("delete real SFTP file");
    state
        .sftp()
        .delete(
            state.paths(),
            SftpDeleteRequest {
                host_id,
                path: "/managed".to_owned(),
                directory: true,
            },
        )
        .await
        .expect("delete non-empty remote directory with rm -rf");
    assert!(!server_root.path().join("renamed.txt").exists());
    assert!(!server_root.path().join("managed").exists());
}
