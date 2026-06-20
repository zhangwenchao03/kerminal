//! 本地文件选择 Tauri Commands。
//!
//! @author kongweiguang

use std::{
    any::Any,
    fs,
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::Command,
};

use tauri::State;

use crate::state::AppState;

/// 选择一个本地文件。
#[tauri::command]
pub async fn file_dialog_select_local_file() -> Result<Option<String>, String> {
    run_path_dialog("本地文件选择器", || {
        rfd::FileDialog::new().set_title("选择本地文件").pick_file()
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

/// 返回 Kerminal 管理的默认 Skills 根目录，不存在时先创建。
#[tauri::command]
pub async fn file_dialog_get_app_skills_directory(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let directory = state.paths().skills.clone();
    tokio::task::spawn_blocking(move || {
        fs::create_dir_all(&directory)
            .map_err(|error| format!("创建 Skills 目录失败 {}: {error}", directory.display()))?;
        Ok(path_to_string(directory))
    })
    .await
    .map_err(|error| format!("读取 Skills 目录线程失败: {error}"))?
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
    let Some(default_path) = default_path.map(str::trim).filter(|path| !path.is_empty()) else {
        return dialog;
    };

    let path = Path::new(default_path);
    if let Some(parent) = path
        .parent()
        .filter(|parent| parent.components().count() > 0)
    {
        dialog = dialog.set_directory(parent);
    }
    if let Some(file_name) = path.file_name().and_then(|name| name.to_str()) {
        dialog = dialog.set_file_name(file_name);
    }
    dialog
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
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

#[cfg(test)]
mod tests {
    use super::apply_default_save_path;

    #[test]
    fn apply_default_save_path_accepts_empty_default() {
        let _dialog = apply_default_save_path(rfd::FileDialog::new(), Some("   "));
    }

    #[test]
    fn apply_default_save_path_accepts_filename_only() {
        let _dialog = apply_default_save_path(rfd::FileDialog::new(), Some("archive.zip"));
    }
}
