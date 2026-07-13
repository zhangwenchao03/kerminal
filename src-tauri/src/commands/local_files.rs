//! 本机文件写操作 Tauri Commands。
//!
//! @author kongweiguang

use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::{
    commands::file_dialog::{read_local_directory, LocalDirectoryListing},
    models::{
        file_preview::{file_preview_response_encoding, is_binary_file_preview_content},
        sftp::SftpFileRevision,
    },
    state::AppState,
    storage::local_file_operations::LocalFileOperationAuditWrite,
};

mod stat;
pub use stat::{LocalPathStat, LocalStatPathRequest};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalCreateDirectoryRequest {
    pub parent_path: String,
    pub name: String,
    pub root_path: Option<String>,
}

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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeletePathRequest {
    pub path: String,
    pub kind: String,
    pub root_path: Option<String>,
    pub confirm_name: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReadTextFileRequest {
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReadTextFileResponse {
    pub path: String,
    pub content: String,
    pub bytes_read: usize,
    pub max_bytes: usize,
    pub truncated: bool,
    pub encoding: String,
    pub line_ending: String,
    pub revision: SftpFileRevision,
    pub binary: bool,
    pub readonly: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalWriteTextFileRequest {
    pub path: String,
    pub content: String,
    pub encoding: String,
    pub expected_revision: Option<SftpFileRevision>,
    pub create: bool,
    pub overwrite_on_conflict: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalWriteTextFileResponse {
    pub path: String,
    pub bytes_written: usize,
    pub encoding: String,
    pub line_ending: String,
    pub revision: SftpFileRevision,
}

const DEFAULT_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;

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
    tokio::task::spawn_blocking(move || create_directory(request))
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
    let delete_result = tokio::task::spawn_blocking(move || delete_path(request))
        .await
        .map_err(|error| format!("删除本机路径线程失败: {error}"))?;
    let audit = local_delete_audit_write(&audit_request, &delete_result);
    state
        .storage()
        .insert_local_file_operation_audit(&audit)
        .map_err(|error| match &delete_result {
            Ok(_) => format!("删除已完成但审计写入失败: {error}"),
            Err(delete_error) => format!("{delete_error}；审计写入失败: {error}"),
        })?;
    delete_result
}

/// 读取本机文本文件，用于中央文件 Tab。
#[tauri::command]
pub async fn local_files_read_text_file(
    request: LocalReadTextFileRequest,
) -> Result<LocalReadTextFileResponse, String> {
    tokio::task::spawn_blocking(move || read_text_file(request))
        .await
        .map_err(|error| format!("读取本机文本文件线程失败: {error}"))?
}

/// 写入本机文本文件，并按 revision 做保存冲突检测。
#[tauri::command]
pub async fn local_files_write_text_file(
    request: LocalWriteTextFileRequest,
) -> Result<LocalWriteTextFileResponse, String> {
    tokio::task::spawn_blocking(move || write_text_file(request))
        .await
        .map_err(|error| format!("写入本机文本文件线程失败: {error}"))?
}

fn create_directory(request: LocalCreateDirectoryRequest) -> Result<LocalDirectoryListing, String> {
    let parent = existing_directory(&request.parent_path, "父目录")?;
    let name = validate_file_name(&request.name)?;
    let target = parent.join(name);
    if let Some(root_path) = request.root_path.as_deref() {
        if !root_path.trim().is_empty() {
            let root = existing_directory(root_path, "根目录")?;
            if !parent.starts_with(&root) || !target.starts_with(&root) {
                return Err(format!(
                    "创建目标超出允许根目录: {} -> {}",
                    parent.display(),
                    target.display()
                ));
            }
        }
    }
    if target.exists() {
        return Err(format!("目标已存在: {}", target.display()));
    }

    fs::create_dir(&target)
        .map_err(|error| format!("创建目录失败 {}: {error}", target.display()))?;
    read_local_directory(Some(parent.to_string_lossy().as_ref()))
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

fn delete_path(request: LocalDeletePathRequest) -> Result<LocalDirectoryListing, String> {
    let source = existing_path(&request.path, "源路径")?;
    let source_parent = source
        .parent()
        .ok_or_else(|| format!("源路径缺少父目录: {}", source.display()))?
        .to_path_buf();
    let source_name = source
        .file_name()
        .ok_or_else(|| format!("不能删除文件系统根路径: {}", source.display()))?
        .to_string_lossy()
        .into_owned();

    let source_kind = local_file_kind(&source)?;
    if request.kind != "file" && request.kind != "directory" {
        return Err(format!("不支持删除的本机路径类型: {}", request.kind));
    }
    if request.kind != source_kind {
        return Err(format!(
            "源路径类型不匹配: 请求为 {}，实际为 {}",
            request.kind, source_kind
        ));
    }
    if request.confirm_name != source_name {
        return Err("删除确认名称不匹配".to_owned());
    }

    if let Some(root_path) = request.root_path.as_deref() {
        if !root_path.trim().is_empty() {
            let root = existing_directory(root_path, "根目录")?;
            if source == root {
                return Err(format!("不能删除根目录本身: {}", root.display()));
            }
            if !source.starts_with(&root) {
                return Err(format!("删除目标超出允许根目录: {}", source.display()));
            }
        }
    }

    if source_kind == "file" {
        fs::remove_file(&source)
            .map_err(|error| format!("删除文件失败 {}: {error}", source.display()))?;
    } else if source_kind == "directory" {
        if !request.recursive {
            return Err(format!("删除目录必须启用递归确认: {}", source.display()));
        }
        reject_directory_tree_symlinks(&source)?;
        fs::remove_dir_all(&source)
            .map_err(|error| format!("删除目录失败 {}: {error}", source.display()))?;
    } else {
        return Err(format!("不支持删除的本机路径类型: {source_kind}"));
    }

    read_local_directory(Some(source_parent.to_string_lossy().as_ref()))
}

fn read_text_file(request: LocalReadTextFileRequest) -> Result<LocalReadTextFileResponse, String> {
    let path = existing_regular_file(&request.path)?;
    let max_bytes = request.max_bytes.unwrap_or(DEFAULT_TEXT_FILE_BYTES);
    let read_limit = max_bytes.saturating_add(1);
    let mut file = fs::File::open(&path)
        .map_err(|error| format!("打开本机文本文件失败 {}: {error}", path.display()))?;
    let mut bytes = Vec::with_capacity(read_limit.min(64 * 1024));
    file.by_ref()
        .take(read_limit as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取本机文本文件失败 {}: {error}", path.display()))?;
    let truncated = bytes.len() > max_bytes;
    let visible_bytes = if truncated {
        &bytes[..max_bytes]
    } else {
        bytes.as_slice()
    };
    let binary = is_binary_file_preview_content(&bytes);
    // 二进制响应只保留元数据和 revision，禁止把原始字节经 lossy 转换后泄露给编辑器。
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(visible_bytes).into_owned()
    };
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("读取本机文件元数据失败 {}: {error}", path.display()))?;

    Ok(LocalReadTextFileResponse {
        path: path_to_owned_string(&path),
        bytes_read: if binary { 0 } else { visible_bytes.len() },
        max_bytes,
        truncated,
        encoding: file_preview_response_encoding(binary).to_owned(),
        line_ending: detect_line_ending(&content),
        revision: local_file_revision(&path, Some(sha256_hex(visible_bytes)))?,
        binary,
        readonly: binary || metadata.permissions().readonly(),
        content,
    })
}

fn write_text_file(
    request: LocalWriteTextFileRequest,
) -> Result<LocalWriteTextFileResponse, String> {
    validate_text_encoding(&request.encoding)?;
    let path = if request.create {
        let trimmed = request.path.trim();
        if trimmed.is_empty() || contains_forbidden_path_char(trimmed) {
            return Err("本机文件路径不能为空或包含非法字符".to_owned());
        }
        PathBuf::from(trimmed)
    } else {
        existing_regular_file(&request.path)?
    };
    if request.create && path_entry_exists(&path) {
        if !request.overwrite_on_conflict {
            return Err(format!(
                "本机文件已存在，不能按新建方式覆盖: {}",
                path.display()
            ));
        }
        reject_symlink(&path, "本机文件")?;
        if !path.is_file() {
            return Err(format!("路径不是普通文件: {}", path.display()));
        }
    }

    let current_revision = if path_entry_exists(&path)
        && (request.expected_revision.is_some() || request.overwrite_on_conflict)
    {
        Some(local_file_revision(&path, None)?)
    } else {
        None
    };
    if !request.overwrite_on_conflict {
        if let (Some(expected), Some(current)) = (
            request.expected_revision.as_ref(),
            current_revision.as_ref(),
        ) {
            if !same_revision(expected, current) {
                return Err("本机文件已变更，请重新加载或选择覆盖后再保存".to_owned());
            }
        }
    }
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.permissions().readonly() {
            return Err(format!("本机文件是只读文件: {}", path.display()));
        }
    }

    let parent = path
        .parent()
        .filter(|parent| parent.components().count() > 0)
        .ok_or_else(|| format!("本机文件缺少父目录: {}", path.display()))?;
    let existing_permissions = fs::metadata(&path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.permissions());
    let temp_path = parent.join(format!(".kerminal-save-{}.tmp", Uuid::new_v4()));
    fs::write(&temp_path, request.content.as_bytes())
        .map_err(|error| format!("写入本机临时文件失败 {}: {error}", temp_path.display()))?;
    if let Some(permissions) = existing_permissions {
        fs::set_permissions(&temp_path, permissions).map_err(|error| {
            format!("设置本机临时文件权限失败 {}: {error}", temp_path.display())
        })?;
    }
    replace_with_temp_file(&temp_path, &path)?;

    Ok(LocalWriteTextFileResponse {
        path: path_to_owned_string(&path),
        bytes_written: request.content.len(),
        encoding: "utf-8".to_owned(),
        line_ending: detect_line_ending(&request.content),
        revision: local_file_revision(&path, Some(sha256_hex(request.content.as_bytes())))?,
    })
}

fn local_delete_audit_write(
    request: &LocalDeletePathRequest,
    result: &Result<LocalDirectoryListing, String>,
) -> LocalFileOperationAuditWrite {
    LocalFileOperationAuditWrite {
        confirmation_matched: requested_confirm_name_matches(request),
        error: result.as_ref().err().cloned(),
        kind: request.kind.clone(),
        operation: "delete".to_owned(),
        parent_path: result.as_ref().ok().map(|listing| listing.path.clone()),
        path: request.path.clone(),
        recursive: request.recursive,
        root_path: request.root_path.clone(),
        status: if result.is_ok() {
            "succeeded".to_owned()
        } else {
            "failed".to_owned()
        },
    }
}

fn replace_with_temp_file(temp_path: &Path, path: &Path) -> Result<(), String> {
    if !path_entry_exists(path) {
        return fs::rename(temp_path, path).map_err(|error| {
            let _ = fs::remove_file(temp_path);
            format!(
                "保存本机文件失败 {} -> {}: {error}",
                temp_path.display(),
                path.display()
            )
        });
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("本机文件缺少父目录: {}", path.display()))?;
    let backup_path = parent.join(format!(".kerminal-save-{}.bak", Uuid::new_v4()));
    fs::rename(path, &backup_path).map_err(|error| {
        let _ = fs::remove_file(temp_path);
        format!("准备替换本机文件失败 {}: {error}", path.display())
    })?;

    match fs::rename(temp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup_path);
            Ok(())
        }
        Err(error) => {
            let restore_result = fs::rename(&backup_path, path);
            let _ = fs::remove_file(temp_path);
            match restore_result {
                Ok(()) => Err(format!(
                    "保存本机文件失败 {} -> {}，原文件已恢复: {error}",
                    temp_path.display(),
                    path.display()
                )),
                Err(restore_error) => Err(format!(
                    "保存本机文件失败 {} -> {}，且恢复原文件失败 {} -> {}: {error}; {restore_error}",
                    temp_path.display(),
                    path.display(),
                    backup_path.display(),
                    path.display()
                )),
            }
        }
    }
}

