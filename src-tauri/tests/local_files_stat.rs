//! Local file stat command integration tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::commands::local_files::{local_files_stat_path, LocalStatPathRequest};
use tempfile::tempdir;

#[tokio::test]
async fn local_files_stat_reports_missing_target_inside_root() {
    let root = tempdir().expect("temp dir");
    let target = root.path().join("missing.txt");

    let stat = local_files_stat_path(LocalStatPathRequest {
        path: target.to_string_lossy().into_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
    })
    .await
    .expect("stat missing path");

    assert!(!stat.exists);
    assert_eq!(stat.kind, None);
    assert_eq!(stat.size, None);
}

#[tokio::test]
async fn local_files_stat_reports_existing_file_metadata() {
    let root = tempdir().expect("temp dir");
    let target = root.path().join("notes.txt");
    fs::write(&target, b"hello").expect("write file");

    let stat = local_files_stat_path(LocalStatPathRequest {
        path: target.to_string_lossy().into_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
    })
    .await
    .expect("stat file");

    assert!(stat.exists);
    assert_eq!(stat.kind.as_deref(), Some("file"));
    assert_eq!(stat.size, Some(5));
    assert!(stat.modified.is_some());
}

#[tokio::test]
async fn local_files_stat_rejects_target_outside_root() {
    let root = tempdir().expect("temp dir");
    let outside = tempdir().expect("outside dir");
    let target = outside.path().join("notes.txt");

    let error = local_files_stat_path(LocalStatPathRequest {
        path: target.to_string_lossy().into_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
    })
    .await
    .expect_err("outside root should fail");

    assert!(error.contains("路径超出允许根目录"));
}
