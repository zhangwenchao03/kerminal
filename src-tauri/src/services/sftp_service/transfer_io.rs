//! SFTP 会话级传输 I/O helper。
//!
//! @author kongweiguang

use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
};

use russh_sftp::{
    client::{fs::File as SftpFile, SftpSession},
    protocol::{FileType, OpenFlags},
};
use tokio::{
    fs,
    io::{AsyncSeekExt, AsyncWriteExt},
};

use crate::{
    error::{AppError, AppResult},
    models::sftp::SftpTransferConflictPolicy,
};

use super::{
    backend::{io_sftp_error, native_sftp_error, SftpRuntimeSettings},
    is_already_exists_error, is_ambiguous_sftp_failure, is_no_such_file_error,
    transfer_paths::join_remote_path,
    ProgressReader, ProgressWriter, TransferProgress,
};

enum RemoteReadFallback {
    File(String),
    Directory(String),
}

const RELIABLE_PARTIAL_SUFFIX: &str = ".kerminal-part";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ReliableWriteDecision {
    SkipExistingFinal,
    ChooseRenamedFinal,
    Fresh,
    Resume { offset: u64 },
    CommitExistingPartial,
    RestartPartial,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ReliableSizeConfirmation {
    Verified,
    Mismatch { expected: u64, actual: u64 },
}

pub(super) struct PreparedLocalReliableWriteTarget {
    pub(super) final_path: PathBuf,
    pub(super) partial_path: PathBuf,
    pub(super) offset: u64,
    pub(super) file: fs::File,
}

pub(super) struct PreparedRemoteReliableWriteTarget {
    final_path: String,
    partial_path: String,
    offset: u64,
    file: SftpFile,
}

pub(super) fn reliable_partial_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let name = if trimmed.is_empty() { "file" } else { trimmed };
    format!("{name}{RELIABLE_PARTIAL_SUFFIX}")
}

pub(super) fn reliable_remote_partial_path(final_path: &str) -> String {
    let trimmed = final_path.trim().trim_end_matches('/');
    let name = trimmed.rsplit('/').next().unwrap_or("file");
    join_remote_path(
        &remote_parent_path(final_path),
        &reliable_partial_file_name(name),
    )
}

pub(super) fn reliable_local_partial_path(final_path: &Path) -> PathBuf {
    let name = final_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let partial_name = reliable_partial_file_name(name);
    final_path
        .parent()
        .map(|parent| parent.join(&partial_name))
        .unwrap_or_else(|| PathBuf::from(partial_name))
}

pub(super) fn plan_reliable_write(
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
    partial_bytes: Option<u64>,
) -> ReliableWriteDecision {
    if final_exists {
        match conflict_policy {
            SftpTransferConflictPolicy::Skip => return ReliableWriteDecision::SkipExistingFinal,
            SftpTransferConflictPolicy::Rename => {
                return ReliableWriteDecision::ChooseRenamedFinal;
            }
            SftpTransferConflictPolicy::Overwrite => {}
        }
    }

    match partial_bytes {
        None | Some(0) if source_bytes > 0 => ReliableWriteDecision::Fresh,
        None => ReliableWriteDecision::Fresh,
        Some(partial_bytes) if partial_bytes < source_bytes => ReliableWriteDecision::Resume {
            offset: partial_bytes,
        },
        Some(partial_bytes) if partial_bytes == source_bytes => {
            ReliableWriteDecision::CommitExistingPartial
        }
        Some(_) => ReliableWriteDecision::RestartPartial,
    }
}

pub(super) fn confirm_reliable_write_size(expected: u64, actual: u64) -> ReliableSizeConfirmation {
    if expected == actual {
        ReliableSizeConfirmation::Verified
    } else {
        ReliableSizeConfirmation::Mismatch { expected, actual }
    }
}

