//! 本地文件选择 Tauri Commands。
//!
//! @author kongweiguang

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use std::{
    any::Any,
    panic::{self, AssertUnwindSafe},
};

pub mod path_model;

use self::path_model::{default_save_path_parts, path_to_string};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryListing {
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<LocalDirectoryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub hidden: bool,
    pub raw: String,
}

/// 选择一个本地文件。
#[tauri::command]
pub async fn file_dialog_select_local_file() -> Result<Option<String>, String> {
    run_path_dialog("本地文件选择器", || {
        rfd::FileDialog::new().set_title("选择本地文件").pick_file()
    })
    .await
}

/// 选择一个本地图片文件。
#[tauri::command]
pub async fn file_dialog_select_local_image() -> Result<Option<String>, String> {
    run_path_dialog("本地图片选择器", || {
        rfd::FileDialog::new()
            .set_title("选择图片")
            .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
            .pick_file()
    })
    .await
}

/// 选择一个本地目录。
#[tauri::command]
pub async fn file_dialog_select_local_directory() -> Result<Option<String>, String> {
    run_path_dialog("本地目录选择器", || {
        rfd::FileDialog::new()
            .set_title("选择本地目录")
            .pick_folder()
    })
    .await
}

/// 列出本地目录，未指定路径时使用当前用户 home 目录。
#[tauri::command]
pub async fn file_dialog_list_local_directory(
    path: Option<String>,
) -> Result<LocalDirectoryListing, String> {
    tokio::task::spawn_blocking(move || read_local_directory(path.as_deref()))
        .await
        .map_err(|error| format!("读取本地目录线程失败: {error}"))?
}

/// 打开一个本地目录，不存在时先创建目录。
#[tauri::command]
pub async fn file_dialog_open_local_directory(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = path.trim();
        if path.is_empty() {
            return Err("本地目录路径不能为空".to_owned());
        }

        let directory = expand_user_path(path);
        if directory.exists() && !directory.is_dir() {
            return Err(format!("路径不是目录: {}", directory.display()));
        }
        fs::create_dir_all(&directory)
            .map_err(|error| format!("创建目录失败 {}: {error}", directory.display()))?;
        open_directory(&directory)
    })
    .await
    .map_err(|error| format!("打开本地目录线程失败: {error}"))?
}

/// 选择保存文件路径。
#[tauri::command]
pub async fn file_dialog_select_save_file(
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    run_path_dialog("本地保存文件选择器", move || {
        let dialog = apply_default_save_path(
            rfd::FileDialog::new().set_title("选择保存位置"),
            default_path.as_deref(),
        );
        dialog.save_file()
    })
    .await
}

