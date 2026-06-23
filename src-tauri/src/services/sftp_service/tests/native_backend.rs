use super::*;
use crate::models::sftp::SftpTransferConflictPolicy;

#[tokio::test]
async fn native_sftp_backend_uses_real_ssh_sftp_protocol() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    fs::write(
        server_root.path().join("hello.txt"),
        b"hello from native loopback",
    )
    .await
    .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let endpoint = SftpEndpoint {
        host: RemoteHost {
            id: "loopback".to_owned(),
            group_id: None,
            name: "loopback".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: server.addr.port(),
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path: known_hosts_path.clone(),
    };
    let backend = RusshSftpBackend;

    let strict_error = backend
        .list_directory(endpoint.clone(), "/".to_owned(), settings)
        .await
        .expect_err("strict host key policy rejects unknown loopback key");
    assert!(matches!(strict_error, AppError::Sftp(_)));
    assert!(
        !known_hosts_path.exists(),
        "strict SFTP connection must not learn an unknown host key"
    );

    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");
    assert!(
        known_hosts_path.exists(),
        "explicit trust should persist the loopback host key"
    );

    let listing = backend
        .list_directory(endpoint.clone(), "/".to_owned(), settings)
        .await
        .expect("list real SFTP directory");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "hello.txt" && entry.kind == SftpEntryKind::File));

    let preview = backend
        .preview_file(endpoint.clone(), "/hello.txt".to_owned(), 256, settings)
        .await
        .expect("preview real SFTP file");
    assert_eq!(preview.content, "hello from native loopback");
    assert!(!preview.truncated);

    backend
        .create_directory(endpoint.clone(), "/managed".to_owned(), settings)
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

    let upload_source = client_root.path().join("upload-source.txt");
    fs::write(&upload_source, b"uploaded over native SFTP")
        .await
        .expect("write local upload source");
    backend
        .transfer(
            endpoint.clone(),
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/uploaded.txt".to_owned(),
                local_path: upload_source.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("upload over real SFTP");
    assert_eq!(
        fs::read_to_string(server_root.path().join("uploaded.txt"))
            .await
            .expect("read uploaded file"),
        "uploaded over native SFTP"
    );

    backend
        .rename(
            endpoint.clone(),
            "/uploaded.txt".to_owned(),
            "/renamed.txt".to_owned(),
            settings,
        )
        .await
        .expect("rename real SFTP file");
    backend
        .chmod(endpoint.clone(), "/renamed.txt".to_owned(), 0o600, settings)
        .await
        .expect("chmod real SFTP file");

    let download_target = client_root.path().join("downloaded.txt");
    backend
        .transfer(
            endpoint.clone(),
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/hello.txt".to_owned(),
                local_path: download_target.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("download over real SFTP");
    assert_eq!(
        fs::read_to_string(download_target)
            .await
            .expect("read downloaded file"),
        "hello from native loopback"
    );

    backend
        .delete(endpoint.clone(), "/renamed.txt".to_owned(), false, settings)
        .await
        .expect("delete real SFTP file");
    backend
        .delete(endpoint, "/managed".to_owned(), true, settings)
        .await
        .expect("delete non-empty remote directory with rm -rf");
    assert!(!server_root.path().join("renamed.txt").exists());
    assert!(!server_root.path().join("managed").exists());
}

#[tokio::test]
async fn native_sftp_backend_reads_and_writes_text_files_with_revision_conflict() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    fs::write(server_root.path().join("config.toml"), b"port = 8080\n")
        .await
        .expect("seed remote config");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let endpoint = SftpEndpoint {
        host: RemoteHost {
            id: "loopback".to_owned(),
            group_id: None,
            name: "loopback".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: server.addr.port(),
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path: known_hosts_path.clone(),
    };
    let backend = RusshSftpBackend;
    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");

    let opened = backend
        .read_text_file(endpoint.clone(), "/config.toml".to_owned(), 4096, settings)
        .await
        .expect("read remote text file");
    assert_eq!(opened.content, "port = 8080\n");
    assert_eq!(opened.line_ending, "lf");
    assert!(!opened.readonly);
    assert!(opened.revision.content_sha256.is_some());

    fs::write(server_root.path().join("config.toml"), b"port = 9090\n")
        .await
        .expect("simulate external remote write");

    let stale_save = backend
        .write_text_file(
            endpoint.clone(),
            "/config.toml".to_owned(),
            SftpWriteTextFileRequest {
                host_id: "loopback".to_owned(),
                path: "/config.toml".to_owned(),
                content: "port = 7070\n".to_owned(),
                encoding: "utf-8".to_owned(),
                expected_revision: Some(opened.revision.clone()),
                create: false,
                overwrite_on_conflict: false,
            },
            settings,
        )
        .await
        .expect_err("reject stale revision save");
    assert!(matches!(stale_save, AppError::Sftp(message) if message.contains("远端文件已变更")));
    assert_eq!(
        fs::read_to_string(server_root.path().join("config.toml"))
            .await
            .expect("read conflicted file"),
        "port = 9090\n"
    );

    let saved = backend
        .write_text_file(
            endpoint.clone(),
            "/config.toml".to_owned(),
            SftpWriteTextFileRequest {
                host_id: "loopback".to_owned(),
                path: "/config.toml".to_owned(),
                content: "port = 7070\n".to_owned(),
                encoding: "utf-8".to_owned(),
                expected_revision: Some(opened.revision),
                create: false,
                overwrite_on_conflict: true,
            },
            settings,
        )
        .await
        .expect("overwrite stale revision");
    assert_eq!(saved.bytes_written, "port = 7070\n".len());
    assert_eq!(
        fs::read_to_string(server_root.path().join("config.toml"))
            .await
            .expect("read overwritten file"),
        "port = 7070\n"
    );

    let stat = backend
        .stat_path(endpoint, "/config.toml".to_owned(), settings)
        .await
        .expect("stat saved text file");
    assert_eq!(stat.kind, SftpEntryKind::File);
    assert_eq!(
        stat.revision
            .expect("file revision")
            .content_sha256
            .expect("stat sha"),
        saved.revision.content_sha256.expect("saved sha")
    );
}

#[tokio::test]
async fn native_sftp_backend_transfers_large_files_with_default_settings() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    let upload_source = client_root.path().join("large-upload.bin");
    let download_target = client_root.path().join("large-download.bin");
    let payload = (0..(900 * 1024))
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    fs::write(&upload_source, &payload)
        .await
        .expect("write large upload source");

    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings::default();
    let endpoint = SftpEndpoint {
        host: RemoteHost {
            id: "loopback".to_owned(),
            group_id: None,
            name: "loopback".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: server.addr.port(),
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path: known_hosts_path.clone(),
    };
    let backend = RusshSftpBackend;
    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");

    backend
        .transfer(
            endpoint.clone(),
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/large.bin".to_owned(),
                local_path: upload_source.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("upload large file with default settings");

    backend
        .transfer(
            endpoint,
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/large.bin".to_owned(),
                local_path: download_target.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("download large file with default settings");

    assert_eq!(
        fs::read(download_target)
            .await
            .expect("read large downloaded file"),
        payload
    );
}

#[tokio::test]
async fn native_sftp_backend_streams_remote_copy_between_hosts() {
    let source_root = tempdir().expect("source server root");
    let target_root = tempdir().expect("target server root");
    let client_root = tempdir().expect("client root");
    fs::write(
        source_root.path().join("artifact.txt"),
        b"streamed remote copy",
    )
    .await
    .expect("seed source remote file");
    fs::create_dir_all(source_root.path().join("release/nested"))
        .await
        .expect("seed source nested directory");
    fs::write(
        source_root.path().join("release/README.md"),
        b"release notes",
    )
    .await
    .expect("seed source release readme");
    fs::write(
        source_root.path().join("release/nested/app.log"),
        b"nested streamed remote copy",
    )
    .await
    .expect("seed source nested release file");
    let source_server = start_loopback_sftp_server(source_root.path().to_path_buf()).await;
    let target_server = start_loopback_sftp_server(target_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        global_transfers: 2,
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let source_endpoint = SftpEndpoint {
        host: RemoteHost {
            id: "source-loopback".to_owned(),
            group_id: None,
            name: "source loopback".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: source_server.addr.port(),
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path: known_hosts_path.clone(),
    };
    let target_endpoint = SftpEndpoint {
        host: RemoteHost {
            id: "target-loopback".to_owned(),
            group_id: None,
            name: "target loopback".to_owned(),
            host: "127.0.0.1".to_owned(),
            port: target_server.addr.port(),
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path: known_hosts_path.clone(),
    };
    let backend = RusshSftpBackend;

    trust_native_host_key(&source_endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust source host key");
    trust_native_host_key(&target_endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust target host key");
    backend
        .remote_copy(
            source_endpoint.clone(),
            target_endpoint.clone(),
            SftpRemoteCopyRequest {
                source_host_id: "source-loopback".to_owned(),
                source_remote_path: "/artifact.txt".to_owned(),
                target_host_id: "target-loopback".to_owned(),
                target_remote_path: "/copied.txt".to_owned(),
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("stream remote copy over real SFTP");

    assert_eq!(
        fs::read_to_string(target_root.path().join("copied.txt"))
            .await
            .expect("read copied target file"),
        "streamed remote copy"
    );

    fs::write(
        source_root.path().join("artifact.txt"),
        b"renamed remote copy",
    )
    .await
    .expect("update source artifact");
    backend
        .remote_copy(
            source_endpoint.clone(),
            target_endpoint.clone(),
            SftpRemoteCopyRequest {
                source_host_id: "source-loopback".to_owned(),
                source_remote_path: "/artifact.txt".to_owned(),
                target_host_id: "target-loopback".to_owned(),
                target_remote_path: "/copied.txt".to_owned(),
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Skip,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("skip conflicting remote copy target");
    assert_eq!(
        fs::read_to_string(target_root.path().join("copied.txt"))
            .await
            .expect("read skipped target file"),
        "streamed remote copy"
    );

    backend
        .remote_copy(
            source_endpoint.clone(),
            target_endpoint.clone(),
            SftpRemoteCopyRequest {
                source_host_id: "source-loopback".to_owned(),
                source_remote_path: "/artifact.txt".to_owned(),
                target_host_id: "target-loopback".to_owned(),
                target_remote_path: "/copied.txt".to_owned(),
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Rename,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("rename conflicting remote copy target");
    assert_eq!(
        fs::read_to_string(target_root.path().join("copied (1).txt"))
            .await
            .expect("read renamed target file"),
        "renamed remote copy"
    );

    backend
        .remote_copy(
            source_endpoint,
            target_endpoint,
            SftpRemoteCopyRequest {
                source_host_id: "source-loopback".to_owned(),
                source_remote_path: "/release".to_owned(),
                target_host_id: "target-loopback".to_owned(),
                target_remote_path: "/release-copy".to_owned(),
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("stream remote directory copy over real SFTP");
    assert_eq!(
        fs::read_to_string(target_root.path().join("release-copy/README.md"))
            .await
            .expect("read copied directory readme"),
        "release notes"
    );
    assert_eq!(
        fs::read_to_string(target_root.path().join("release-copy/nested/app.log"))
            .await
            .expect("read copied nested target file"),
        "nested streamed remote copy"
    );
}

#[tokio::test]
async fn native_sftp_backend_falls_back_to_directory_for_file_requests() {
    let source_root = tempdir().expect("source server root");
    let target_root = tempdir().expect("target server root");
    let client_root = tempdir().expect("client root");
    fs::create_dir_all(source_root.path().join("release/nested"))
        .await
        .expect("seed source nested directory");
    fs::write(
        source_root.path().join("release/README.md"),
        b"release notes",
    )
    .await
    .expect("seed source readme");
    fs::write(
        source_root.path().join("release/nested/app.log"),
        b"nested file request fallback",
    )
    .await
    .expect("seed source nested file");

    let source_server = start_loopback_sftp_server(source_root.path().to_path_buf()).await;
    let target_server = start_loopback_sftp_server(target_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        global_transfers: 2,
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let source_endpoint = loopback_endpoint(
        "source-loopback",
        "source loopback",
        source_server.addr.port(),
        known_hosts_path.clone(),
    );
    let target_endpoint = loopback_endpoint(
        "target-loopback",
        "target loopback",
        target_server.addr.port(),
        known_hosts_path.clone(),
    );
    let backend = RusshSftpBackend;

    trust_native_host_key(&source_endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust source host key");
    trust_native_host_key(&target_endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust target host key");

    let download_target = client_root.path().join("release-download");
    backend
        .transfer(
            source_endpoint.clone(),
            SftpManagedTransferRequest {
                host_id: "source-loopback".to_owned(),
                remote_path: "/release".to_owned(),
                local_path: download_target.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("download directory through file request fallback");
    assert_eq!(
        fs::read_to_string(download_target.join("README.md"))
            .await
            .expect("read downloaded readme"),
        "release notes"
    );
    assert_eq!(
        fs::read_to_string(download_target.join("nested/app.log"))
            .await
            .expect("read downloaded nested file"),
        "nested file request fallback"
    );

    backend
        .remote_copy(
            source_endpoint,
            target_endpoint,
            SftpRemoteCopyRequest {
                source_host_id: "source-loopback".to_owned(),
                source_remote_path: "/release".to_owned(),
                target_host_id: "target-loopback".to_owned(),
                target_remote_path: "/release-copy".to_owned(),
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("remote copy directory through file request fallback");
    assert_eq!(
        fs::read_to_string(target_root.path().join("release-copy/README.md"))
            .await
            .expect("read copied readme"),
        "release notes"
    );
    assert_eq!(
        fs::read_to_string(target_root.path().join("release-copy/nested/app.log"))
            .await
            .expect("read copied nested file"),
        "nested file request fallback"
    );
}

#[tokio::test]
async fn native_sftp_backend_downloads_directory_symlink_from_file_request() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    fs::create_dir_all(server_root.path().join("usr/lib32/pkg"))
        .await
        .expect("seed linked directory");
    fs::write(
        server_root.path().join("usr/lib32/pkg/libsample.so"),
        b"linked directory payload",
    )
    .await
    .expect("seed linked directory file");

    let server = start_loopback_sftp_server_with_symlinks(
        server_root.path().to_path_buf(),
        vec![("/lib32".to_owned(), "/usr/lib32".to_owned())],
    )
    .await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let endpoint = loopback_endpoint(
        "loopback",
        "loopback",
        server.addr.port(),
        known_hosts_path.clone(),
    );
    let backend = RusshSftpBackend;

    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");

    let download_target = client_root.path().join("lib32");
    backend
        .transfer(
            endpoint,
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/lib32".to_owned(),
                local_path: download_target.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("download directory symlink through file request fallback");
    assert_eq!(
        fs::read_to_string(download_target.join("pkg/libsample.so"))
            .await
            .expect("read downloaded linked directory file"),
        "linked directory payload"
    );
}

#[tokio::test]
async fn native_sftp_backend_download_directory_skip_does_not_merge_existing_local_root() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    fs::create_dir_all(server_root.path().join("release/nested"))
        .await
        .expect("seed remote directory");
    fs::write(server_root.path().join("release/nested/new.txt"), b"remote")
        .await
        .expect("seed remote file");
    let download_target = client_root.path().join("release");
    fs::create_dir_all(download_target.join("nested"))
        .await
        .expect("seed local directory");
    fs::write(download_target.join("nested/existing.txt"), b"local")
        .await
        .expect("seed local file");

    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let endpoint = loopback_endpoint(
        "loopback",
        "loopback",
        server.addr.port(),
        known_hosts_path.clone(),
    );
    let backend = RusshSftpBackend;
    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");

    backend
        .transfer(
            endpoint,
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/release".to_owned(),
                local_path: download_target.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Skip,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("skip existing local directory root");

    assert_eq!(
        fs::read_to_string(download_target.join("nested/existing.txt"))
            .await
            .expect("read existing local file"),
        "local"
    );
    assert!(!download_target.join("nested/new.txt").exists());
}

#[tokio::test]
async fn native_sftp_backend_upload_directory_rename_creates_new_remote_root() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    let upload_source = client_root.path().join("release");
    fs::create_dir_all(upload_source.join("nested"))
        .await
        .expect("seed upload source directory");
    fs::write(upload_source.join("nested/new.txt"), b"new upload")
        .await
        .expect("seed upload source file");
    fs::create_dir_all(server_root.path().join("release/nested"))
        .await
        .expect("seed existing remote directory");
    fs::write(
        server_root.path().join("release/nested/existing.txt"),
        b"existing remote",
    )
    .await
    .expect("seed existing remote file");

    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let endpoint = loopback_endpoint(
        "loopback",
        "loopback",
        server.addr.port(),
        known_hosts_path.clone(),
    );
    let backend = RusshSftpBackend;
    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");

    backend
        .transfer(
            endpoint,
            SftpManagedTransferRequest {
                host_id: "loopback".to_owned(),
                remote_path: "/release".to_owned(),
                local_path: upload_source.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Rename,
                view_scope: None,
            },
            TransferProgress::detached(),
            settings,
        )
        .await
        .expect("upload directory with renamed remote root");

    assert_eq!(
        fs::read_to_string(server_root.path().join("release/nested/existing.txt"))
            .await
            .expect("read existing remote file"),
        "existing remote"
    );
    assert_eq!(
        fs::read_to_string(server_root.path().join("release (1)/nested/new.txt"))
            .await
            .expect("read renamed remote upload"),
        "new upload"
    );
}

#[tokio::test]
async fn archive_download_file_request_zips_directory_after_fallback() {
    let server_root = tempdir().expect("server root");
    let client_root = tempdir().expect("client root");
    let temp_root = tempdir().expect("archive temp root");
    let target_root = tempdir().expect("archive target root");
    fs::create_dir_all(server_root.path().join("release/nested"))
        .await
        .expect("seed remote nested directory");
    fs::write(
        server_root.path().join("release/README.md"),
        b"release notes",
    )
    .await
    .expect("seed remote readme");
    fs::write(
        server_root.path().join("release/nested/app.log"),
        b"archive fallback nested file",
    )
    .await
    .expect("seed remote nested file");

    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let known_hosts_path = client_root.path().join("known_hosts");
    let settings = SftpRuntimeSettings {
        pipeline_depth: 4,
        packet_bytes: 32 * 1024,
        timeout_seconds: 10,
        ..SftpRuntimeSettings::default()
    };
    let endpoint = loopback_endpoint(
        "loopback",
        "loopback",
        server.addr.port(),
        known_hosts_path.clone(),
    );
    trust_native_host_key(&endpoint.host, &known_hosts_path, settings)
        .await
        .expect("trust loopback host key");

    let service = SftpService::with_backend(Arc::new(RusshSftpBackend));
    let target_zip = target_root.path().join("release.zip");
    let summary = service
        .enqueue_archive_download_resolved_for_test(
            endpoint,
            SftpArchiveDownloadRequest {
                host_id: "loopback".to_owned(),
                source_remote_path: "/release".to_owned(),
                target_local_path: target_zip.to_string_lossy().into_owned(),
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
            temp_root.path().to_path_buf(),
        )
        .expect("enqueue archive download");

    eventually(|| {
        service
            .list_transfers()
            .expect("list archive transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    let file = StdFile::open(&target_zip).expect("open archive zip");
    let mut archive = zip::ZipArchive::new(file).expect("read archive zip");
    let mut readme = String::new();
    archive
        .by_name("release/README.md")
        .expect("read archived readme")
        .read_to_string(&mut readme)
        .expect("read archived readme contents");
    assert_eq!(readme, "release notes");
    assert!(archive.by_name("release/nested/app.log").is_ok());
}

fn loopback_endpoint(id: &str, name: &str, port: u16, known_hosts_path: PathBuf) -> SftpEndpoint {
    SftpEndpoint {
        host: RemoteHost {
            id: id.to_owned(),
            group_id: None,
            name: name.to_owned(),
            host: "127.0.0.1".to_owned(),
            port,
            username: "deploy".to_owned(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("secret".to_owned()),
            tags: Vec::new(),
            production: false,
            ssh_options: Default::default(),
            sort_order: 0,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        },
        auth: SftpAuthMaterial::Password("secret".to_owned()),
        known_hosts_path,
    }
}