pub(super) async fn upload_directory(
    sftp: &SftpSession,
    local_path: &Path,
    remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    let total = calculate_local_directory_bytes(local_path).await?;
    progress.set_total_bytes(total);
    let Some(remote_root) =
        prepare_remote_directory_root(sftp, remote_path, conflict_policy).await?
    else {
        progress.add_bytes(total);
        return Ok(());
    };
    let mut stack = vec![(local_path.to_path_buf(), remote_root)];
    while let Some((local_dir, remote_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        if let Err(error) = sftp.create_dir(remote_dir.clone()).await {
            if !remote_create_conflict_confirmed(sftp, &remote_dir, &error, true).await {
                return Err(native_sftp_error(error));
            }
        }
        let mut entries = fs::read_dir(&local_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            progress.ensure_not_cancelled()?;
            let metadata = entry.metadata().await?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let remote_child = join_remote_path(&remote_dir, &name);
            if metadata.is_dir() {
                stack.push((entry.path(), remote_child));
            } else if metadata.is_file() {
                upload_file(
                    sftp,
                    &entry.path(),
                    &remote_child,
                    progress,
                    settings,
                    conflict_policy,
                    false,
                )
                .await?;
            }
        }
    }
    Ok(())
}

pub(super) async fn upload_file(
    sftp: &SftpSession,
    local_path: &Path,
    remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    let metadata = fs::metadata(local_path).await?;
    if set_total {
        progress.set_total_bytes(metadata.len());
    }
    let mut local_file = fs::File::open(local_path).await?;
    let Some(mut remote_target) =
        prepare_remote_reliable_write_target(sftp, remote_path, conflict_policy, metadata.len())
            .await?
    else {
        progress.add_bytes(metadata.len());
        return Ok(());
    };
    if remote_target.offset > 0 {
        local_file
            .seek(SeekFrom::Start(remote_target.offset))
            .await
            .map_err(io_sftp_error)?;
        progress.add_bytes(remote_target.offset);
    }
    let mut reader = ProgressReader::new(&mut local_file, progress.clone());
    remote_target
        .file
        .write_all_pipelined(&mut reader, settings.pipeline_depth)
        .await
        .map_err(native_sftp_error)?;
    remote_target.file.shutdown().await.map_err(io_sftp_error)?;
    commit_remote_reliable_write_target(
        sftp,
        &remote_target.final_path,
        &remote_target.partial_path,
        metadata.len(),
    )
    .await
}

pub(super) async fn download_directory(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    let Some(local_root) = prepare_local_directory_root(local_path, conflict_policy).await? else {
        return Ok(());
    };
    let mut stack = vec![(remote_path.to_owned(), local_root)];
    while let Some((remote_dir, local_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        fs::create_dir_all(&local_dir).await?;
        let entries = sftp
            .read_dir(remote_dir.clone())
            .await
            .map_err(native_sftp_error)?;
        for entry in entries {
            progress.ensure_not_cancelled()?;
            let name = entry.file_name();
            let remote_child = entry.path();
            let local_child = local_dir.join(&name);
            match entry.file_type() {
                FileType::Dir => stack.push((remote_child, local_child)),
                FileType::File | FileType::Symlink => {
                    if let Some(size) = entry.metadata().size {
                        progress.add_total_bytes(size);
                    }
                    download_file(
                        sftp,
                        &remote_child,
                        &local_child,
                        progress,
                        settings,
                        conflict_policy,
                        false,
                    )
                    .await?;
                }
                FileType::Other => {}
            }
        }
    }
    Ok(())
}

pub(super) async fn download_file(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut remote_file = match sftp.open(remote_path).await {
        Ok(remote_file) => remote_file,
        Err(open_error) => {
            let Some(fallback) = resolve_remote_read_fallback(sftp, remote_path).await else {
                return Err(native_sftp_error(open_error));
            };
            match fallback {
                RemoteReadFallback::Directory(directory_path) => {
                    return Box::pin(download_directory(
                        sftp,
                        &directory_path,
                        local_path,
                        progress,
                        settings,
                        conflict_policy,
                    ))
                    .await;
                }
                RemoteReadFallback::File(file_path) => {
                    sftp.open(file_path).await.map_err(native_sftp_error)?
                }
            }
        }
    };
    if set_total {
        if let Ok(metadata) = remote_file.metadata().await {
            progress.set_total_bytes(metadata.size.unwrap_or(0));
        }
    }
    let remote_size = remote_file
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0);
    let Some(mut local_target) =
        prepare_local_reliable_write_target(local_path, conflict_policy, remote_size).await?
    else {
        progress.add_bytes(remote_size);
        return Ok(());
    };
    if local_target.offset > 0 {
        remote_file
            .seek(SeekFrom::Start(local_target.offset))
            .await
            .map_err(io_sftp_error)?;
        progress.add_bytes(local_target.offset);
    }
    {
        let mut writer = ProgressWriter::new(&mut local_target.file, progress.clone());
        remote_file
            .read_to_writer_pipelined(&mut writer, settings.pipeline_depth)
            .await
            .map_err(native_sftp_error)?;
        writer.flush().await.map_err(io_sftp_error)?;
    }
    local_target.file.flush().await.map_err(io_sftp_error)?;
    local_target.file.shutdown().await.map_err(io_sftp_error)?;
    let final_path = local_target.final_path.clone();
    let partial_path = local_target.partial_path.clone();
    drop(local_target.file);
    remote_file.shutdown().await.map_err(io_sftp_error)?;
    commit_local_reliable_write_target(&final_path, &partial_path, remote_size).await
}

async fn resolve_remote_read_fallback(
    sftp: &SftpSession,
    remote_path: &str,
) -> Option<RemoteReadFallback> {
    if let Some(directory_path) = resolve_remote_directory_path(sftp, remote_path).await {
        return Some(RemoteReadFallback::Directory(directory_path));
    }

    let target_path = resolve_remote_link_target_path(sftp, remote_path).await?;
    if let Some(directory_path) = resolve_remote_directory_path(sftp, &target_path).await {
        return Some(RemoteReadFallback::Directory(directory_path));
    }
    Some(RemoteReadFallback::File(target_path))
}

async fn resolve_remote_directory_path(sftp: &SftpSession, remote_path: &str) -> Option<String> {
    if sftp.read_dir(remote_path.to_owned()).await.is_ok() {
        return Some(remote_path.to_owned());
    }

    if let Some(target_path) = resolve_remote_link_target_path(sftp, remote_path).await {
        if sftp.read_dir(target_path.clone()).await.is_ok() {
            return Some(target_path);
        }
    }

    let metadata = sftp.metadata(remote_path.to_owned()).await.ok()?;
    if !metadata.is_dir() {
        return None;
    }

    let canonical_path =
        normalize_remote_fallback_path(&sftp.canonicalize(remote_path).await.ok()?);
    if canonical_path != normalize_remote_fallback_path(remote_path)
        && sftp.read_dir(canonical_path.clone()).await.is_ok()
    {
        return Some(canonical_path);
    }

    None
}

async fn resolve_remote_link_target_path(sftp: &SftpSession, remote_path: &str) -> Option<String> {
    let target = sftp.read_link(remote_path.to_owned()).await.ok()?;
    resolve_remote_link_target(remote_path, &target)
}

fn resolve_remote_link_target(link_path: &str, target: &str) -> Option<String> {
    let target = normalize_remote_fallback_path(target);
    if target.is_empty() {
        return None;
    }
    if target.starts_with('/') {
        return Some(target);
    }
    Some(join_remote_path(&remote_parent_path(link_path), &target))
}

fn remote_parent_path(path: &str) -> String {
    let path = normalize_remote_fallback_path(path);
    let path = path.trim_end_matches('/');
    match path.rfind('/') {
        Some(0) | None => "/".to_owned(),
        Some(index) => path[..index].to_owned(),
    }
}

fn normalize_remote_fallback_path(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

pub(super) async fn copy_remote_directory_between_sessions(
    source_sftp: &SftpSession,
    source_remote_path: &str,
    target_sftp: &SftpSession,
    target_remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<()> {
    let Some(target_root) =
        prepare_remote_directory_root(target_sftp, target_remote_path, conflict_policy).await?
    else {
        return Ok(());
    };
    let mut stack = vec![(source_remote_path.to_owned(), target_root)];
    while let Some((source_dir, target_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        ensure_remote_directory(target_sftp, &target_dir).await?;
        let entries = source_sftp
            .read_dir(source_dir.clone())
            .await
            .map_err(native_sftp_error)?;
        for entry in entries {
            progress.ensure_not_cancelled()?;
            let name = entry.file_name();
            let source_child = entry.path();
            let target_child = join_remote_path(&target_dir, &name);
            match entry.file_type() {
                FileType::Dir => stack.push((source_child, target_child)),
                FileType::File | FileType::Symlink => {
                    if let Some(size) = entry.metadata().size {
                        progress.add_total_bytes(size);
                    }
                    copy_remote_file_between_sessions(
                        source_sftp,
                        &source_child,
                        target_sftp,
                        &target_child,
                        progress,
                        settings,
                        conflict_policy,
                        false,
                    )
                    .await?;
                }
                FileType::Other => {}
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn copy_remote_file_between_sessions(
    source_sftp: &SftpSession,
    source_remote_path: &str,
    target_sftp: &SftpSession,
    target_remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    conflict_policy: SftpTransferConflictPolicy,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    let mut source_file = match source_sftp.open(source_remote_path).await {
        Ok(source_file) => source_file,
        Err(open_error) => {
            let Some(fallback) =
                resolve_remote_read_fallback(source_sftp, source_remote_path).await
            else {
                return Err(native_sftp_error(open_error));
            };
            match fallback {
                RemoteReadFallback::Directory(directory_path) => {
                    return Box::pin(copy_remote_directory_between_sessions(
                        source_sftp,
                        &directory_path,
                        target_sftp,
                        target_remote_path,
                        progress,
                        settings,
                        conflict_policy,
                    ))
                    .await;
                }
                RemoteReadFallback::File(file_path) => source_sftp
                    .open(file_path)
                    .await
                    .map_err(native_sftp_error)?,
            }
        }
    };
    if set_total {
        if let Ok(metadata) = source_file.metadata().await {
            progress.set_total_bytes(metadata.size.unwrap_or(0));
        }
    }
    let source_size = source_file
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0);
    let Some(mut target) = prepare_remote_reliable_write_target(
        target_sftp,
        target_remote_path,
        conflict_policy,
        source_size,
    )
    .await?
    else {
        progress.add_bytes(source_size);
        return Ok(());
    };
    if target.offset > 0 {
        source_file
            .seek(SeekFrom::Start(target.offset))
            .await
            .map_err(io_sftp_error)?;
        progress.add_bytes(target.offset);
    }
    {
        let mut writer = ProgressWriter::new(&mut target.file, progress.clone());
        source_file
            .read_to_writer_pipelined(&mut writer, settings.pipeline_depth)
            .await
            .map_err(native_sftp_error)?;
        writer.flush().await.map_err(io_sftp_error)?;
    }
    target.file.shutdown().await.map_err(io_sftp_error)?;
    source_file.shutdown().await.map_err(io_sftp_error)?;
    commit_remote_reliable_write_target(
        target_sftp,
        &target.final_path,
        &target.partial_path,
        source_size,
    )
    .await
}

async fn ensure_remote_directory(sftp: &SftpSession, remote_path: &str) -> AppResult<()> {
    if let Err(error) = sftp.create_dir(remote_path.to_owned()).await {
        if !remote_create_conflict_confirmed(sftp, remote_path, &error, true).await {
            return Err(native_sftp_error(error));
        }
    }
    Ok(())
}

async fn prepare_remote_directory_root(
    sftp: &SftpSession,
    remote_path: &str,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<String>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            ensure_remote_directory(sftp, remote_path).await?;
            Ok(Some(remote_path.to_owned()))
        }
        SftpTransferConflictPolicy::Skip => match sftp.create_dir(remote_path.to_owned()).await {
            Ok(()) => Ok(Some(remote_path.to_owned())),
            Err(error) => {
                if remote_create_conflict_confirmed(sftp, remote_path, &error, true).await {
                    Ok(None)
                } else {
                    Err(native_sftp_error(error))
                }
            }
        },
        SftpTransferConflictPolicy::Rename => {
            for candidate in remote_conflict_candidates(remote_path).take(1000) {
                match sftp.create_dir(candidate.clone()).await {
                    Ok(()) => return Ok(Some(candidate)),
                    Err(error) => {
                        if remote_create_conflict_confirmed(sftp, &candidate, &error, true).await {
                            continue;
                        }
                        return Err(native_sftp_error(error));
                    }
                }
            }
            Err(AppError::Sftp(format!(
                "无法为远程目标生成不冲突的目录名: {remote_path}"
            )))
        }
    }
}

pub(super) async fn prepare_local_directory_root(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<PathBuf>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            fs::create_dir_all(local_path).await?;
            Ok(Some(local_path.to_path_buf()))
        }
        SftpTransferConflictPolicy::Skip if fs::try_exists(local_path).await? => Ok(None),
        SftpTransferConflictPolicy::Skip => {
            fs::create_dir_all(local_path).await?;
            Ok(Some(local_path.to_path_buf()))
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(local_path).take(1000) {
                match fs::create_dir(&candidate).await {
                    Ok(()) => return Ok(Some(candidate)),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error.into()),
                }
            }
            Err(AppError::Sftp(format!(
                "无法为本地目标生成不冲突的目录名: {}",
                local_path.display()
            )))
        }
    }
}

async fn remote_create_conflict_confirmed(
    sftp: &SftpSession,
    remote_path: &str,
    error: &russh_sftp::client::error::Error,
    require_directory: bool,
) -> bool {
    if is_already_exists_error(error) {
        return true;
    }
    if !is_ambiguous_sftp_failure(error) {
        return false;
    }
    match sftp.metadata(remote_path.to_owned()).await {
        Ok(metadata) => !require_directory || metadata.is_dir(),
        Err(_) => false,
    }
}

async fn remote_path_exists(sftp: &SftpSession, remote_path: &str) -> AppResult<bool> {
    match sftp.metadata(remote_path.to_owned()).await {
        Ok(_) => Ok(true),
        Err(error) if is_no_such_file_error(&error) => Ok(false),
        Err(error) => Err(native_sftp_error(error)),
    }
}

async fn prepare_remote_reliable_write_target(
    sftp: &SftpSession,
    remote_path: &str,
    conflict_policy: SftpTransferConflictPolicy,
    source_bytes: u64,
) -> AppResult<Option<PreparedRemoteReliableWriteTarget>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            prepare_selected_remote_reliable_write_target(
                sftp,
                remote_path,
                conflict_policy,
                remote_path_exists(sftp, remote_path).await?,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Skip if remote_path_exists(sftp, remote_path).await? => {
            Ok(None)
        }
        SftpTransferConflictPolicy::Skip => {
            prepare_selected_remote_reliable_write_target(
                sftp,
                remote_path,
                conflict_policy,
                false,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in remote_conflict_candidates(remote_path).take(1000) {
                if remote_path_exists(sftp, &candidate).await? {
                    continue;
                }
                return prepare_selected_remote_reliable_write_target(
                    sftp,
                    &candidate,
                    conflict_policy,
                    false,
                    source_bytes,
                )
                .await;
            }
            Err(AppError::Sftp(format!(
                "无法为远程目标生成不冲突的文件名: {remote_path}"
            )))
        }
    }
}

async fn prepare_selected_remote_reliable_write_target(
    sftp: &SftpSession,
    final_path: &str,
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
) -> AppResult<Option<PreparedRemoteReliableWriteTarget>> {
    let partial_path = reliable_remote_partial_path(final_path);
    let partial_bytes = remote_partial_bytes(sftp, &partial_path).await?;
    match plan_reliable_write(conflict_policy, final_exists, source_bytes, partial_bytes) {
        ReliableWriteDecision::SkipExistingFinal => Ok(None),
        ReliableWriteDecision::ChooseRenamedFinal => Err(AppError::Sftp(format!(
            "无法为远程目标生成不冲突的文件名: {final_path}"
        ))),
        ReliableWriteDecision::Fresh | ReliableWriteDecision::RestartPartial => {
            open_remote_reliable_partial_target(sftp, final_path, partial_path, 0, true)
                .await
                .map(Some)
        }
        ReliableWriteDecision::Resume { offset } => {
            open_remote_reliable_partial_target(sftp, final_path, partial_path, offset, false)
                .await
                .map(Some)
        }
        ReliableWriteDecision::CommitExistingPartial => {
            open_remote_reliable_partial_target(sftp, final_path, partial_path, source_bytes, false)
                .await
                .map(Some)
        }
    }
}

async fn remote_partial_bytes(sftp: &SftpSession, partial_path: &str) -> AppResult<Option<u64>> {
    match sftp.metadata(partial_path.to_owned()).await {
        Ok(metadata) => Ok(metadata.size),
        Err(error) if is_no_such_file_error(&error) => Ok(None),
        Err(error) => Err(native_sftp_error(error)),
    }
}

async fn open_remote_reliable_partial_target(
    sftp: &SftpSession,
    final_path: &str,
    partial_path: String,
    offset: u64,
    truncate: bool,
) -> AppResult<PreparedRemoteReliableWriteTarget> {
    let flags = if truncate {
        OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
    } else {
        OpenFlags::CREATE | OpenFlags::WRITE
    };
    let mut file = sftp
        .open_with_flags(partial_path.clone(), flags)
        .await
        .map_err(native_sftp_error)?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .await
            .map_err(io_sftp_error)?;
    }
    Ok(PreparedRemoteReliableWriteTarget {
        final_path: final_path.to_owned(),
        partial_path,
        offset,
        file,
    })
}

async fn commit_remote_reliable_write_target(
    sftp: &SftpSession,
    final_path: &str,
    partial_path: &str,
    expected_bytes: u64,
) -> AppResult<()> {
    let actual_bytes = sftp
        .metadata(partial_path.to_owned())
        .await
        .map_err(native_sftp_error)?
        .size
        .unwrap_or(0);
    match confirm_reliable_write_size(expected_bytes, actual_bytes) {
        ReliableSizeConfirmation::Verified => {}
        ReliableSizeConfirmation::Mismatch { expected, actual } => {
            return Err(AppError::Sftp(format!(
                "可靠上传 size 确认失败: expected {expected} bytes, got {actual} bytes"
            )));
        }
    }

    match sftp
        .rename(partial_path.to_owned(), final_path.to_owned())
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if remote_create_conflict_confirmed(sftp, final_path, &error, false).await => {
            sftp.remove_file(final_path.to_owned())
                .await
                .map_err(native_sftp_error)?;
            sftp.rename(partial_path.to_owned(), final_path.to_owned())
                .await
                .map_err(native_sftp_error)
        }
        Err(error) => Err(native_sftp_error(error)),
    }
}

