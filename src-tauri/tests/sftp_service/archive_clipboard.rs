use super::support::{
    create_password_remote_host, loopback::start_loopback_sftp_server, test_state,
};
use kerminal_lib::{
    models::sftp::{
        SftpArchiveDownloadRequest, SftpArchiveUploadRequest, SftpTransferConflictPolicy,
        SftpTransferDirection, SftpTransferKind, SftpTransferStatus, SftpTrustHostKeyRequest,
    },
    state::AppState,
};
use std::{fs::File as StdFile, io::Read};
use tempfile::tempdir;
use tokio::{
    fs,
    time::{sleep, Duration},
};

#[tokio::test]
async fn archive_download_task_writes_zip_from_remote_directory() {
    let server_root = tempdir().expect("server root");
    let target_root = tempdir().expect("archive target root");
    fs::create_dir_all(server_root.path().join("var/nested"))
        .await
        .expect("seed remote nested directory");
    fs::write(server_root.path().join("var/nested/app.log"), b"remote log")
        .await
        .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "source host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;

    let target_zip = target_root.path().join("var.zip");
    let summary = state
        .sftp()
        .enqueue_archive_download(
            state.paths(),
            SftpArchiveDownloadRequest {
                host_id: host_id.clone(),
                source_remote_path: "/var".to_owned(),
                target_local_path: target_zip.to_string_lossy().into_owned(),
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
        )
        .expect("enqueue archive download");

    assert_eq!(summary.host_id, host_id);
    assert_eq!(summary.direction, SftpTransferDirection::Download);
    assert_eq!(summary.remote_path, "/var");
    assert_eq!(
        summary.local_path,
        target_zip.to_string_lossy().into_owned()
    );

    let completed = wait_for_transfer_success(&state, &summary.id).await;
    assert_eq!(completed.phase.as_deref(), Some("done"));
    assert_eq!(completed.current_item, None);

    let file = StdFile::open(&target_zip).expect("open archive zip");
    let mut archive = zip::ZipArchive::new(file).expect("read archive zip");
    let mut contents = String::new();
    archive
        .by_name("var/nested/app.log")
        .expect("archived file")
        .read_to_string(&mut contents)
        .expect("read archived file");
    assert_eq!(contents, "remote log");
}

#[tokio::test]
async fn archive_download_task_skip_keeps_existing_zip_target() {
    let server_root = tempdir().expect("server root");
    let target_root = tempdir().expect("archive target root");
    fs::create_dir_all(server_root.path().join("var/nested"))
        .await
        .expect("seed remote nested directory");
    fs::write(server_root.path().join("var/nested/app.log"), b"remote log")
        .await
        .expect("seed remote file");
    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "source host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;

    let target_zip = target_root.path().join("var.zip");
    std::fs::write(&target_zip, b"existing zip bytes").expect("seed existing archive target");
    let summary = state
        .sftp()
        .enqueue_archive_download(
            state.paths(),
            SftpArchiveDownloadRequest {
                host_id,
                source_remote_path: "/var".to_owned(),
                target_local_path: target_zip.to_string_lossy().into_owned(),
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Skip,
                view_scope: None,
            },
        )
        .expect("enqueue archive download");

    wait_for_transfer_success(&state, &summary.id).await;

    assert_eq!(
        fs::read(&target_zip)
            .await
            .expect("read skipped archive target"),
        b"existing zip bytes"
    );
}

#[tokio::test]
async fn archive_upload_task_zips_local_directory_before_uploading() {
    let server_root = tempdir().expect("server root");
    let source_root = tempdir().expect("archive upload source root");
    fs::create_dir_all(server_root.path().join("uploads"))
        .await
        .expect("seed upload target directory");
    let source_dir = source_root.path().join("release");
    let nested_dir = source_dir.join("nested");
    fs::create_dir_all(&nested_dir)
        .await
        .expect("create source nested dir");
    fs::write(source_dir.join("README.md"), b"hello upload archive")
        .await
        .expect("write source readme");
    fs::write(nested_dir.join("app.log"), b"nested upload log")
        .await
        .expect("write source nested file");

    let server = start_loopback_sftp_server(server_root.path().to_path_buf()).await;
    let (_home, state) = test_state();
    let host_id = create_password_remote_host(&state, "target host", server.addr.port());
    trust_loopback_host(&state, &host_id).await;

    let summary = state
        .sftp()
        .enqueue_archive_upload(
            state.paths(),
            SftpArchiveUploadRequest {
                host_id: host_id.clone(),
                source_local_path: source_dir.to_string_lossy().into_owned(),
                target_remote_path: "/uploads/release.zip".to_owned(),
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
            },
        )
        .expect("enqueue archive upload");

    assert_eq!(summary.host_id, host_id);
    assert_eq!(summary.direction, SftpTransferDirection::Upload);
    assert_eq!(summary.kind, SftpTransferKind::File);
    assert_eq!(summary.remote_path, "/uploads/release.zip");

    wait_for_transfer_success(&state, &summary.id).await;

    let uploaded = StdFile::open(server_root.path().join("uploads/release.zip"))
        .expect("open uploaded archive");
    let mut archive = zip::ZipArchive::new(uploaded).expect("read uploaded zip");
    let mut readme = String::new();
    archive
        .by_name("release/README.md")
        .expect("readme entry")
        .read_to_string(&mut readme)
        .expect("read uploaded readme");
    assert_eq!(readme, "hello upload archive");
    assert!(archive.by_name("release/nested/app.log").is_ok());
}

async fn trust_loopback_host(state: &AppState, host_id: &str) {
    state
        .sftp()
        .trust_host_key(
            state.paths(),
            SftpTrustHostKeyRequest {
                host_id: host_id.to_owned(),
            },
        )
        .await
        .expect("trust loopback host key");
}

async fn wait_for_transfer_success(
    state: &AppState,
    transfer_id: &str,
) -> kerminal_lib::models::sftp::SftpTransferSummary {
    for _ in 0..100 {
        let tasks = state.sftp().list_transfers().expect("list transfers");
        if let Some(task) = tasks.iter().find(|task| task.id == transfer_id) {
            match task.status {
                SftpTransferStatus::Succeeded => return task.clone(),
                SftpTransferStatus::Failed | SftpTransferStatus::Canceled => {
                    panic!(
                        "transfer {transfer_id} finished as {:?}: {:?}",
                        task.status, task.error
                    );
                }
                SftpTransferStatus::Queued | SftpTransferStatus::Running => {}
            }
        }
        sleep(Duration::from_millis(20)).await;
    }
    panic!("transfer {transfer_id} did not finish");
}
