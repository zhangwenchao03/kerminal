//! File-backed storage primitives.
//!
//! @author kongweiguang

use std::{
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    io::Write,
    path::{Component, Path, PathBuf},
};

use thiserror::Error;
use uuid::Uuid;

use crate::storage::storage_manifest::{StorageManifest, STORAGE_MANIFEST_SCHEMA_VERSION};

const STORAGE_MANIFEST_RELATIVE_PATH: &str = "storage-manifest.toml";
const FILE_STORE_LOCK_RELATIVE_PATH: &str = ".storage.lock";

#[derive(Debug, Error)]
pub enum FileStoreError {
    #[error("file store IO failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid file store path: {0}")]
    InvalidPath(String),

    #[error("TOML parse failed")]
    TomlParse(#[from] TomlParseError),

    #[error("TOML encode failed: {0}")]
    TomlEncode(String),

    #[error("file store lock is already held: {0}")]
    Locked(PathBuf),

    #[error("file was changed externally: {0}")]
    RevisionConflict(PathBuf),
}

pub type FileStoreResult<T> = Result<T, FileStoreError>;

#[derive(Debug, Clone)]
pub struct FileStore {
    root: PathBuf,
}

impl FileStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path_for(&self, relative_path: impl AsRef<Path>) -> FileStoreResult<PathBuf> {
        Ok(self
            .root
            .join(sanitize_relative_path(relative_path.as_ref())?))
    }

    pub fn read_toml<T: TomlDocument>(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> FileStoreResult<T> {
        let relative_path = relative_path.as_ref();
        let absolute_path = self.path_for(relative_path)?;
        let source = fs::read_to_string(&absolute_path)?;
        T::decode_toml(&source).map_err(|error| error.with_path(relative_path.to_path_buf()).into())
    }

    pub fn write_toml<T: TomlDocument>(
        &self,
        relative_path: impl AsRef<Path>,
        value: &T,
    ) -> FileStoreResult<PathBuf> {
        let encoded = value.encode_toml()?;
        self.atomic_write(relative_path, encoded.as_bytes())
    }

    pub fn read_storage_manifest(&self) -> FileStoreResult<StorageManifest> {
        match self.read_toml::<StorageManifest>(STORAGE_MANIFEST_RELATIVE_PATH) {
            Ok(manifest) => Ok(manifest),
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => {
                Ok(StorageManifest::new())
            }
            Err(error) => Err(error),
        }
    }

    pub fn write_storage_manifest(&self, manifest: &StorageManifest) -> FileStoreResult<PathBuf> {
        self.write_toml(STORAGE_MANIFEST_RELATIVE_PATH, manifest)
    }

    pub fn acquire_lock(&self) -> FileStoreResult<FileStoreLock> {
        let lock_path = self.path_for(FILE_STORE_LOCK_RELATIVE_PATH)?;
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent)?;
        }
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(_) => Ok(FileStoreLock { path: lock_path }),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                Err(FileStoreError::Locked(lock_path))
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn apply_change_set(
        &self,
        id: &str,
        timestamp: &str,
        changes: Vec<FileStoreChange>,
    ) -> FileStoreResult<StorageManifest> {
        validate_change_set_id(id)?;
        if changes.is_empty() {
            return Err(FileStoreError::InvalidPath(
                "change set must include at least one file".to_string(),
            ));
        }

        let _lock = self.acquire_lock()?;
        let mut manifest = self.read_storage_manifest()?;
        let backup_root = change_set_backup_root(id)?;
        let backup_root_text = manifest_path_string(&backup_root);
        let touched_files = changes
            .iter()
            .map(|change| manifest_path_string(&change.relative_path))
            .collect::<Vec<_>>();

        manifest.begin_change_set(id, timestamp, touched_files);
        manifest.set_backup_dir(id, backup_root_text);
        self.write_storage_manifest(&manifest)?;

        let apply_result = (|| -> FileStoreResult<()> {
            for change in &changes {
                self.backup_existing(&change.relative_path, &backup_root)?;
            }
            for change in &changes {
                match &change.contents {
                    Some(contents) => {
                        self.atomic_write(&change.relative_path, contents)?;
                    }
                    None => {
                        self.remove_file(&change.relative_path)?;
                    }
                }
            }
            Ok(())
        })();

        match apply_result {
            Ok(()) => {
                manifest.mark_applied(id, timestamp);
                self.write_storage_manifest(&manifest)?;
                Ok(manifest)
            }
            Err(error) => {
                manifest.mark_failed(id, timestamp, error.to_string());
                let _ = self.write_storage_manifest(&manifest);
                Err(error)
            }
        }
    }

