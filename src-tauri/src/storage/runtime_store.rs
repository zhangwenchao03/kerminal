//! Runtime file-backed store facade.
//!
//! @author kongweiguang

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
};

/// Kerminal runtime file store entry.
#[derive(Debug)]
pub struct RuntimeFileStore {
    file_io: Mutex<()>,
    root: PathBuf,
}

impl RuntimeFileStore {
    /// Initializes runtime file storage directories.
    pub fn open(paths: &KerminalPaths) -> AppResult<Self> {
        paths.ensure_directories()?;

        Ok(Self {
            file_io: Mutex::new(()),
            root: paths.root.clone(),
        })
    }

    pub(crate) fn with_file_io<T>(
        &self,
        operation: impl FnOnce(&Path) -> AppResult<T>,
    ) -> AppResult<T> {
        let _guard = self
            .file_io
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("runtime file store"))?;

        operation(&self.root)
    }
}
