//! SFTP 文件工具服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::{
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroupCreateRequest},
        sftp::{
            SftpClassifyLocalPathsRequest, SftpListDirectoryRequest, SftpLocalPathKind,
            SftpPreviewRequest,
        },
    },
    paths::KerminalPaths,
    state::AppState,
};
use std::fs;
use tempfile::{tempdir, TempDir};

#[tokio::test]
async fn list_directory_rejects_unknown_remote_host_before_connecting_sftp() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .list_directory(
            state.storage(),
            state.paths(),
            SftpListDirectoryRequest {
                host_id: "missing-host".to_owned(),
                path: "/var/log".to_owned(),
            },
        )
        .await
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[tokio::test]
async fn preview_file_rejects_unknown_remote_host_before_connecting_sftp() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .preview_file(
            state.storage(),
            state.paths(),
            SftpPreviewRequest {
                host_id: "missing-host".to_owned(),
                max_bytes: Some(4096),
                path: "/var/log/app.log".to_owned(),
            },
        )
        .await
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
    assert!(!state.paths().temp.join("sftp-preview").exists());
}

#[tokio::test]
async fn preview_file_rejects_root_path_before_connecting_sftp() {
    let (_home, state) = test_state();
    let host_id = create_test_remote_host(&state);

    let error = state
        .sftp()
        .preview_file(
            state.storage(),
            state.paths(),
            SftpPreviewRequest {
                host_id,
                max_bytes: Some(4096),
                path: "/".to_owned(),
            },
        )
        .await
        .expect_err("reject root path");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("远程根目录")));
    assert!(!state.paths().temp.join("sftp-preview").exists());
}

#[test]
fn classify_local_paths_accepts_files_and_directories() {
    let (_home, state) = test_state();
    let local_root = tempdir().expect("create local root");
    let file_path = local_root.path().join("release.tgz");
    let directory_path = local_root.path().join("dist");
    fs::write(&file_path, b"artifact").expect("write file");
    fs::create_dir(&directory_path).expect("create directory");

    let paths = state
        .sftp()
        .classify_local_paths(SftpClassifyLocalPathsRequest {
            paths: vec![
                file_path.to_string_lossy().into_owned(),
                directory_path.to_string_lossy().into_owned(),
            ],
        })
        .expect("classify local paths");

    assert_eq!(paths.len(), 2);
    assert_eq!(paths[0].kind, SftpLocalPathKind::File);
    assert_eq!(paths[1].kind, SftpLocalPathKind::Directory);
}

#[test]
fn classify_local_paths_rejects_empty_requests() {
    let (_home, state) = test_state();

    let error = state
        .sftp()
        .classify_local_paths(SftpClassifyLocalPathsRequest { paths: vec![] })
        .expect_err("reject empty request");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("至少提供")));
}

#[test]
fn classify_local_paths_rejects_missing_paths() {
    let (_home, state) = test_state();
    let local_root = tempdir().expect("create local root");
    let missing_path = local_root.path().join("missing.log");

    let error = state
        .sftp()
        .classify_local_paths(SftpClassifyLocalPathsRequest {
            paths: vec![missing_path.to_string_lossy().into_owned()],
        })
        .expect_err("reject missing path");

    assert!(
        matches!(error, AppError::InvalidInput(message) if message.contains("无法读取本地路径"))
    );
}

fn create_test_remote_host(state: &AppState) -> String {
    let group = state
        .remote_hosts()
        .create_group(
            state.storage(),
            RemoteHostGroupCreateRequest {
                name: "虚拟机".to_owned(),
            },
        )
        .expect("create test group");

    state
        .remote_hosts()
        .create_host(
            state.storage(),
            RemoteHostCreateRequest {
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                credential_secret: None,
                group_id: Some(group.id),
                host: "dev.internal".to_owned(),
                name: "dev ssh".to_owned(),
                port: 22,
                production: false,
                ssh_options: Default::default(),
                tags: vec!["dev".to_owned()],
                username: "deploy".to_owned(),
            },
        )
        .expect("create test host")
        .id
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
