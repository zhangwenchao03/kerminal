//! SSH identity materialization and temporary-file lifecycle.

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{Duration, SystemTime},
};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    services::{
        ssh_credential_resolver::ResolvedSshAuthMaterial,
        ssh_identity_file::resolve_identity_file_path,
    },
};

const SSH_TERMINAL_KEY_DIR_NAME: &str = "ssh-terminal-keys";
const SSH_TERMINAL_IDENTITY_PREFIX: &str = "identity-";
const SSH_TERMINAL_IDENTITY_SUFFIX: &str = ".key";
const SSH_TERMINAL_STALE_IDENTITY_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Default)]
pub(super) struct ResolvedSshIdentity {
    pub(super) args: Vec<String>,
    pub(super) cleanup_paths: Vec<PathBuf>,
}
pub(super) fn resolve_identity(
    material: &ResolvedSshAuthMaterial,
    paths: &KerminalPaths,
) -> AppResult<ResolvedSshIdentity> {
    match material {
        ResolvedSshAuthMaterial::PrivateKeyPem { content, .. } => {
            let private_key = normalize_private_key_content(content.to_owned())?;
            let path = write_temporary_identity_file(paths, &private_key)?;
            Ok(identity_file_args(path, true))
        }
        ResolvedSshAuthMaterial::PrivateKeyPath { path, .. } => {
            let credential_ref = path.to_string_lossy();
            if credential_ref.trim().starts_with("credential:") {
                return Err(AppError::InvalidInput(
                    "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                        .to_owned(),
                ));
            }
            Ok(identity_file_args(
                resolve_identity_file_path(&credential_ref)?,
                false,
            ))
        }
        ResolvedSshAuthMaterial::Agent { .. }
        | ResolvedSshAuthMaterial::Password { .. }
        | ResolvedSshAuthMaterial::PromptOnly { .. } => Ok(ResolvedSshIdentity::default()),
    }
}

fn identity_file_args(path: PathBuf, cleanup: bool) -> ResolvedSshIdentity {
    let cleanup_paths = if cleanup {
        vec![path.clone()]
    } else {
        Vec::new()
    };
    ResolvedSshIdentity {
        args: vec![
            "-i".to_owned(),
            display_path_arg(&path),
            "-o".to_owned(),
            "IdentitiesOnly=yes".to_owned(),
        ],
        cleanup_paths,
    }
}

fn display_path_arg(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

fn normalize_private_key_content(private_key: String) -> AppResult<String> {
    let trimmed = private_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Credential("SSH 私钥凭据内容为空".to_owned()));
    }

    let mut normalized = trimmed.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.ends_with('\n') {
        normalized.push('\n');
    }
    Ok(normalized)
}

fn write_temporary_identity_file(paths: &KerminalPaths, private_key: &str) -> AppResult<PathBuf> {
    cleanup_stale_temporary_identity_files(paths)?;

    let directory = temporary_identity_directory(paths);
    fs::create_dir_all(&directory)?;
    let path = directory.join(format!("identity-{}.key", Uuid::new_v4()));

    let write_result: AppResult<()> = (|| {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            options.mode(0o600);
        }

        let mut file = options.open(&path)?;
        file.write_all(private_key.as_bytes())?;
        file.flush()?;

        #[cfg(unix)]
        {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&path);
    }
    write_result?;

    Ok(path)
}

fn cleanup_stale_temporary_identity_files(paths: &KerminalPaths) -> AppResult<usize> {
    cleanup_temporary_identity_files(paths, Some(SSH_TERMINAL_STALE_IDENTITY_MAX_AGE))
}

pub(super) fn cleanup_temporary_identity_files(
    paths: &KerminalPaths,
    max_age: Option<Duration>,
) -> AppResult<usize> {
    let directory = temporary_identity_directory(paths);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };

    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() || !is_managed_identity_file_name(&entry.file_name()) {
            continue;
        }

        if let Some(max_age) = max_age {
            let metadata = entry.metadata()?;
            if !identity_file_is_stale(&metadata, max_age) {
                continue;
            }
        }

        fs::remove_file(entry.path())?;
        removed += 1;
    }

    Ok(removed)
}

pub(super) fn temporary_identity_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(SSH_TERMINAL_KEY_DIR_NAME)
}

fn is_managed_identity_file_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|name| {
        name.starts_with(SSH_TERMINAL_IDENTITY_PREFIX)
            && name.ends_with(SSH_TERMINAL_IDENTITY_SUFFIX)
    })
}

fn identity_file_is_stale(metadata: &fs::Metadata, max_age: Duration) -> bool {
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default()
        >= max_age
}
