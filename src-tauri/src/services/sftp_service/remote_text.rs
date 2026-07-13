//! SFTP 远端条目、文本文件和 revision helper。
//!
//! @author kongweiguang

use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, FileMode, FileType, OpenFlags},
};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        file_preview::{file_preview_response_encoding, is_binary_file_preview_content},
        sftp::{
            SftpEntry, SftpEntryKind, SftpFileRevision, SftpPathStat, SftpReadTextFileResponse,
            SftpWriteTextFileRequest, SftpWriteTextFileResponse,
        },
    },
};

use super::{
    backend::{io_sftp_error, native_sftp_error},
    transfer_paths::parent_remote_path,
    MAX_TEXT_FILE_BYTES,
};

pub(super) fn sftp_entry_from_native(entry: &russh_sftp::client::fs::DirEntry) -> SftpEntry {
    let metadata = entry.metadata();
    let name = entry.file_name();
    let kind = sftp_entry_kind(entry.file_type());
    let permissions = permission_text(&metadata);
    let modified = metadata.mtime.map(|mtime| mtime.to_string());
    let size = metadata.size;
    let raw = format!(
        "{} {} {}",
        permissions.as_deref().unwrap_or("----------"),
        size.unwrap_or(0),
        name
    );

    SftpEntry {
        name,
        path: entry.path(),
        kind,
        size,
        permissions,
        modified,
        raw,
    }
}

fn sftp_entry_kind(file_type: FileType) -> SftpEntryKind {
    match file_type {
        FileType::Dir => SftpEntryKind::Directory,
        FileType::File => SftpEntryKind::File,
        FileType::Symlink => SftpEntryKind::Symlink,
        FileType::Other => SftpEntryKind::Other,
    }
}

pub(super) fn sftp_entry_kind_rank(kind: &SftpEntryKind) -> u8 {
    match kind {
        SftpEntryKind::Directory => 0,
        SftpEntryKind::File => 1,
        SftpEntryKind::Symlink => 2,
        SftpEntryKind::Other => 3,
    }
}

fn permission_text(metadata: &FileAttributes) -> Option<String> {
    let permissions = metadata.permissions?;
    let file_type = FileMode::from_bits_truncate(permissions);
    let prefix = if file_type.contains(FileMode::DIR) {
        'd'
    } else if file_type.contains(FileMode::LNK) {
        'l'
    } else {
        '-'
    };
    Some(format!("{prefix}{}", metadata.permissions()))
}

pub(super) async fn read_remote_text_file(
    sftp: &SftpSession,
    host_id: String,
    path: String,
    max_bytes: usize,
) -> AppResult<SftpReadTextFileResponse> {
    let metadata = sftp
        .metadata(path.clone())
        .await
        .map_err(native_sftp_error)?;
    let read_limit = max_bytes.saturating_add(1);
    let bytes = read_remote_file_bytes(sftp, &path, read_limit).await?;
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
    let revision = revision_from_metadata(&metadata, Some(sha256_hex(visible_bytes)));

    Ok(SftpReadTextFileResponse {
        host_id,
        path,
        bytes_read: if binary { 0 } else { visible_bytes.len() },
        max_bytes,
        truncated,
        encoding: file_preview_response_encoding(binary).to_owned(),
        line_ending: detect_line_ending(&content),
        revision,
        binary,
        readonly: binary,
        content,
    })
}

