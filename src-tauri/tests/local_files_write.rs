//! Local file write command integration tests.
//!
//! @author kongweiguang

use std::{fs, path::Path};

use kerminal_lib::{
    commands::local_files::{
        local_files_copy_path, local_files_create_directory, local_files_delete_path,
        local_files_read_text_file, local_files_rename_path, local_files_write_text_file,
        LocalCopyPathRequest, LocalCreateDirectoryRequest, LocalDeletePathRequest,
        LocalReadTextFileRequest, LocalRenamePathRequest, LocalWriteTextFileRequest,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tauri::Manager;
use tempfile::{tempdir, TempDir};

#[tokio::test]
async fn local_files_create_directory_returns_refreshed_parent_listing() {
    let temp = tempdir().expect("temp dir");

    let listing = local_files_create_directory(LocalCreateDirectoryRequest {
        parent_path: path_string(temp.path()),
        name: "created".to_owned(),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect("create directory");

    assert!(temp.path().join("created").is_dir());
    assert!(listing.entries.iter().any(|entry| entry.name == "created"));
}

#[tokio::test]
async fn local_files_create_directory_rejects_nested_name() {
    let temp = tempdir().expect("temp dir");

    let error = local_files_create_directory(LocalCreateDirectoryRequest {
        parent_path: path_string(temp.path()),
        name: "nested/path".to_owned(),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject nested name");

    assert!(error.contains("文件名不能包含路径分隔符"));
}

#[tokio::test]
async fn local_files_read_text_file_returns_content_and_revision() {
    let temp = tempdir().expect("temp dir");
    let file = temp.path().join("notes.txt");
    fs::write(&file, "hello\r\nworld\r\n").expect("write source");

    let response = local_files_read_text_file(LocalReadTextFileRequest {
        max_bytes: Some(1024),
        path: path_string(&file),
    })
    .await
    .expect("read text file");

    assert_eq!(response.content, "hello\r\nworld\r\n");
    assert_eq!(response.bytes_read, "hello\r\nworld\r\n".len());
    assert_eq!(response.line_ending, "crlf");
    assert_eq!(response.revision.size, "hello\r\nworld\r\n".len() as u64);
    assert!(response.revision.content_sha256.is_some());
    assert!(!response.binary);
}

#[tokio::test]
async fn local_files_write_text_file_updates_existing_file_with_expected_revision() {
    let temp = tempdir().expect("temp dir");
    let file = temp.path().join("notes.txt");
    fs::write(&file, "before\n").expect("write source");
    let read_response = local_files_read_text_file(LocalReadTextFileRequest {
        max_bytes: None,
        path: path_string(&file),
    })
    .await
    .expect("read text file");

    let write_response = local_files_write_text_file(LocalWriteTextFileRequest {
        content: "after\n".to_owned(),
        create: false,
        encoding: "utf-8".to_owned(),
        expected_revision: Some(read_response.revision),
        overwrite_on_conflict: false,
        path: path_string(&file),
    })
    .await
    .expect("write text file");

    assert_eq!(
        fs::read_to_string(&file).expect("read updated file"),
        "after\n"
    );
    assert_eq!(write_response.bytes_written, "after\n".len());
    assert_eq!(write_response.line_ending, "lf");
    assert!(write_response.revision.content_sha256.is_some());
}

#[tokio::test]
async fn local_files_write_text_file_rejects_revision_conflict() {
    let temp = tempdir().expect("temp dir");
    let file = temp.path().join("notes.txt");
    fs::write(&file, "before\n").expect("write source");
    let read_response = local_files_read_text_file(LocalReadTextFileRequest {
        max_bytes: None,
        path: path_string(&file),
    })
    .await
    .expect("read text file");
    fs::write(&file, "changed elsewhere\n").expect("modify source");

    let error = local_files_write_text_file(LocalWriteTextFileRequest {
        content: "after\n".to_owned(),
        create: false,
        encoding: "utf-8".to_owned(),
        expected_revision: Some(read_response.revision),
        overwrite_on_conflict: false,
        path: path_string(&file),
    })
    .await
    .expect_err("reject conflict");

    assert!(error.contains("本机文件已变更"));
    assert_eq!(
        fs::read_to_string(&file).expect("read unchanged file"),
        "changed elsewhere\n"
    );
}

#[tokio::test]
async fn local_files_read_text_file_returns_binary_safety_response() {
    let temp = tempdir().expect("temp dir");
    let file = temp.path().join("document.pdf");
    let binary_content = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n";
    fs::write(&file, binary_content).expect("write source");

    let response = local_files_read_text_file(LocalReadTextFileRequest {
        max_bytes: Some(1024),
        path: path_string(&file),
    })
    .await
    .expect("return binary safety response");

    assert!(response.binary);
    assert!(response.readonly);
    assert!(response.content.is_empty());
    assert_eq!(response.bytes_read, 0);
    assert_eq!(response.encoding, "binary");
    assert_eq!(response.line_ending, "lf");
    assert_eq!(response.revision.size, binary_content.len() as u64);
    assert!(response.revision.content_sha256.is_some());
    assert!(!response.truncated);
}

#[tokio::test]
async fn local_files_copy_file_returns_target_directory_listing() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    let target_dir = temp.path().join("target");
    fs::write(&source, "hello").expect("write source");
    fs::create_dir(&target_dir).expect("create target dir");

    let listing = local_files_copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(path_string(&target_dir)),
        source_path: path_string(&source),
        target_directory_path: path_string(&target_dir),
    })
    .await
    .expect("copy file");

    assert_eq!(
        fs::read_to_string(target_dir.join("source.txt")).expect("read copied file"),
        "hello"
    );
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "source.txt"));
}

#[tokio::test]
async fn local_files_copy_directory_rejects_self_child_target() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source");
    let target_dir = source.join("child");
    fs::create_dir_all(&target_dir).expect("create nested target");

    let error = local_files_copy_path(LocalCopyPathRequest {
        kind: "directory".to_owned(),
        root_path: Some(path_string(&source)),
        source_path: path_string(&source),
        target_directory_path: path_string(&target_dir),
    })
    .await
    .expect_err("reject copy into self");

    assert!(error.contains("不能把目录复制到自身或子目录"));
}

