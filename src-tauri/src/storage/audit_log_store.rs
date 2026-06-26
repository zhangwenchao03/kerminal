//! JSONL audit log storage for non-AI events.
//!
//! @author kongweiguang

use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
};

use serde::{de::DeserializeOwned, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AuditLogStoreError {
    #[error("audit log IO failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("audit log JSON failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid audit log path: {0}")]
    InvalidPath(String),
}

pub type AuditLogStoreResult<T> = Result<T, AuditLogStoreError>;

#[derive(Debug, Clone)]
pub struct AuditLogStore {
    root: PathBuf,
}

impl AuditLogStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn append_jsonl<T: Serialize>(
        &self,
        relative_path: impl AsRef<Path>,
        record: &T,
    ) -> AuditLogStoreResult<PathBuf> {
        let path = resolve_relative_path(&self.root, relative_path.as_ref())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
        file.flush()?;
        Ok(path)
    }

    pub fn read_jsonl<T: DeserializeOwned>(
        &self,
        relative_path: impl AsRef<Path>,
    ) -> AuditLogStoreResult<JsonlRead<T>> {
        let relative_path = relative_path.as_ref();
        let path = resolve_relative_path(&self.root, relative_path)?;
        if !path.exists() {
            return Ok(JsonlRead {
                records: Vec::new(),
                diagnostics: Vec::new(),
            });
        }

        let file = File::open(&path)?;
        let mut records = Vec::new();
        let mut diagnostics = Vec::new();
        for (index, line) in BufReader::new(file).lines().enumerate() {
            let line_number = index + 1;
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<T>(&line) {
                Ok(record) => records.push(record),
                Err(error) => diagnostics.push(JsonlDiagnostic {
                    path: relative_path.to_path_buf(),
                    line_number,
                    message: error.to_string(),
                    raw_line: line,
                }),
            }
        }

        Ok(JsonlRead {
            records,
            diagnostics,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonlRead<T> {
    pub records: Vec<T>,
    pub diagnostics: Vec<JsonlDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonlDiagnostic {
    pub path: PathBuf,
    pub line_number: usize,
    pub message: String,
    pub raw_line: String,
}

fn resolve_relative_path(root: &Path, relative_path: &Path) -> AuditLogStoreResult<PathBuf> {
    let mut clean = PathBuf::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(AuditLogStoreError::InvalidPath(
                    relative_path.display().to_string(),
                ));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err(AuditLogStoreError::InvalidPath("empty path".to_string()));
    }

    Ok(root.join(clean))
}
