//! 本机文件写操作 Tauri Commands。
//!
//! @author kongweiguang

use tauri::State;

use crate::{
    commands::file_dialog::{read_local_directory, LocalDirectoryListing},
    services::local_file_service,
    state::AppState,
};

pub use crate::services::local_file_service::{
    LocalCopyPathRequest, LocalCreateDirectoryRequest, LocalDeletePathRequest, LocalPathStat,
    LocalReadTextFileRequest, LocalReadTextFileResponse, LocalRenamePathRequest,
    LocalStatPathRequest, LocalWriteTextFileRequest, LocalWriteTextFileResponse,
};

/// 获取本机路径元信息，用于传输冲突预检；不存在不是错误。
#[tauri::command]
pub async fn local_files_stat_path(request: LocalStatPathRequest) -> Result<LocalPathStat, String> {
    tokio::task::spawn_blocking(move || local_file_service::stat_path(request))
        .await
        .map_err(|error| format!("读取本机路径状态线程失败: {error}"))?
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