fn requested_confirm_name_matches(request: &LocalDeletePathRequest) -> bool {
    Path::new(&request.path)
        .file_name()
        .map(|name| name.to_string_lossy() == request.confirm_name)
        .unwrap_or(false)
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

fn existing_regular_file(path: &str) -> Result<PathBuf, String> {
    let file = existing_path(path, "本机文件")?;
    if !file.is_file() {
        return Err(format!("路径不是普通文件: {}", file.display()));
    }
    Ok(file)
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

fn validate_text_encoding(encoding: &str) -> Result<(), String> {
    match encoding {
        "utf-8" | "utf-8-lossy" => Ok(()),
        _ => Err(format!("暂不支持的文本编码: {encoding}")),
    }
}

fn local_file_revision(
    path: &Path,
    content_sha256: Option<String>,
) -> Result<SftpFileRevision, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("读取本机文件元数据失败 {}: {error}", path.display()))?;
    let content_sha256 = match content_sha256 {
        Some(hash) => Some(hash),
        None => Some(sha256_hex(&fs::read(path).map_err(|error| {
            format!("读取本机文件 revision 失败 {}: {error}", path.display())
        })?)),
    };
    Ok(SftpFileRevision {
        size: metadata.len(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs().to_string()),
        permissions: Some(if metadata.permissions().readonly() {
            "readonly".to_owned()
        } else {
            "writable".to_owned()
        }),
        permissions_mode: None,
        content_sha256,
    })
}

fn same_revision(expected: &SftpFileRevision, current: &SftpFileRevision) -> bool {
    match (&expected.content_sha256, &current.content_sha256) {
        (Some(expected_hash), Some(current_hash)) => expected_hash == current_hash,
        _ => expected.size == current.size && expected.modified == current.modified,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn detect_line_ending(content: &str) -> String {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    match (crlf > 0, lf > 0) {
        (true, true) => "mixed",
        (true, false) => "crlf",
        _ => "lf",
    }
    .to_owned()
}

fn path_to_owned_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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

fn reject_directory_tree_symlinks(directory: &Path) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("读取待删除目录失败 {}: {error}", directory.display()))?
    {
        let entry = entry
            .map_err(|error| format!("读取待删除目录项失败 {}: {error}", directory.display()))?;
        let child = entry.path();
        reject_symlink(&child, "待删除目录项")?;
        if local_file_kind(&child)? == "directory" {
            reject_directory_tree_symlinks(&child)?;
        }
    }
    Ok(())
}
