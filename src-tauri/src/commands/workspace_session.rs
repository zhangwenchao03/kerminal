//! Workspace session file-backed Tauri Commands。
//!
//! @author kongweiguang

use std::{fs, io::ErrorKind, path::Path};

use serde_json::Value;
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
    storage::file_store::{FileStore, FileStoreError},
};

const WORKSPACE_SESSION_RELATIVE_PATH: &str = "workspace/session.json";

#[tauri::command]
pub fn workspace_session_load(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    load_workspace_session(state.paths().root.as_path()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_session_save(state: State<'_, AppState>, session: Value) -> Result<(), String> {
    save_workspace_session(state.paths().root.as_path(), session).map_err(|error| error.to_string())
}

fn load_workspace_session(root: &Path) -> AppResult<Option<Value>> {
    let store = FileStore::new(root);
    let path = store
        .path_for(WORKSPACE_SESSION_RELATIVE_PATH)
        .map_err(file_store_error)?;
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::Io(error)),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if value.is_object() {
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn save_workspace_session(root: &Path, session: Value) -> AppResult<()> {
    if !session.is_object() {
        return Err(AppError::InvalidInput(
            "workspace session 必须是 JSON object".to_owned(),
        ));
    }
    let mut bytes = serde_json::to_vec_pretty(&session)?;
    bytes.push(b'\n');
    FileStore::new(root)
        .atomic_write(WORKSPACE_SESSION_RELATIVE_PATH, &bytes)
        .map(|_| ())
        .map_err(file_store_error)
}

fn file_store_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