#[tokio::test]
async fn local_files_copy_path_rejects_existing_target() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    let target_dir = temp.path().join("target");
    fs::write(&source, "hello").expect("write source");
    fs::create_dir(&target_dir).expect("create target dir");
    fs::write(target_dir.join("source.txt"), "existing").expect("write existing target");

    let error = local_files_copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(path_string(&target_dir)),
        source_path: path_string(&source),
        target_directory_path: path_string(&target_dir),
    })
    .await
    .expect_err("reject existing target");

    assert!(error.contains("目标已存在"));
}

#[tokio::test]
async fn local_files_create_directory_rejects_parent_outside_root_path() {
    let root = tempdir().expect("root dir");
    let outside = tempdir().expect("outside dir");

    let error = local_files_create_directory(LocalCreateDirectoryRequest {
        parent_path: path_string(outside.path()),
        name: "created".to_owned(),
        root_path: Some(path_string(root.path())),
    })
    .await
    .expect_err("reject parent outside root");

    assert!(error.contains("创建目标超出允许根目录"));
    assert!(!outside.path().join("created").exists());
}

#[tokio::test]
async fn local_files_copy_path_allows_source_outside_root_when_target_is_inside_root() {
    let root = tempdir().expect("root dir");
    let outside = tempdir().expect("outside dir");
    let source = outside.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let listing = local_files_copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(path_string(root.path())),
        source_path: path_string(&source),
        target_directory_path: path_string(root.path()),
    })
    .await
    .expect("copy from outside root");

    assert_eq!(
        fs::read_to_string(root.path().join("source.txt")).expect("read copied file"),
        "hello"
    );
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "source.txt"));
}

