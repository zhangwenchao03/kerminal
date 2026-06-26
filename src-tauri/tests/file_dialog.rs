//! 本地文件对话框命令集成测试。
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::commands::file_dialog::{
    file_dialog_list_local_directory,
    path_model::{default_save_path_parts, normalize_local_path_string},
};
use tempfile::tempdir;

#[tokio::test]
async fn local_directory_listing_orders_directories_files_and_hidden_entries() {
    let root = tempdir().expect("temp dir");
    fs::create_dir_all(root.path().join("z-dir")).expect("create z dir");
    fs::create_dir_all(root.path().join("a-dir")).expect("create a dir");
    fs::write(root.path().join(".hidden-file"), "hidden").expect("write hidden file");
    fs::write(root.path().join("b-file.txt"), "file").expect("write file");

    let listing =
        file_dialog_list_local_directory(Some(root.path().to_string_lossy().into_owned()))
            .await
            .expect("list local directory");
    let names: Vec<_> = listing
        .entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect();

    assert_eq!(
        listing.path,
        normalize_windows_verbatim_path(&root.path().canonicalize().expect("canonical root"))
    );
    assert_eq!(names, vec!["a-dir", "z-dir", ".hidden-file", "b-file.txt"]);
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == ".hidden-file" && entry.hidden));
}

#[cfg(unix)]
#[tokio::test]
async fn local_directory_listing_reports_symlink_entries() {
    use std::os::unix::fs::symlink;

    let root = tempdir().expect("temp dir");
    fs::write(root.path().join("target.txt"), "file").expect("write target");
    symlink(
        root.path().join("target.txt"),
        root.path().join("target-link"),
    )
    .expect("create symlink");

    let listing =
        file_dialog_list_local_directory(Some(root.path().to_string_lossy().into_owned()))
            .await
            .expect("list local directory");
    let link = listing
        .entries
        .iter()
        .find(|entry| entry.name == "target-link")
        .expect("symlink entry");

    assert_eq!(link.kind, "symlink");
}

fn normalize_windows_verbatim_path(path: &std::path::Path) -> String {
    let path = path.to_string_lossy();
    path.strip_prefix(r"\\?\")
        .or_else(|| path.strip_prefix(r"\?\"))
        .map(|path| {
            path.strip_prefix(r"UNC\")
                .map(|rest| format!(r"\\{rest}"))
                .unwrap_or_else(|| path.to_owned())
        })
        .unwrap_or_else(|| path.into_owned())
}

#[test]
fn save_dialog_default_path_ignores_empty_default() {
    assert_eq!(default_save_path_parts(Some("   ")), (None, None));
}

#[test]
fn save_dialog_default_path_accepts_filename_only() {
    assert_eq!(
        default_save_path_parts(Some("archive.zip")),
        (None, Some("archive.zip".to_owned()))
    );
}

#[test]
fn save_dialog_default_path_splits_directory_and_file_name() {
    assert_eq!(
        default_save_path_parts(Some("exports/archive.zip")),
        (
            Some(std::path::PathBuf::from("exports")),
            Some("archive.zip".to_owned())
        )
    );
}

#[test]
fn local_path_string_removes_windows_verbatim_prefixes() {
    assert_eq!(
        normalize_local_path_string(r"\\?\C:\dev\rust\kerminal\node_modules"),
        r"C:\dev\rust\kerminal\node_modules"
    );
    assert_eq!(
        normalize_local_path_string(r"\?\C:\dev\rust\kerminal\node_modules"),
        r"C:\dev\rust\kerminal\node_modules"
    );
    assert_eq!(
        normalize_local_path_string(r"\\?\UNC\nas\share\dist"),
        r"\\nas\share\dist"
    );
}
