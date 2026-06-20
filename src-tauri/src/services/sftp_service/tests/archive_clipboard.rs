use super::*;

#[tokio::test]
async fn archive_download_task_writes_zip_from_remote_directory() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 1,
        write_downloads: true,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend);
    let temp_root = tempdir().expect("archive temp root");
    let target_root = tempdir().expect("archive target root");
    let target_zip = target_root.path().join("var.zip");
    let summary = service
        .enqueue_archive_download_resolved_for_test(
            test_endpoint("source-host"),
            SftpArchiveDownloadRequest {
                host_id: "source-host".to_owned(),
                source_remote_path: "/var".to_owned(),
                target_local_path: target_zip.to_string_lossy().into_owned(),
                kind: SftpTransferKind::Directory,
            },
            temp_root.path().to_path_buf(),
        )
        .expect("enqueue archive download");

    assert_eq!(summary.host_id, "source-host");
    assert_eq!(summary.direction, SftpTransferDirection::Download);
    assert_eq!(summary.remote_path, "/var");
    assert_eq!(
        summary.local_path,
        target_zip.to_string_lossy().into_owned()
    );

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    let file = StdFile::open(&target_zip).expect("open archive zip");
    let mut archive = zip::ZipArchive::new(file).expect("read archive zip");
    let mut contents = String::new();
    archive
        .by_name("var/nested/app.log")
        .expect("archived fake file")
        .read_to_string(&mut contents)
        .expect("read archived fake file");
    assert_eq!(contents, "fake remote directory");
    assert!(
        !temp_root
            .path()
            .join("sftp-archive-download")
            .join(&summary.id)
            .exists(),
        "archive task should remove its staging directory"
    );
}

#[tokio::test]
async fn archive_upload_task_zips_local_directory_before_uploading() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 1,
        record_uploads: true,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend.clone());
    let source_root = tempdir().expect("archive upload source root");
    let temp_root = tempdir().expect("archive upload temp root");
    let source_dir = source_root.path().join("release");
    let nested_dir = source_dir.join("nested");
    std::fs::create_dir_all(&nested_dir).expect("create source nested dir");
    std::fs::write(source_dir.join("README.md"), b"hello upload archive")
        .expect("write source readme");
    std::fs::write(nested_dir.join("app.log"), b"nested upload log")
        .expect("write source nested file");

    let summary = service
        .enqueue_archive_upload_resolved_for_test(
            test_endpoint("target-host"),
            SftpArchiveUploadRequest {
                host_id: "target-host".to_owned(),
                source_local_path: source_dir.to_string_lossy().into_owned(),
                target_remote_path: "/uploads/release.zip".to_owned(),
                kind: SftpTransferKind::Directory,
            },
            temp_root.path().to_path_buf(),
        )
        .expect("enqueue archive upload");

    assert_eq!(summary.host_id, "target-host");
    assert_eq!(summary.direction, SftpTransferDirection::Upload);
    assert_eq!(summary.kind, SftpTransferKind::File);
    assert_eq!(summary.remote_path, "/uploads/release.zip");

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    let uploaded = backend
        .uploaded_file("/uploads/release.zip")
        .expect("uploaded archive bytes");
    let mut archive = zip::ZipArchive::new(Cursor::new(uploaded)).expect("read uploaded zip");
    let mut readme = String::new();
    archive
        .by_name("release/README.md")
        .expect("readme entry")
        .read_to_string(&mut readme)
        .expect("read uploaded readme");
    assert_eq!(readme, "hello upload archive");
    assert!(archive.by_name("release/nested/app.log").is_ok());
    assert!(
        !temp_root
            .path()
            .join("sftp-archive-upload")
            .join(&summary.id)
            .exists(),
        "archive upload task should remove its staging directory"
    );
}

#[test]
fn clipboard_download_target_uses_unique_download_name() {
    let target_root = tempdir().expect("clipboard download target root");
    std::fs::write(target_root.path().join("app.log"), b"existing").expect("write first collision");
    std::fs::write(target_root.path().join("app (2).log"), b"existing")
        .expect("write second collision");

    let target_path = clipboard_download_target_path_in(
        target_root.path(),
        &SftpClipboardDownloadRequest {
            host_id: "source-host".to_owned(),
            source_remote_path: "/var/log/app.log".to_owned(),
            kind: SftpTransferKind::File,
        },
    );

    assert_eq!(target_path, target_root.path().join("app (3).log"));
}

#[test]
fn clipboard_download_target_reservation_prevents_same_name_collision() {
    let target_root = tempdir().expect("clipboard download target root");
    let request = SftpClipboardDownloadRequest {
        host_id: "source-host".to_owned(),
        source_remote_path: "/var/log/app.log".to_owned(),
        kind: SftpTransferKind::File,
    };

    let first_target = reserve_clipboard_download_target_path_in(target_root.path(), &request)
        .expect("reserve first target");
    let second_target = reserve_clipboard_download_target_path_in(target_root.path(), &request)
        .expect("reserve second target");

    assert_eq!(first_target, target_root.path().join("app.log"));
    assert_eq!(second_target, target_root.path().join("app (2).log"));
}

#[test]
fn clipboard_download_target_sanitizes_remote_file_name() {
    let target_root = tempdir().expect("clipboard download target root");

    let target_path = clipboard_download_target_path_in(
        target_root.path(),
        &SftpClipboardDownloadRequest {
            host_id: "source-host".to_owned(),
            source_remote_path: "/tmp/..".to_owned(),
            kind: SftpTransferKind::Directory,
        },
    );

    assert_eq!(target_path, target_root.path().join("remote-directory"));
}

#[tokio::test]
async fn clipboard_download_task_downloads_remote_item_to_local_target() {
    let backend = Arc::new(FakeSftpBackend {
        delay_ms: 1,
        write_downloads: true,
        ..FakeSftpBackend::default()
    });
    let service = SftpService::with_backend(backend);
    let target_root = tempdir().expect("clipboard download target root");
    let target_path = target_root.path().join("app.log");
    let summary = service
        .enqueue_clipboard_download_resolved_for_test(
            test_endpoint("source-host"),
            SftpClipboardDownloadRequest {
                host_id: "source-host".to_owned(),
                source_remote_path: "/var/log/app.log".to_owned(),
                kind: SftpTransferKind::File,
            },
            target_path.clone(),
            false,
        )
        .expect("enqueue clipboard download");

    assert_eq!(summary.host_id, "source-host");
    assert_eq!(summary.direction, SftpTransferDirection::Download);
    assert_eq!(summary.remote_path, "/var/log/app.log");
    assert_eq!(
        summary.local_path,
        target_path.to_string_lossy().into_owned()
    );

    eventually(|| {
        service
            .list_transfers()
            .expect("list transfers")
            .iter()
            .any(|task| task.id == summary.id && task.status == SftpTransferStatus::Succeeded)
    })
    .await;

    assert_eq!(
        fs::read_to_string(target_path)
            .await
            .expect("read clipboard download target"),
        "fake remote file"
    );
}
