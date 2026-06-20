//! SFTP 会话级传输 I/O helper。
//!
//! @author kongweiguang

use std::path::Path;

use russh_sftp::{
    client::SftpSession,
    protocol::{FileType, OpenFlags},
};
use tokio::{fs, io::AsyncWriteExt};

use crate::error::AppResult;

use super::{
    backend::{io_sftp_error, native_sftp_error, SftpRuntimeSettings},
    is_already_exists_error,
    transfer_paths::join_remote_path,
    ProgressReader, ProgressWriter, TransferProgress,
};

pub(super) async fn upload_directory(
    sftp: &SftpSession,
    local_path: &Path,
    remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    let total = calculate_local_directory_bytes(local_path).await?;
    progress.set_total_bytes(total);
    let mut stack = vec![(local_path.to_path_buf(), remote_path.to_owned())];
    while let Some((local_dir, remote_dir)) = stack.pop() {
        progress.ensure_not_cancelled()?;
        if let Err(error) = sftp.create_dir(remote_dir.clone()).await {
            if !is_already_exists_error(&error) {
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
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    let metadata = fs::metadata(local_path).await?;
    if set_total {
        progress.set_total_bytes(metadata.len());
    }
    let mut local_file = fs::File::open(local_path).await?;
    let mut reader = ProgressReader::new(&mut local_file, progress.clone());
    let mut remote_file = sftp
        .open_with_flags(
            remote_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(native_sftp_error)?;
    remote_file
        .write_all_pipelined(&mut reader, settings.pipeline_depth)
        .await
        .map_err(native_sftp_error)?;
    remote_file.shutdown().await.map_err(io_sftp_error)
}

pub(super) async fn download_directory(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    fs::create_dir_all(local_path).await?;
    let mut stack = vec![(remote_path.to_owned(), local_path.to_path_buf())];
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
                    download_file(sftp, &remote_child, &local_child, progress, settings, false)
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
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut remote_file = sftp.open(remote_path).await.map_err(native_sftp_error)?;
    if set_total {
        if let Ok(metadata) = remote_file.metadata().await {
            progress.set_total_bytes(metadata.size.unwrap_or(0));
        }
    }
    let mut local_file = fs::File::create(local_path).await?;
    let mut writer = ProgressWriter::new(&mut local_file, progress.clone());
    remote_file
        .read_to_writer_pipelined(&mut writer, settings.pipeline_depth)
        .await
        .map_err(native_sftp_error)?;
    writer.flush().await.map_err(io_sftp_error)?;
    remote_file.shutdown().await.map_err(io_sftp_error)
}

pub(super) async fn copy_remote_directory_between_sessions(
    source_sftp: &SftpSession,
    source_remote_path: &str,
    target_sftp: &SftpSession,
    target_remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
) -> AppResult<()> {
    ensure_remote_directory(target_sftp, target_remote_path).await?;
    let mut stack = vec![(source_remote_path.to_owned(), target_remote_path.to_owned())];
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

pub(super) async fn copy_remote_file_between_sessions(
    source_sftp: &SftpSession,
    source_remote_path: &str,
    target_sftp: &SftpSession,
    target_remote_path: &str,
    progress: &TransferProgress,
    settings: SftpRuntimeSettings,
    set_total: bool,
) -> AppResult<()> {
    progress.ensure_not_cancelled()?;
    let mut source_file = source_sftp
        .open(source_remote_path)
        .await
        .map_err(native_sftp_error)?;
    if set_total {
        if let Ok(metadata) = source_file.metadata().await {
            progress.set_total_bytes(metadata.size.unwrap_or(0));
        }
    }
    let mut target_file = target_sftp
        .open_with_flags(
            target_remote_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(native_sftp_error)?;
    {
        let mut writer = ProgressWriter::new(&mut target_file, progress.clone());
        source_file
            .read_to_writer_pipelined(&mut writer, settings.pipeline_depth)
            .await
            .map_err(native_sftp_error)?;
        writer.flush().await.map_err(io_sftp_error)?;
    }
    target_file.shutdown().await.map_err(io_sftp_error)?;
    source_file.shutdown().await.map_err(io_sftp_error)
}

async fn ensure_remote_directory(sftp: &SftpSession, remote_path: &str) -> AppResult<()> {
    if let Err(error) = sftp.create_dir(remote_path.to_owned()).await {
        if !is_already_exists_error(&error) {
            return Err(native_sftp_error(error));
        }
    }
    Ok(())
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