async fn run_path_dialog<F>(label: &'static str, operation: F) -> Result<Option<String>, String>
where
    F: FnOnce() -> Option<PathBuf> + Send + 'static,
{
    let result =
        tokio::task::spawn_blocking(move || panic::catch_unwind(AssertUnwindSafe(operation)))
            .await
            .map_err(|error| format!("{label}线程失败: {error}"))?;

    match result {
        Ok(selected) => Ok(selected.map(path_to_string)),
        Err(payload) => Err(format!(
            "{label}发生内部异常，已阻止应用退出: {}",
            panic_payload_message(&payload)
        )),
    }
}

fn apply_default_save_path(
    mut dialog: rfd::FileDialog,
    default_path: Option<&str>,
) -> rfd::FileDialog {
    let (directory, file_name) = default_save_path_parts(default_path);
    if let Some(parent) = directory {
        dialog = dialog.set_directory(parent);
    }
    if let Some(file_name) = file_name {
        dialog = dialog.set_file_name(file_name);
    }
    dialog
}

pub(crate) fn read_local_directory(path: Option<&str>) -> Result<LocalDirectoryListing, String> {
    let directory = resolve_local_directory(path)?;
    let mut entries = Vec::new();

    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("读取本地目录失败 {}: {error}", directory.display()))?
    {
        let entry = entry
            .map_err(|error| format!("读取本地目录项失败 {}: {error}", directory.display()))?;
        if let Some(mapped) = local_directory_entry(&entry) {
            entries.push(mapped);
        }
    }

    entries.sort_by(|left, right| {
        local_entry_kind_rank(&left.kind)
            .cmp(&local_entry_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(LocalDirectoryListing {
        parent_path: parent_local_path(&directory),
        path: path_to_string(directory),
        entries,
    })
}

fn resolve_local_directory(path: Option<&str>) -> Result<PathBuf, String> {
    let directory = path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(expand_user_path)
        .or_else(dirs::home_dir)
        .or_else(|| env::current_dir().ok())
        .ok_or_else(|| "无法确定本地目录".to_owned())?;
    let directory = directory
        .canonicalize()
        .map_err(|error| format!("解析本地目录失败 {}: {error}", directory.display()))?;

    if !directory.is_dir() {
        return Err(format!("路径不是目录: {}", directory.display()));
    }
    Ok(directory)
}

fn local_directory_entry(entry: &fs::DirEntry) -> Option<LocalDirectoryEntry> {
    let path = entry.path();
    let file_type = entry.file_type().ok();
    let metadata = fs::symlink_metadata(&path).ok();
    let kind = if file_type
        .as_ref()
        .is_some_and(|file_type| file_type.is_dir())
    {
        "directory"
    } else if file_type
        .as_ref()
        .is_some_and(|file_type| file_type.is_symlink())
    {
        "symlink"
    } else if file_type
        .as_ref()
        .is_some_and(|file_type| file_type.is_file())
    {
        "file"
    } else if let Some(metadata) = metadata.as_ref() {
        let metadata_file_type = metadata.file_type();
        if metadata_file_type.is_symlink() {
            "symlink"
        } else if metadata_file_type.is_dir() {
            "directory"
        } else if metadata_file_type.is_file() {
            "file"
        } else {
            "other"
        }
    } else {
        "other"
    };
    let name = entry.file_name().to_string_lossy().into_owned();
    let hidden = is_hidden_local_entry(&name, metadata.as_ref());
    let modified = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string());
    let size = metadata
        .as_ref()
        .filter(|_| kind != "directory")
        .map(|metadata| metadata.len());

    Some(LocalDirectoryEntry {
        name,
        path: path_to_string(path),
        kind: kind.to_owned(),
        size,
        modified,
        hidden,
        raw: format!("{kind} {}", entry.path().display()),
    })
}

fn is_hidden_local_entry(name: &str, metadata: Option<&fs::Metadata>) -> bool {
    name.starts_with('.') || platform_hidden_file_attributes(metadata)
}

#[cfg(windows)]
fn platform_hidden_file_attributes(metadata: Option<&fs::Metadata>) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

    metadata.is_some_and(|metadata| {
        metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    })
}

#[cfg(not(windows))]
fn platform_hidden_file_attributes(_metadata: Option<&fs::Metadata>) -> bool {
    false
}

fn local_entry_kind_rank(kind: &str) -> u8 {
    match kind {
        "directory" => 0,
        "file" => 1,
        "symlink" => 2,
        _ => 3,
    }
}

fn parent_local_path(path: &Path) -> Option<String> {
    path.parent()
        .filter(|parent| parent.components().count() > 0)
        .map(Path::to_path_buf)
        .map(path_to_string)
}

fn expand_user_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    let Some(home) = dirs::home_dir() else {
        return PathBuf::from(trimmed);
    };
    if trimmed == "~" {
        return home;
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return home.join(rest);
    }
    PathBuf::from(trimmed)
}

fn open_directory(path: &Path) -> Result<(), String> {
    let mut command = platform_open_directory_command(path);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开目录失败 {}: {error}", path.display()))
}

#[cfg(target_os = "windows")]
fn platform_open_directory_command(path: &Path) -> Command {
    let mut command = Command::new("explorer");
    command.arg(path);
    command
}

#[cfg(target_os = "macos")]
fn platform_open_directory_command(path: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg(path);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_open_directory_command(path: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    command
}

fn panic_payload_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&'static str>() {
        return (*message).to_owned();
    }
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    "未知 panic payload".to_owned()
}
