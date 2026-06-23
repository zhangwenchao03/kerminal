//! SFTP 本地归档写入 helper。
//!
//! @author kongweiguang

use std::{
    fs::{File as StdFile, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{
    error::{AppError, AppResult},
    models::sftp::{SftpTransferConflictPolicy, SftpTransferKind},
};

pub(super) fn zip_local_path_to_file(
    source_path: &Path,
    target_zip_path: &Path,
    root_name: &str,
    kind: SftpTransferKind,
    cancel_requested: Arc<AtomicBool>,
) -> AppResult<()> {
    zip_local_path_to_file_with_conflict(
        source_path,
        target_zip_path,
        root_name,
        kind,
        cancel_requested,
        SftpTransferConflictPolicy::Overwrite,
    )?;
    Ok(())
}

pub(super) fn zip_local_path_to_file_with_conflict(
    source_path: &Path,
    target_zip_path: &Path,
    root_name: &str,
    kind: SftpTransferKind,
    cancel_requested: Arc<AtomicBool>,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<PathBuf>> {
    ensure_archive_not_cancelled(&cancel_requested)?;
    if let Some(parent) = target_zip_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    let Some((zip_file, resolved_target)) = open_zip_target_file(target_zip_path, conflict_policy)?
    else {
        return Ok(None);
    };
    let mut zip = ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let root_name = zip_safe_entry_name(
        root_name,
        match kind {
            SftpTransferKind::File => "remote-file",
            SftpTransferKind::Directory => "remote-directory",
        },
    );

    match kind {
        SftpTransferKind::File => {
            add_file_to_zip(
                &mut zip,
                source_path,
                &root_name,
                options,
                &cancel_requested,
            )?;
        }
        SftpTransferKind::Directory => {
            add_directory_to_zip(
                &mut zip,
                source_path,
                &root_name,
                options,
                &cancel_requested,
            )?;
        }
    }

    zip.finish()
        .map_err(|error| AppError::Sftp(format!("ZIP 归档写入失败: {error}")))?;
    Ok(Some(resolved_target))
}

fn open_zip_target_file(
    target_zip_path: &Path,
    conflict_policy: SftpTransferConflictPolicy,
) -> AppResult<Option<(StdFile, PathBuf)>> {
    match conflict_policy {
        SftpTransferConflictPolicy::Overwrite => {
            let file = StdFile::create(target_zip_path)?;
            Ok(Some((file, target_zip_path.to_path_buf())))
        }
        SftpTransferConflictPolicy::Skip => {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target_zip_path)
            {
                Ok(file) => Ok(Some((file, target_zip_path.to_path_buf()))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
                Err(error) => Err(error.into()),
            }
        }
        SftpTransferConflictPolicy::Rename => {
            for candidate in local_conflict_candidates(target_zip_path).take(1000) {
                match OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&candidate)
                {
                    Ok(file) => return Ok(Some((file, candidate))),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => return Err(error.into()),
                }
            }
            Err(AppError::Sftp(format!(
                "无法为本地 ZIP 目标生成不冲突的文件名: {}",
                target_zip_path.display()
            )))
        }
    }
}

fn local_conflict_candidates(local_path: &Path) -> impl Iterator<Item = PathBuf> + '_ {
    std::iter::once(local_path.to_path_buf()).chain((1..).map(move |index| {
        let name = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("archive.zip");
        let candidate_name = numbered_candidate_name(name, index);
        local_path
            .parent()
            .map(|parent| parent.join(&candidate_name))
            .unwrap_or_else(|| PathBuf::from(candidate_name))
    }))
}

fn numbered_candidate_name(name: &str, index: usize) -> String {
    let trimmed = name.trim();
    let name = if trimmed.is_empty() {
        "archive.zip"
    } else {
        trimmed
    };
    let Some(dot_index) = name.rfind('.') else {
        return format!("{name} ({index})");
    };
    if dot_index == 0 {
        return format!("{name} ({index})");
    }
    let (stem, extension) = name.split_at(dot_index);
    format!("{stem} ({index}){extension}")
}

fn add_directory_to_zip(
    zip: &mut ZipWriter<StdFile>,
    source_dir: &Path,
    root_name: &str,
    options: SimpleFileOptions,
    cancel_requested: &Arc<AtomicBool>,
) -> AppResult<()> {
    ensure_archive_not_cancelled(cancel_requested)?;
    if !source_dir.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "归档源不是目录: {}",
            source_dir.display()
        )));
    }

    zip.add_directory(format!("{root_name}/"), options)
        .map_err(|error| AppError::Sftp(format!("ZIP 目录写入失败: {error}")))?;
    let mut stack = vec![(source_dir.to_path_buf(), root_name.to_owned())];
    while let Some((directory, zip_directory)) = stack.pop() {
        ensure_archive_not_cancelled(cancel_requested)?;
        for entry in std::fs::read_dir(&directory)? {
            ensure_archive_not_cancelled(cancel_requested)?;
            let entry = entry?;
            let path = entry.path();
            let metadata = entry.metadata()?;
            let name = zip_safe_entry_name(&entry.file_name().to_string_lossy(), "item");
            let zip_path = format!("{zip_directory}/{name}");
            if metadata.is_dir() {
                zip.add_directory(format!("{zip_path}/"), options)
                    .map_err(|error| AppError::Sftp(format!("ZIP 目录写入失败: {error}")))?;
                stack.push((path, zip_path));
            } else if metadata.is_file() {
                add_file_to_zip(zip, &path, &zip_path, options, cancel_requested)?;
            }
        }
    }
    Ok(())
}

fn add_file_to_zip(
    zip: &mut ZipWriter<StdFile>,
    source_file: &Path,
    zip_path: &str,
    options: SimpleFileOptions,
    cancel_requested: &Arc<AtomicBool>,
) -> AppResult<()> {
    ensure_archive_not_cancelled(cancel_requested)?;
    if !source_file.is_file() {
        return Err(AppError::InvalidInput(format!(
            "归档源不是文件: {}",
            source_file.display()
        )));
    }

    zip.start_file(zip_path, options)
        .map_err(|error| AppError::Sftp(format!("ZIP 文件写入失败: {error}")))?;
    let mut input = StdFile::open(source_file)?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_archive_not_cancelled(cancel_requested)?;
        let bytes = input.read(&mut buffer)?;
        if bytes == 0 {
            break;
        }
        zip.write_all(&buffer[..bytes])?;
    }
    Ok(())
}

pub(super) fn zip_safe_entry_name(name: &str, fallback: &str) -> String {
    let cleaned = name
        .replace('\\', "/")
        .split('/')
        .filter(|segment| {
            let trimmed = segment.trim();
            !trimmed.is_empty() && trimmed != "." && trimmed != ".."
        })
        .collect::<Vec<_>>()
        .join("_");
    if cleaned.is_empty() {
        fallback.to_owned()
    } else {
        cleaned
    }
}

fn ensure_archive_not_cancelled(cancel_requested: &Arc<AtomicBool>) -> AppResult<()> {
    if cancel_requested.load(Ordering::SeqCst) {
        return Err(AppError::Sftp("传输已取消".to_owned()));
    }
    Ok(())
}