pub(super) async fn prepare_local_reliable_write_target(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    source_bytes: u64,
) -> AppResult<Option<PreparedLocalReliableWriteTarget>> {
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            prepare_selected_local_reliable_write_target(
                local_path,
                conflict_policy,
                fs::try_exists(local_path).await?,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Skip if fs::try_exists(local_path).await? => Ok(None),
        SftpTransferConflictPolicy::Skip => {
            prepare_selected_local_reliable_write_target(
                local_path,
                conflict_policy,
                false,
                source_bytes,
            )
            .await
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(local_path).take(1000) {
                if fs::try_exists(&candidate).await? {
                    continue;
                }
                return prepare_selected_local_reliable_write_target(
                    &candidate,
                    conflict_policy,
                    false,
                    source_bytes,
                )
                .await;
            }
            Err(AppError::Sftp(format!(
                "无法为本地目标生成不冲突的文件名: {}",
                local_path.display()
            )))
        }
    }
}

async fn prepare_selected_local_reliable_write_target(
    final_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    final_exists: bool,
    source_bytes: u64,
) -> AppResult<Option<PreparedLocalReliableWriteTarget>> {
    let partial_path = reliable_local_partial_path(final_path);
    let partial_bytes = local_partial_bytes(&partial_path).await?;
    match plan_reliable_write(conflict_policy, final_exists, source_bytes, partial_bytes) {
        ReliableWriteDecision::SkipExistingFinal => Ok(None),
        ReliableWriteDecision::ChooseRenamedFinal => Err(AppError::Sftp(format!(
            "无法为本地目标生成不冲突的文件名: {}",
            final_path.display()
        ))),
        ReliableWriteDecision::Fresh | ReliableWriteDecision::RestartPartial => {
            open_local_reliable_partial_target(final_path, partial_path, 0, true)
                .await
                .map(Some)
        }
        ReliableWriteDecision::Resume { offset } => {
            open_local_reliable_partial_target(final_path, partial_path, offset, false)
                .await
                .map(Some)
        }
        ReliableWriteDecision::CommitExistingPartial => {
            open_local_reliable_partial_target(final_path, partial_path, source_bytes, false)
                .await
                .map(Some)
        }
    }
}