#[tokio::test]
async fn local_files_copy_path_rejects_target_outside_root_path() {
    let root = tempdir().expect("root dir");
    let outside = tempdir().expect("outside dir");
    let source = root.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let error = local_files_copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(path_string(root.path())),
        source_path: path_string(&source),
        target_directory_path: path_string(outside.path()),
    })
    .await
    .expect_err("reject target outside root");

    assert!(error.contains("复制目标超出允许根目录"));
    assert!(!outside.path().join("source.txt").exists());
}

#[tokio::test]
async fn local_files_rename_file_returns_parent_listing() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let listing = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.txt".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect("rename file");

    assert!(!source.exists());
    assert_eq!(
        fs::read_to_string(temp.path().join("renamed.txt")).expect("read renamed file"),
        "hello"
    );
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "renamed.txt"));
}

#[tokio::test]
async fn local_files_rename_directory_returns_parent_listing() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source-dir");
    fs::create_dir(&source).expect("create source dir");

    let listing = local_files_rename_path(LocalRenamePathRequest {
        kind: "directory".to_owned(),
        name: "renamed-dir".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect("rename directory");

    assert!(!source.exists());
    assert!(temp.path().join("renamed-dir").is_dir());
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "renamed-dir"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_nested_name() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "nested/path.txt".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject nested name");

    assert!(error.contains("文件名不能包含路径分隔符"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_kind_mismatch() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "directory".to_owned(),
        name: "renamed.txt".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject kind mismatch");

    assert!(error.contains("源路径类型不匹配"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_existing_target() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");
    fs::write(temp.path().join("target.txt"), "existing").expect("write target");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "target.txt".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject existing target");

    assert!(error.contains("目标已存在"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_source_outside_root_path() {
    let root = tempdir().expect("root dir");
    let outside = tempdir().expect("outside dir");
    let source = outside.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.txt".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(root.path())),
    })
    .await
    .expect_err("reject source outside root");

    assert!(error.contains("重命名目标超出允许根目录"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_root_path_itself() {
    let temp = tempdir().expect("temp dir");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "directory".to_owned(),
        name: "renamed-root".to_owned(),
        path: path_string(temp.path()),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject root rename");

    assert!(error.contains("不能重命名根目录本身"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_windows_reserved_name() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "CON.txt".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject reserved name");

    assert!(error.contains("Windows 保留名称"));
}

#[tokio::test]
async fn local_files_rename_path_rejects_trailing_dot_name() {
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").expect("write source");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.".to_owned(),
        path: path_string(&source),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject trailing dot");

    assert!(error.contains("文件名不能以空格或点结尾"));
}

#[cfg(unix)]
#[tokio::test]
async fn local_files_rename_path_rejects_source_symlink_before_canonicalize() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().expect("temp dir");
    let real = temp.path().join("real.txt");
    let link = temp.path().join("link.txt");
    fs::write(&real, "hello").expect("write real file");
    symlink(&real, &link).expect("create symlink");

    let error = local_files_rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.txt".to_owned(),
        path: path_string(&link),
        root_path: Some(path_string(temp.path())),
    })
    .await
    .expect_err("reject symlink");

    assert!(error.contains("符号链接"));
}

#[tokio::test]
async fn local_files_delete_file_returns_parent_listing() {
    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("remove.txt");
    fs::write(&source, "delete me").expect("write source");

    let listing = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "remove.txt".to_owned(),
            kind: "file".to_owned(),
            path: path_string(&source),
            recursive: false,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect("delete file");

    assert!(!source.exists());
    assert!(!listing
        .entries
        .iter()
        .any(|entry| entry.name == "remove.txt"));
}

#[tokio::test]
async fn local_files_delete_directory_removes_tree_when_recursive_confirmed() {
    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("remove-dir");
    fs::create_dir_all(source.join("child")).expect("create child dir");
    fs::write(source.join("child").join("notes.txt"), "delete me").expect("write child file");

    let listing = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "remove-dir".to_owned(),
            kind: "directory".to_owned(),
            path: path_string(&source),
            recursive: true,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect("delete directory");

    assert!(!source.exists());
    assert!(!listing
        .entries
        .iter()
        .any(|entry| entry.name == "remove-dir"));
}

#[tokio::test]
async fn local_files_delete_directory_requires_recursive_confirmation() {
    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("remove-dir");
    fs::create_dir(&source).expect("create source dir");

    let error = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "remove-dir".to_owned(),
            kind: "directory".to_owned(),
            path: path_string(&source),
            recursive: false,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect_err("reject missing recursive confirmation");

    assert!(error.contains("删除目录必须启用递归确认"));
    assert!(source.exists());
}

#[tokio::test]
async fn local_files_delete_path_rejects_confirm_name_mismatch_and_writes_audit() {
    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("remove.txt");
    fs::write(&source, "delete me").expect("write source");

    let error = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "other.txt".to_owned(),
            kind: "file".to_owned(),
            path: path_string(&source),
            recursive: false,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect_err("reject confirm name mismatch");

    assert!(error.contains("删除确认名称不匹配"));
    assert!(source.exists());

    let audits = app
        .state::<AppState>()
        .storage()
        .list_local_file_operation_audits(10)
        .expect("list local file audits");
    assert_eq!(audits.len(), 1);
    assert_eq!(audits[0].operation, "delete");
    assert_eq!(audits[0].status, "failed");
    assert!(!audits[0].confirmation_matched);
    assert_eq!(audits[0].error.as_deref(), Some("删除确认名称不匹配"));
}

#[tokio::test]
async fn local_files_delete_path_rejects_kind_mismatch() {
    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");
    let source = temp.path().join("remove.txt");
    fs::write(&source, "delete me").expect("write source");

    let error = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "remove.txt".to_owned(),
            kind: "directory".to_owned(),
            path: path_string(&source),
            recursive: true,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect_err("reject kind mismatch");

    assert!(error.contains("源路径类型不匹配"));
    assert!(source.exists());
}

#[tokio::test]
async fn local_files_delete_path_rejects_root_path_itself() {
    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");

    let error = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: temp
                .path()
                .file_name()
                .expect("temp dir name")
                .to_string_lossy()
                .into_owned(),
            kind: "directory".to_owned(),
            path: path_string(temp.path()),
            recursive: true,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect_err("reject deleting root");

    assert!(error.contains("不能删除根目录本身"));
}

#[tokio::test]
async fn local_files_delete_path_rejects_source_outside_root_path() {
    let (_home, app) = test_app();
    let root = tempdir().expect("root dir");
    let outside = tempdir().expect("outside dir");
    let source = outside.path().join("remove.txt");
    fs::write(&source, "delete me").expect("write source");

    let error = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "remove.txt".to_owned(),
            kind: "file".to_owned(),
            path: path_string(&source),
            recursive: false,
            root_path: Some(path_string(root.path())),
        },
    )
    .await
    .expect_err("reject source outside root");

    assert!(error.contains("删除目标超出允许根目录"));
    assert!(source.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn local_files_delete_path_rejects_source_symlink_before_canonicalize() {
    use std::os::unix::fs::symlink;

    let (_home, app) = test_app();
    let temp = tempdir().expect("temp dir");
    let real = temp.path().join("real.txt");
    let link = temp.path().join("link.txt");
    fs::write(&real, "hello").expect("write real file");
    symlink(&real, &link).expect("create symlink");

    let error = local_files_delete_path(
        app.state::<AppState>(),
        LocalDeletePathRequest {
            confirm_name: "link.txt".to_owned(),
            kind: "file".to_owned(),
            path: path_string(&link),
            recursive: false,
            root_path: Some(path_string(temp.path())),
        },
    )
    .await
    .expect_err("reject symlink");

    assert!(error.contains("符号链接"));
    assert!(real.exists());
    assert!(link.exists());
}

fn test_app() -> (TempDir, tauri::App<tauri::test::MockRuntime>) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    (home, app)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
