//! 本机文件写操作 Tauri Commands。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use tauri::State;

use crate::{
    commands::file_dialog::{read_local_directory, LocalDirectoryListing},
    services::local_file_service,
    state::AppState,
};

mod stat;
pub use stat::{LocalPathStat, LocalStatPathRequest};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCopyPathRequest {
    pub source_path: String,
    pub target_directory_path: String,
    pub kind: String,
    pub root_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRenamePathRequest {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub root_path: Option<String>,
}

pub use crate::services::local_file_service::{
    LocalCreateDirectoryRequest, LocalDeletePathRequest, LocalReadTextFileRequest,
    LocalReadTextFileResponse, LocalWriteTextFileRequest, LocalWriteTextFileResponse,
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
    tokio::task::spawn_blocking(move || copy_path(request))
        .await
        .map_err(|error| format!("复制本机路径线程失败: {error}"))?
}

/// 重命名本机文件或目录，只允许同父目录改名，默认不覆盖。
#[tauri::command]
pub async fn local_files_rename_path(
    request: LocalRenamePathRequest,
) -> Result<LocalDirectoryListing, String> {
    tokio::task::spawn_blocking(move || rename_path(request))
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

fn copy_path(request: LocalCopyPathRequest) -> Result<LocalDirectoryListing, String> {
    let source = existing_path(&request.source_path, "源路径")?;
    let target_directory = existing_directory(&request.target_directory_path, "目标目录")?;
    let source_kind = local_file_kind(&source)?;
    if request.kind != source_kind {
        return Err(format!(
            "源路径类型不匹配: 请求为 {}，实际为 {}",
            request.kind, source_kind
        ));
    }

    let file_name = source
        .file_name()
        .ok_or_else(|| format!("源路径缺少文件名: {}", source.display()))?;
    let target = target_directory.join(file_name);
    if let Some(root_path) = request.root_path.as_deref() {
        if !root_path.trim().is_empty() {
            let root = existing_directory(root_path, "根目录")?;
            if !target_directory.starts_with(&root) || !target.starts_with(&root) {
                return Err(format!("复制目标超出允许根目录: {}", target.display()));
            }
        }
    }
    if target.exists() {
        return Err(format!("目标已存在: {}", target.display()));
    }

    if source_kind == "directory" {
        reject_copy_into_self(&source, &target)?;
        copy_directory_recursive(&source, &target)?;
    } else if source_kind == "file" {
        fs::copy(&source, &target)
            .map_err(|error| format!("复制文件失败 {}: {error}", source.display()))?;
    } else {
        return Err(format!("不支持复制的本机路径类型: {source_kind}"));
    }

    read_local_directory(Some(target_directory.to_string_lossy().as_ref()))
}

fn rename_path(request: LocalRenamePathRequest) -> Result<LocalDirectoryListing, String> {
    let source = existing_path(&request.path, "源路径")?;
    let name = validate_file_name(&request.name)?;
    let source_parent = source
        .parent()
        .ok_or_else(|| format!("源路径缺少父目录: {}", source.display()))?
        .to_path_buf();
    if source.file_name().is_none() {
        return Err(format!("不能重命名文件系统根路径: {}", source.display()));
    }

    let source_kind = local_file_kind(&source)?;
    if request.kind != "file" && request.kind != "directory" {
        return Err(format!("不支持重命名的本机路径类型: {}", request.kind));
    }
    if request.kind != source_kind {
        return Err(format!(
            "源路径类型不匹配: 请求为 {}，实际为 {}",
            request.kind, source_kind
        ));
    }

    let target = source_parent.join(name);
    if path_entry_exists(&target) {
        return Err(format!("目标已存在: {}", target.display()));
    }

    if let Some(root_path) = request.root_path.as_deref() {
        if !root_path.trim().is_empty() {
            let root = existing_directory(root_path, "根目录")?;
            if source == root {
                return Err(format!("不能重命名根目录本身: {}", root.display()));
            }
            if !source.starts_with(&root) || !target.starts_with(&root) {
                return Err(format!(
                    "重命名目标超出允许根目录: {} -> {}",
                    source.display(),
                    target.display()
                ));
            }
        }
    }

    fs::rename(&source, &target).map_err(|error| {
        format!(
            "重命名本机路径失败 {} -> {}: {error}",
            source.display(),
            target.display()
        )
    })?;
    read_local_directory(Some(source_parent.to_string_lossy().as_ref()))
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

fn validate_file_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件名不能为空".to_owned());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("文件名不能是 . 或 ..".to_owned());
    }
    if contains_forbidden_path_char(trimmed)
        || Path::new(trimmed).components().count() != 1
        || matches!(
            Path::new(trimmed).components().next(),
            Some(Component::RootDir | Component::Prefix(_) | Component::ParentDir)
        )
    {
        return Err("文件名不能包含路径分隔符或非法字符".to_owned());
    }
    if contains_windows_forbidden_file_name_char(trimmed) {
        return Err("文件名包含 Windows 不允许的字符".to_owned());
    }
    if trimmed.ends_with(' ') || trimmed.ends_with('.') {
        return Err("文件名不能以空格或点结尾".to_owned());
    }
    let reserved_name = trimmed
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if is_windows_reserved_file_name(&reserved_name) {
        return Err("文件名不能使用 Windows 保留名称".to_owned());
    }
    Ok(trimmed)
}

pub(super) fn contains_forbidden_path_char(value: &str) -> bool {
    value.contains('\0') || value.contains('\n') || value.contains('\r')
}

fn contains_windows_forbidden_file_name_char(value: &str) -> bool {
    value.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )
    })
}

pub(super) fn is_windows_reserved_file_name(name: &str) -> bool {
    matches!(name, "CON" | "PRN" | "AUX" | "NUL")
        || (name.len() == 4
            && (name.starts_with("COM") || name.starts_with("LPT"))
            && name[3..]
                .chars()
                .all(|character| ('1'..='9').contains(&character)))
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

fn reject_copy_into_self(source: &Path, target: &Path) -> Result<(), String> {
    if target.starts_with(source) {
        return Err(format!(
            "不能把目录复制到自身或子目录: {} -> {}",
            source.display(),
            target.display()
        ));
    }
    Ok(())
}

fn copy_directory_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir(target)
        .map_err(|error| format!("创建目标目录失败 {}: {error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("读取源目录失败 {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("读取源目录项失败 {}: {error}", source.display()))?;
        let source_child = entry.path();
        reject_symlink(&source_child, "源目录项")?;
        let target_child = target.join(entry.file_name());
        let kind = local_file_kind(&source_child)?;
        if kind == "directory" {
            copy_directory_recursive(&source_child, &target_child)?;
        } else if kind == "file" {
            fs::copy(&source_child, &target_child)
                .map_err(|error| format!("复制文件失败 {}: {error}", source_child.display()))?;
        } else {
            return Err(format!(
                "不支持复制的本机路径类型: {} ({})",
                kind,
                source_child.display()
            ));
        }
    }
    Ok(())
}
