//! 本机文件写操作测试。
//!
//! @author kongweiguang

use std::fs;

use tempfile::tempdir;

use super::{
    copy_path, create_directory, delete_path, rename_path, LocalCopyPathRequest,
    LocalCreateDirectoryRequest, LocalDeletePathRequest, LocalRenamePathRequest,
};

#[test]
fn create_directory_returns_refreshed_parent_listing() {
    let temp = tempdir().unwrap();

    let listing = create_directory(LocalCreateDirectoryRequest {
        parent_path: temp.path().to_string_lossy().into_owned(),
        name: "created".to_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap();

    assert!(temp.path().join("created").is_dir());
    assert!(listing.entries.iter().any(|entry| entry.name == "created"));
}

#[test]
fn create_directory_rejects_nested_name() {
    let temp = tempdir().unwrap();

    let error = create_directory(LocalCreateDirectoryRequest {
        parent_path: temp.path().to_string_lossy().into_owned(),
        name: "nested/path".to_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("文件名不能包含路径分隔符"));
}

#[test]
fn copy_file_returns_target_directory_listing() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    let target_dir = temp.path().join("target");
    fs::write(&source, "hello").unwrap();
    fs::create_dir(&target_dir).unwrap();

    let listing = copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(target_dir.to_string_lossy().into_owned()),
        source_path: source.to_string_lossy().into_owned(),
        target_directory_path: target_dir.to_string_lossy().into_owned(),
    })
    .unwrap();

    assert_eq!(
        fs::read_to_string(target_dir.join("source.txt")).unwrap(),
        "hello"
    );
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "source.txt"));
}

#[test]
fn copy_directory_rejects_self_child_target() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source");
    let target_dir = source.join("child");
    fs::create_dir_all(&target_dir).unwrap();

    let error = copy_path(LocalCopyPathRequest {
        kind: "directory".to_owned(),
        root_path: Some(source.to_string_lossy().into_owned()),
        source_path: source.to_string_lossy().into_owned(),
        target_directory_path: target_dir.to_string_lossy().into_owned(),
    })
    .unwrap_err();

    assert!(error.contains("不能把目录复制到自身或子目录"));
}

#[test]
fn copy_path_rejects_existing_target() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    let target_dir = temp.path().join("target");
    fs::write(&source, "hello").unwrap();
    fs::create_dir(&target_dir).unwrap();
    fs::write(target_dir.join("source.txt"), "existing").unwrap();

    let error = copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(target_dir.to_string_lossy().into_owned()),
        source_path: source.to_string_lossy().into_owned(),
        target_directory_path: target_dir.to_string_lossy().into_owned(),
    })
    .unwrap_err();

    assert!(error.contains("目标已存在"));
}

#[test]
fn create_directory_rejects_parent_outside_root_path() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();

    let error = create_directory(LocalCreateDirectoryRequest {
        parent_path: outside.path().to_string_lossy().into_owned(),
        name: "created".to_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("创建目标超出允许根目录"));
    assert!(!outside.path().join("created").exists());
}

#[test]
fn copy_path_allows_source_outside_root_when_target_is_inside_root() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let source = outside.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let listing = copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
        source_path: source.to_string_lossy().into_owned(),
        target_directory_path: root.path().to_string_lossy().into_owned(),
    })
    .unwrap();

    assert_eq!(
        fs::read_to_string(root.path().join("source.txt")).unwrap(),
        "hello"
    );
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "source.txt"));
}

#[test]
fn copy_path_rejects_target_outside_root_path() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let source = root.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let error = copy_path(LocalCopyPathRequest {
        kind: "file".to_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
        source_path: source.to_string_lossy().into_owned(),
        target_directory_path: outside.path().to_string_lossy().into_owned(),
    })
    .unwrap_err();

    assert!(error.contains("复制目标超出允许根目录"));
    assert!(!outside.path().join("source.txt").exists());
}

#[test]
fn rename_file_returns_parent_listing() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let listing = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.txt".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap();

    assert!(!source.exists());
    assert_eq!(
        fs::read_to_string(temp.path().join("renamed.txt")).unwrap(),
        "hello"
    );
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "renamed.txt"));
}

#[test]
fn rename_directory_returns_parent_listing() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source-dir");
    fs::create_dir(&source).unwrap();

    let listing = rename_path(LocalRenamePathRequest {
        kind: "directory".to_owned(),
        name: "renamed-dir".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap();

    assert!(!source.exists());
    assert!(temp.path().join("renamed-dir").is_dir());
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "renamed-dir"));
}

#[test]
fn rename_path_rejects_nested_name() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "nested/path.txt".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("文件名不能包含路径分隔符"));
}

#[test]
fn rename_path_rejects_kind_mismatch() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "directory".to_owned(),
        name: "renamed.txt".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("源路径类型不匹配"));
}

#[test]
fn rename_path_rejects_existing_target() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").unwrap();
    fs::write(temp.path().join("target.txt"), "existing").unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "target.txt".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("目标已存在"));
}

#[test]
fn rename_path_rejects_source_outside_root_path() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let source = outside.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.txt".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(root.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("重命名目标超出允许根目录"));
}

