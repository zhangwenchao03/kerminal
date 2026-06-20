//! SFTP 本地归档写入 helper。
//!
//! @author kongweiguang

use std::{
    fs::File as StdFile,
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{
    error::{AppError, AppResult},
    models::sftp::SftpTransferKind,
};

pub(super) fn zip_local_path_to_file(
    source_path: &Path,
    target_zip_path: &Path,
    root_name: &str,
    kind: SftpTransferKind,
    cancel_requested: Arc<AtomicBool>,
) -> AppResult<()> {
    ensure_archive_not_cancelled(&cancel_requested)?;
    if let Some(parent) = target_zip_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }

    let zip_file = StdFile::create(target_zip_path)?;
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
    Ok(())
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
