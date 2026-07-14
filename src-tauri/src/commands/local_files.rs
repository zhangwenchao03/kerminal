//! 本机文件写操作 Tauri Commands。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::State;

use crate::{
    commands::file_dialog::{read_local_directory, LocalDirectoryListing},
    services::local_file_service,
    state::AppState,
};

mod stat;
pub use stat::{LocalPathStat, LocalStatPathRequest};

pub use crate::services::local_file_service::{
    LocalCopyPathRequest, LocalCreateDirectoryRequest, LocalDeletePathRequest,
    LocalReadTextFileRequest, LocalReadTextFileResponse, LocalRenamePathRequest,
    LocalWriteTextFileRequest, LocalWriteTextFileResponse,
};

/// 获取本机路径元信息，用于传输冲突预检；不存在不是错误。
#[tauri::command]
pub async fn local_files_stat_path(request: LocalStatPathRequest) -> Result<LocalPathStat, String> {
    stat::local_files_stat_path(request).await
}

/// 创建本机目录并返回父目录刷新结果。
#[tauri::command]
pub async fn local_files_create_directory(
    request: LocalCreateDirectoryRequest,
) -> Result<LocalDirectoryListing, String> {
    tokio::task::spawn_blocking(move || {
        local_file_service::create_directory(request).and_then(|outcome| {
            read_local_directory(Some(outcome.parent_path.to_string_lossy().as_ref()))
        })
    })
    .await
    .map_err(|error| format!("创建本机目录线程失败: {error}"))?
}

/// 本机到本机复制文件或目录，默认不覆盖已存在目标。
#[tauri::command]
pub async fn local_files_copy_path(
    request: LocalCopyPathRequest,
) -> Result<LocalDirectoryListing, String> {
    tokio::task::spawn_blocking(move || {
        local_file_service::copy_path(request).and_then(|outcome| {
            read_local_directory(Some(
                outcome.target_directory_path.to_string_lossy().as_ref(),
            ))
        })
    })
    .await
    .map_err(|error| format!("复制本机路径线程失败: {error}"))?
}

/// 重命名本机文件或目录，只允许同父目录改名，默认不覆盖。
#[tauri::command]
pub async fn local_files_rename_path(
    request: LocalRenamePathRequest,
) -> Result<LocalDirectoryListing, String> {
    tokio::task::spawn_blocking(move || {
        local_file_service::rename_path(request).and_then(|outcome| {
            read_local_directory(Some(outcome.parent_path.to_string_lossy().as_ref()))
        })
    })
    .await
    .map_err(|error| format!("重命名本机路径线程失败: {error}"))?
}

/// 删除本机文件或目录；目录删除必须显式递归确认。
#[tauri::command]
pub async fn local_files_delete_path(
    state: State<'_, AppState>,
    request: LocalDeletePathRequest,
) -> Result<LocalDirectoryListing, String> {
    let audit_request = request.clone();
    let delete_result = tokio::task::spawn_blocking(move || {
        local_file_service::delete_path(request).and_then(|outcome| {
            read_local_directory(Some(outcome.parent_path.to_string_lossy().as_ref()))
        })
    })
    .await
    .map_err(|error| format!("删除本机路径线程失败: {error}"))?;
    local_file_service::record_delete_audit(
        state.storage(),
        &audit_request,
        delete_result
            .as_ref()
            .map(|listing| listing.path.as_str())
            .map_err(String::as_str),
    )?;
    delete_result
}

/// 读取本机文本文件，用于中央文件 Tab。
#[tauri::command]
pub async fn local_files_read_text_file(
    request: LocalReadTextFileRequest,
) -> Result<LocalReadTextFileResponse, String> {
    tokio::task::spawn_blocking(move || local_file_service::read_text_file(request))
        .await
        .map_err(|error| format!("读取本机文本文件线程失败: {error}"))?
}

/// 写入本机文本文件，并按 revision 做保存冲突检测。
#[tauri::command]
pub async fn local_files_write_text_file(
    request: LocalWriteTextFileRequest,
) -> Result<LocalWriteTextFileResponse, String> {
    tokio::task::spawn_blocking(move || local_file_service::write_text_file(request))
        .await
        .map_err(|error| format!("写入本机文本文件线程失败: {error}"))?
}

fn existing_path(path: &str, label: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if contains_forbidden_path_char(trimmed) {
        return Err(format!("{label}包含非法字符"));
    }
    let path = PathBuf::from(trimmed);
    reject_symlink(&path, label)?;
    path.canonicalize()
        .map_err(|error| format!("解析{label}失败 {trimmed}: {error}"))
}

pub(super) fn existing_directory(path: &str, label: &str) -> Result<PathBuf, String> {
    let directory = existing_path(path, label)?;
    if !directory.is_dir() {
        return Err(format!("{label}不是目录: {}", directory.display()));
    }
    Ok(directory)
}

pub(super) fn contains_forbidden_path_char(value: &str) -> bool {
    value.contains('\0') || value.contains('\n') || value.contains('\r')
}

pub(super) fn path_entry_exists(path: &Path) -> bool {
    path.exists() || fs::symlink_metadata(path).is_ok()
}

fn reject_symlink(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("读取{label}元数据失败 {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "{label}是符号链接，暂不支持本机写操作: {}",
            path.display()
        ));
    }
    Ok(())
}

pub(super) fn local_file_kind(path: &Path) -> Result<&'static str, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("读取路径元数据失败 {}: {error}", path.display()))?;
    if metadata.is_dir() {
        return Ok("directory");
    }
    if metadata.is_file() {
        return Ok("file");
    }
    Ok("other")
}