#[test]
fn rename_path_rejects_root_path_itself() {
    let temp = tempdir().unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "directory".to_owned(),
        name: "renamed-root".to_owned(),
        path: temp.path().to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("不能重命名根目录本身"));
}

#[test]
fn rename_path_rejects_windows_reserved_name() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "CON.txt".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("Windows 保留名称"));
}

#[test]
fn rename_path_rejects_trailing_dot_name() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("source.txt");
    fs::write(&source, "hello").unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.".to_owned(),
        path: source.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("文件名不能以空格或点结尾"));
}

#[cfg(unix)]
#[test]
fn rename_path_rejects_source_symlink_before_canonicalize() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let real = temp.path().join("real.txt");
    let link = temp.path().join("link.txt");
    fs::write(&real, "hello").unwrap();
    symlink(&real, &link).unwrap();

    let error = rename_path(LocalRenamePathRequest {
        kind: "file".to_owned(),
        name: "renamed.txt".to_owned(),
        path: link.to_string_lossy().into_owned(),
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("符号链接"));
}

#[test]
fn delete_file_returns_parent_listing() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("remove.txt");
    fs::write(&source, "delete me").unwrap();

    let listing = delete_path(LocalDeletePathRequest {
        confirm_name: "remove.txt".to_owned(),
        kind: "file".to_owned(),
        path: source.to_string_lossy().into_owned(),
        recursive: false,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap();

    assert!(!source.exists());
    assert!(!listing
        .entries
        .iter()
        .any(|entry| entry.name == "remove.txt"));
}

#[test]
fn delete_directory_removes_tree_when_recursive_confirmed() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("remove-dir");
    fs::create_dir_all(source.join("child")).unwrap();
    fs::write(source.join("child").join("notes.txt"), "delete me").unwrap();

    let listing = delete_path(LocalDeletePathRequest {
        confirm_name: "remove-dir".to_owned(),
        kind: "directory".to_owned(),
        path: source.to_string_lossy().into_owned(),
        recursive: true,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap();

    assert!(!source.exists());
    assert!(!listing
        .entries
        .iter()
        .any(|entry| entry.name == "remove-dir"));
}

#[test]
fn delete_directory_requires_recursive_confirmation() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("remove-dir");
    fs::create_dir(&source).unwrap();

    let error = delete_path(LocalDeletePathRequest {
        confirm_name: "remove-dir".to_owned(),
        kind: "directory".to_owned(),
        path: source.to_string_lossy().into_owned(),
        recursive: false,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("删除目录必须启用递归确认"));
    assert!(source.exists());
}

#[test]
fn delete_path_rejects_confirm_name_mismatch() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("remove.txt");
    fs::write(&source, "delete me").unwrap();

    let error = delete_path(LocalDeletePathRequest {
        confirm_name: "other.txt".to_owned(),
        kind: "file".to_owned(),
        path: source.to_string_lossy().into_owned(),
        recursive: false,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("删除确认名称不匹配"));
    assert!(source.exists());
}

#[test]
fn delete_path_rejects_kind_mismatch() {
    let temp = tempdir().unwrap();
    let source = temp.path().join("remove.txt");
    fs::write(&source, "delete me").unwrap();

    let error = delete_path(LocalDeletePathRequest {
        confirm_name: "remove.txt".to_owned(),
        kind: "directory".to_owned(),
        path: source.to_string_lossy().into_owned(),
        recursive: true,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("源路径类型不匹配"));
    assert!(source.exists());
}

#[test]
fn delete_path_rejects_root_path_itself() {
    let temp = tempdir().unwrap();

    let error = delete_path(LocalDeletePathRequest {
        confirm_name: temp
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        kind: "directory".to_owned(),
        path: temp.path().to_string_lossy().into_owned(),
        recursive: true,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("不能删除根目录本身"));
}

#[test]
fn delete_path_rejects_source_outside_root_path() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let source = outside.path().join("remove.txt");
    fs::write(&source, "delete me").unwrap();

    let error = delete_path(LocalDeletePathRequest {
        confirm_name: "remove.txt".to_owned(),
        kind: "file".to_owned(),
        path: source.to_string_lossy().into_owned(),
        recursive: false,
        root_path: Some(root.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("删除目标超出允许根目录"));
    assert!(source.exists());
}

#[cfg(unix)]
#[test]
fn delete_path_rejects_source_symlink_before_canonicalize() {
    use std::os::unix::fs::symlink;

    let temp = tempdir().unwrap();
    let real = temp.path().join("real.txt");
    let link = temp.path().join("link.txt");
    fs::write(&real, "hello").unwrap();
    symlink(&real, &link).unwrap();

    let error = delete_path(LocalDeletePathRequest {
        confirm_name: "link.txt".to_owned(),
        kind: "file".to_owned(),
        path: link.to_string_lossy().into_owned(),
        recursive: false,
        root_path: Some(temp.path().to_string_lossy().into_owned()),
    })
    .unwrap_err();

    assert!(error.contains("符号链接"));
    assert!(real.exists());
    assert!(link.exists());
}
