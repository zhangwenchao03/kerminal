//! 本机文本文件读写服务。
//!
//! 该服务只处理平台文件 I/O，不依赖 Tauri 状态或命令上下文，方便复用和独立验证。

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::models::{
    file_preview::{file_preview_response_encoding, is_binary_file_preview_content},
    sftp::SftpFileRevision,
};

const DEFAULT_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReadTextFileRequest {
    pub path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalWriteTextFileResponse {
    pub path: String,
    pub bytes_written: usize,
    pub encoding: String,
    pub line_ending: String,
    pub revision: SftpFileRevision,
}

/// 读取文本编辑器所需的预览和完整文件 revision。
pub fn read_text_file(
    request: LocalReadTextFileRequest,
) -> Result<LocalReadTextFileResponse, String> {
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
    // 二进制响应只保留元数据和 revision，禁止将原始字节转换给编辑器。
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
        // 保存冲突检测必须基于完整文件，而不是截断预览的可见片段。
        revision: local_file_revision(&path, None)?,
        binary,
        readonly: binary || metadata.permissions().readonly(),
        content,
    })
}

/// 按 revision 执行本机文本文件保存，并通过同目录临时文件保证替换可恢复。
pub fn write_text_file(
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
                Ok(()) => Err(format!("保存本机文件失败 {} -> {}，原文件已恢复: {error}", temp_path.display(), path.display())),
                Err(restore_error) => Err(format!("保存本机文件失败 {} -> {}，且恢复原文件失败 {} -> {}: {error}; {restore_error}", temp_path.display(), path.display(), backup_path.display(), path.display())),
            }
        }
    }
}

fn existing_regular_file(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("本机文件不能为空".to_owned());
    }
    if contains_forbidden_path_char(trimmed) {
        return Err("本机文件包含非法字符".to_owned());
    }
    let path = PathBuf::from(trimmed);
    reject_symlink(&path, "本机文件")?;
    let file = path
        .canonicalize()
        .map_err(|error| format!("解析本机文件失败 {trimmed}: {error}"))?;
    if !file.is_file() {
        return Err(format!("路径不是普通文件: {}", file.display()));
    }
    Ok(file)
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

fn path_entry_exists(path: &Path) -> bool {
    path.exists() || fs::symlink_metadata(path).is_ok()
}
fn contains_forbidden_path_char(value: &str) -> bool {
    value.contains('\0') || value.contains('\n') || value.contains('\r')
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