    pub fn restore_change_set(
        &self,
        id: &str,
        timestamp: &str,
    ) -> FileStoreResult<StorageManifest> {
        validate_change_set_id(id)?;
        let _lock = self.acquire_lock()?;
        let mut manifest = self.read_storage_manifest()?;
        let change_set = manifest
            .change_set(id)
            .cloned()
            .ok_or_else(|| FileStoreError::InvalidPath(format!("unknown change set: {id}")))?;
        let backup_dir = change_set.backup_dir.clone().ok_or_else(|| {
            FileStoreError::InvalidPath(format!("change set has no backup dir: {id}"))
        })?;
        let backup_dir = sanitize_relative_path(Path::new(&backup_dir))?;

        let restore_result = (|| -> FileStoreResult<()> {
            for touched_file in &change_set.touched_files {
                let relative_path = sanitize_relative_path(Path::new(touched_file))?;
                let backup_relative_path = backup_dir.join(&relative_path);
                let backup_path = self.path_for(&backup_relative_path)?;

                if backup_path.is_file() {
                    let contents = fs::read(&backup_path)?;
                    self.atomic_write(&relative_path, &contents)?;
                } else if backup_path.exists() {
                    return Err(FileStoreError::InvalidPath(format!(
                        "backup is not a file: {}",
                        backup_relative_path.display()
                    )));
                } else {
                    self.remove_file(&relative_path)?;
                }
            }
            Ok(())
        })();

        match restore_result {
            Ok(()) => {
                manifest.mark_repaired(id, timestamp);
                self.write_storage_manifest(&manifest)?;
                Ok(manifest)
            }
            Err(error) => {
                manifest.mark_failed(id, timestamp, format!("repair failed: {error}"));
                let _ = self.write_storage_manifest(&manifest);
                Err(error)
            }
        }
    }

    pub fn atomic_write(
        &self,
        relative_path: impl AsRef<Path>,
        contents: &[u8],
    ) -> FileStoreResult<PathBuf> {
        let target_path = self.path_for(relative_path)?;
        let parent = target_path.parent().ok_or_else(|| {
            FileStoreError::InvalidPath(format!("missing parent for {}", target_path.display()))
        })?;
        fs::create_dir_all(parent)?;

        let temp_path = temp_path_for(&target_path)?;
        let write_result = write_temp_file(&temp_path, contents)
            .and_then(|()| persist_temp_file(&temp_path, &target_path))
            .and_then(|()| sync_parent_dir(parent));

        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(error.into());
        }

        Ok(target_path)
    }

    pub fn backup_existing(
        &self,
        relative_path: impl AsRef<Path>,
        backup_relative_root: impl AsRef<Path>,
    ) -> FileStoreResult<Option<PathBuf>> {
        let relative_path = relative_path.as_ref();
        let clean_relative_path = sanitize_relative_path(relative_path)?;
        let source_path = self.path_for(&clean_relative_path)?;
        if !source_path.exists() {
            return Ok(None);
        }
        if !source_path.is_file() {
            return Err(FileStoreError::InvalidPath(format!(
                "backup source is not a file: {}",
                relative_path.display()
            )));
        }

        let backup_root = self.path_for(backup_relative_root)?;
        let backup_path = backup_root.join(clean_relative_path);
        let parent = backup_path.parent().ok_or_else(|| {
            FileStoreError::InvalidPath(format!("missing parent for {}", backup_path.display()))
        })?;
        fs::create_dir_all(parent)?;
        fs::copy(&source_path, &backup_path)?;
        sync_parent_dir(parent)?;
        Ok(Some(backup_path))
    }

    pub fn remove_file(&self, relative_path: impl AsRef<Path>) -> FileStoreResult<bool> {
        let relative_path = relative_path.as_ref();
        let target_path = self.path_for(relative_path)?;
        match fs::metadata(&target_path) {
            Ok(metadata) if metadata.is_file() => {
                fs::remove_file(&target_path)?;
                if let Some(parent) = target_path.parent() {
                    sync_parent_dir(parent)?;
                }
                Ok(true)
            }
            Ok(_) => Err(FileStoreError::InvalidPath(format!(
                "restore target is not a file: {}",
                relative_path.display()
            ))),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }
}

#[derive(Debug)]
pub struct FileStoreLock {
    path: PathBuf,
}

impl Drop for FileStoreLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStoreChange {
    relative_path: PathBuf,
    contents: Option<Vec<u8>>,
}

impl FileStoreChange {
    pub fn new(
        relative_path: impl AsRef<Path>,
        contents: impl Into<Vec<u8>>,
    ) -> FileStoreResult<Self> {
        Ok(Self {
            relative_path: sanitize_relative_path(relative_path.as_ref())?,
            contents: Some(contents.into()),
        })
    }

    pub fn delete(relative_path: impl AsRef<Path>) -> FileStoreResult<Self> {
        Ok(Self {
            relative_path: sanitize_relative_path(relative_path.as_ref())?,
            contents: None,
        })
    }