pub(super) async fn write_remote_text_file(
    sftp: &SftpSession,
    host_id: String,
    path: String,
    request: SftpWriteTextFileRequest,
) -> AppResult<SftpWriteTextFileResponse> {
    if request.create && !request.overwrite_on_conflict {
        if let Ok(existing_revision) = remote_file_revision(sftp, &path).await {
            return Err(AppError::Sftp(format!(
                "远程文件已存在，不能按新建方式覆盖: {} ({:?})",
                path, existing_revision.modified
            )));
        }
    }

    let current_revision = if request.expected_revision.is_some() || request.overwrite_on_conflict {
        remote_file_revision(sftp, &path).await.ok()
    } else {
        None
    };

    if !request.overwrite_on_conflict {
        if let (Some(expected), Some(current)) = (
            request.expected_revision.as_ref(),
            current_revision.as_ref(),
        ) {
            if !same_revision(expected, current) {
                return Err(AppError::Sftp(
                    "远端文件已变更，请重新加载或选择覆盖后再保存".to_owned(),
                ));
            }
        }
    }

    let bytes = request.content.as_bytes();
    let temp_path = remote_save_temp_path(&path);
    let mode = request
        .expected_revision
        .as_ref()
        .and_then(|revision| revision.permissions_mode)
        .or_else(|| {
            current_revision
                .as_ref()
                .and_then(|revision| revision.permissions_mode)
        });

    let mut temp_file = sftp
        .open_with_flags(
            temp_path.clone(),
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(native_sftp_error)?;
    temp_file.write_all(bytes).await.map_err(io_sftp_error)?;
    temp_file.shutdown().await.map_err(io_sftp_error)?;

    if let Some(mode) = mode {
        let mut attrs = FileAttributes::empty();
        attrs.permissions = Some(mode);
        sftp.set_metadata(temp_path.clone(), attrs)
            .await
            .map_err(native_sftp_error)?;
    }

    if let Err(rename_error) = sftp.rename(temp_path.clone(), path.clone()).await {
        if !request.create {
            sftp.remove_file(path.clone())
                .await
                .map_err(native_sftp_error)?;
            sftp.rename(temp_path.clone(), path.clone())
                .await
                .map_err(native_sftp_error)?;
        } else {
            let _ = sftp.remove_file(temp_path).await;
            return Err(native_sftp_error(rename_error));
        }
    }

    let revision = remote_file_revision(sftp, &path).await?;
    Ok(SftpWriteTextFileResponse {
        host_id,
        path,
        bytes_written: bytes.len(),
        encoding: "utf-8".to_owned(),
        line_ending: detect_line_ending(&request.content),
        revision,
    })
}

pub(super) async fn stat_remote_path(
    sftp: &SftpSession,
    host_id: String,
    path: String,
) -> AppResult<SftpPathStat> {
    let metadata = sftp
        .metadata(path.clone())
        .await
        .map_err(native_sftp_error)?;
    let kind = sftp_entry_kind(metadata.file_type());
    let revision = if kind == SftpEntryKind::File {
        Some(remote_file_revision(sftp, &path).await?)
    } else {
        None
    };

    Ok(SftpPathStat {
        host_id,
        path,
        kind,
        size: metadata.size,
        permissions: permission_text(&metadata),
        modified: metadata.mtime.map(|mtime| mtime.to_string()),
        revision,
        readonly: false,
    })
}

async fn remote_file_revision(sftp: &SftpSession, path: &str) -> AppResult<SftpFileRevision> {
    let metadata = sftp
        .metadata(path.to_owned())
        .await
        .map_err(native_sftp_error)?;
    let bytes = read_remote_file_bytes(sftp, path, MAX_TEXT_FILE_BYTES.saturating_add(1)).await?;
    Ok(revision_from_metadata(&metadata, Some(sha256_hex(&bytes))))
}

async fn read_remote_file_bytes(
    sftp: &SftpSession,
    path: &str,
    max_bytes: usize,
) -> AppResult<Vec<u8>> {
    let file = sftp
        .open(path.to_owned())
        .await
        .map_err(native_sftp_error)?;
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut reader = file.take(max_bytes as u64);
    reader
        .read_to_end(&mut bytes)
        .await
        .map_err(io_sftp_error)?;
    Ok(bytes)
}

fn revision_from_metadata(
    metadata: &FileAttributes,
    content_sha256: Option<String>,
) -> SftpFileRevision {
    SftpFileRevision {
        size: metadata.size.unwrap_or(0),
        modified: metadata.mtime.map(|mtime| mtime.to_string()),
        permissions: permission_text(metadata),
        permissions_mode: metadata.permissions,
        content_sha256,
    }
}

fn same_revision(expected: &SftpFileRevision, current: &SftpFileRevision) -> bool {
    match (&expected.content_sha256, &current.content_sha256) {
        (Some(expected_hash), Some(current_hash)) => expected_hash == current_hash,
        _ => expected.size == current.size && expected.modified == current.modified,
    }
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn detect_line_ending(content: &str) -> String {
    let crlf = content.matches("\r\n").count();
    let lf = content.matches('\n').count().saturating_sub(crlf);
    match (crlf > 0, lf > 0) {
        (true, true) => "mixed",
        (true, false) => "crlf",
        _ => "lf",
    }
    .to_owned()
}

fn remote_save_temp_path(path: &str) -> String {
    let parent = parent_remote_path(path).unwrap_or_else(|| "/".to_owned());
    let normalized_parent = parent.trim_end_matches('/');
    let prefix = if normalized_parent.is_empty() {
        "/".to_owned()
    } else {
        format!("{normalized_parent}/")
    };
    format!("{}.kerminal-save-{}.tmp", prefix, Uuid::new_v4())
}