async fn local_partial_bytes(partial_path: &Path) -> AppResult<Option<u64>> {
    match fs::metadata(partial_path).await {
        Ok(metadata) => Ok(Some(metadata.len())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

async fn open_local_reliable_partial_target(
    final_path: &Path,
    partial_path: PathBuf,
    offset: u64,
    truncate: bool,
) -> AppResult<PreparedLocalReliableWriteTarget> {
    if let Some(parent) = partial_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(truncate)
        .open(&partial_path)
        .await?;
    if offset > 0 {
        file.seek(SeekFrom::Start(offset)).await?;
    }
    Ok(PreparedLocalReliableWriteTarget {
        final_path: final_path.to_path_buf(),
        partial_path,
        offset,
        file,
    })
}

pub(super) async fn commit_local_reliable_write_target(
    final_path: &Path,
    partial_path: &Path,
    expected_bytes: u64,
) -> AppResult<()> {
    let actual_bytes = fs::metadata(partial_path).await?.len();
    match confirm_reliable_write_size(expected_bytes, actual_bytes) {
        ReliableSizeConfirmation::Verified => {}
        ReliableSizeConfirmation::Mismatch { expected, actual } => {
            return Err(AppError::Sftp(format!(
                "可靠下载 size 确认失败: expected {expected} bytes, got {actual} bytes"
            )));
        }
    }

    match fs::rename(partial_path, final_path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            fs::remove_file(final_path).await?;
            fs::rename(partial_path, final_path).await?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

pub(super) async fn open_local_write_target(
    local_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
    skipped_bytes: u64,
) -> AppResult<Option<fs::File>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => fs::File::create(local_path)
            .await
            .map(Some)
            .map_err(Into::into),
        SftpTransferConflictPolicy::Skip => {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(local_path)
                .await
            {
                Ok(file) => Ok(Some(file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let _ = skipped_bytes;
                    Ok(None)
                }
                Err(error) => Err(error.into()),
            }
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(local_path).take(1000) {
                match fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(candidate)
                    .await
                {
                    Ok(file) => return Ok(Some(file)),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error.into()),
                }
            }
            Err(AppError::Sftp(format!(
                "无法为本地目标生成不冲突的文件名: {}",
                local_path.display()
            )))
        }
    }
}

fn remote_conflict_candidates(remote_path: &str) -> impl Iterator<Item = String> + '_ {
    std::iter::once(remote_path.to_owned()).chain((1..).map(move |index| {
        let parent = remote_parent_path(remote_path);
        let name = remote_path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(remote_path);
        join_remote_path(&parent, &numbered_candidate_name(name, index))
    }))
}

fn local_conflict_candidates(local_path: &Path) -> impl Iterator<Item = PathBuf> + '_ {
    std::iter::once(local_path.to_path_buf()).chain((1..).map(move |index| {
        let name = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file");
        let candidate_name = numbered_candidate_name(name, index);
        local_path
            .parent()
            .map(|parent| parent.join(&candidate_name))
            .unwrap_or_else(|| PathBuf::from(candidate_name))
    }))
}

pub(super) fn numbered_candidate_name(name: &str, index: usize) -> String {
    let trimmed = name.trim();
    let name = if trimmed.is_empty() { "file" } else { trimmed };
    let Some(dot_index) = name.rfind('.') else {
        return format!("{name} ({index})");
    };
    if dot_index == 0 {
        return format!("{name} ({index})");
    }
    let (stem, extension) = name.split_at(dot_index);
    format!("{stem} ({index}){extension}")
}

async fn calculate_local_directory_bytes(path: &Path) -> AppResult<u64> {
    let mut total = 0_u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries = fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let metadata = entry.metadata().await?;
            if metadata.is_dir() {
                stack.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    Ok(total)
}