    pub fn relative_path(&self) -> &Path {
        &self.relative_path
    }
}

pub trait TomlDocument: Sized {
    fn encode_toml(&self) -> FileStoreResult<String>;

    fn decode_toml(source: &str) -> Result<Self, TomlParseError>;
}

impl TomlDocument for StorageManifest {
    fn encode_toml(&self) -> FileStoreResult<String> {
        toml::to_string_pretty(self).map_err(|error| FileStoreError::TomlEncode(error.to_string()))
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        let manifest: StorageManifest = toml::from_str(source)
            .map_err(|error| TomlParseError::single(1, 1, error.to_string()))?;
        if manifest.schema_version != STORAGE_MANIFEST_SCHEMA_VERSION {
            return Err(TomlParseError::single(
                1,
                1,
                format!(
                    "unsupported storage manifest schema_version: {}, expected {}",
                    manifest.schema_version, STORAGE_MANIFEST_SCHEMA_VERSION
                ),
            ));
        }
        Ok(manifest)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("TOML parse diagnostics: {diagnostics:?}")]
pub struct TomlParseError {
    diagnostics: Vec<ParseDiagnostic>,
}

impl TomlParseError {
    pub fn new(diagnostics: Vec<ParseDiagnostic>) -> Self {
        Self { diagnostics }
    }

    pub fn single(line: usize, column: usize, message: impl Into<String>) -> Self {
        Self {
            diagnostics: vec![ParseDiagnostic::new(line, column, message)],
        }
    }

    pub fn diagnostics(&self) -> &[ParseDiagnostic] {
        &self.diagnostics
    }

    pub fn with_path(mut self, path: PathBuf) -> Self {
        for diagnostic in &mut self.diagnostics {
            diagnostic.path = Some(path.clone());
        }
        self
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        let key = key.into();
        for diagnostic in &mut self.diagnostics {
            diagnostic.key = Some(key.clone());
        }
        self
    }

    pub fn with_recovery(mut self, recovery: impl Into<String>) -> Self {
        let recovery = recovery.into();
        for diagnostic in &mut self.diagnostics {
            diagnostic.recovery = Some(recovery.clone());
        }
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseDiagnostic {
    pub path: Option<PathBuf>,
    pub line: usize,
    pub column: usize,
    pub key: Option<String>,
    pub message: String,
    pub recovery: Option<String>,
}

impl ParseDiagnostic {
    pub fn new(line: usize, column: usize, message: impl Into<String>) -> Self {
        Self {
            path: None,
            line,
            column,
            key: None,
            message: message.into(),
            recovery: None,
        }
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }

    pub fn with_recovery(mut self, recovery: impl Into<String>) -> Self {
        self.recovery = Some(recovery.into());
        self
    }
}

fn sanitize_relative_path(relative_path: &Path) -> FileStoreResult<PathBuf> {
    let mut clean = PathBuf::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(FileStoreError::InvalidPath(
                    relative_path.display().to_string(),
                ));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err(FileStoreError::InvalidPath("empty path".to_string()));
    }

    Ok(clean)
}

fn validate_change_set_id(id: &str) -> FileStoreResult<()> {
    let id = id.trim();
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.contains('/')
        || id.contains('\\')
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(FileStoreError::InvalidPath(format!(
            "invalid change set id: {id}"
        )));
    }
    Ok(())
}

fn change_set_backup_root(id: &str) -> FileStoreResult<PathBuf> {
    validate_change_set_id(id)?;
    Ok(PathBuf::from("backups").join(id))
}

fn manifest_path_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn temp_path_for(target_path: &Path) -> FileStoreResult<PathBuf> {
    let parent = target_path.parent().ok_or_else(|| {
        FileStoreError::InvalidPath(format!("missing parent for {}", target_path.display()))
    })?;
    let file_name = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| FileStoreError::InvalidPath(target_path.display().to_string()))?;
    Ok(parent.join(format!(
        ".{file_name}.tmp-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    )))
}

fn write_temp_file(temp_path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp_path)?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(not(windows))]
fn persist_temp_file(temp_path: &Path, target_path: &Path) -> std::io::Result<()> {
    fs::rename(temp_path, target_path)
}

#[cfg(windows)]
fn persist_temp_file(temp_path: &Path, target_path: &Path) -> std::io::Result<()> {
    match fs::rename(temp_path, target_path) {
        Ok(()) => Ok(()),
        Err(error) if target_path.exists() => {
            // std::fs::rename does not replace existing files on Windows.
            fs::remove_file(target_path)?;
            fs::rename(temp_path, target_path).map_err(|_| error)
        }
        Err(error) => Err(error),
    }
}

fn sync_parent_dir(parent: &Path) -> std::io::Result<()> {
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}
