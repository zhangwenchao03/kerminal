//! Workspace sync and vault bootstrap commands.
//!
//! @author kongweiguang

use tauri::State;

use serde::Deserialize;

use crate::{
    services::{
        encrypted_vault_service::VaultKeyOperationResult,
        workspace_sync_service::{WorkspaceSyncRunResult, WorkspaceSyncStatus},
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSyncImportKeyRequest {
    pub key_toml: String,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSyncSaveKeyRequest {
    pub key_toml: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSyncRotateKeyRequest {
    #[serde(default)]
    pub dry_run: bool,
}

#[tauri::command]
pub fn workspace_sync_run(state: State<'_, AppState>) -> Result<WorkspaceSyncRunResult, String> {
    state
        .workspace_sync()
        .run_sync()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_status(state: State<'_, AppState>) -> Result<WorkspaceSyncStatus, String> {
    state
        .workspace_sync()
        .status()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_ensure(state: State<'_, AppState>) -> Result<WorkspaceSyncStatus, String> {
    state
        .workspace_sync()
        .ensure_bootstrap()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_read_key(state: State<'_, AppState>) -> Result<String, String> {
    state
        .workspace_sync()
        .read_vault_key_toml()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_save_key(
    state: State<'_, AppState>,
    request: WorkspaceSyncSaveKeyRequest,
) -> Result<VaultKeyOperationResult, String> {
    state
        .workspace_sync()
        .save_vault_key_toml(&request.key_toml)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_export_key(state: State<'_, AppState>) -> Result<String, String> {
    state
        .workspace_sync()
        .export_vault_key_toml()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_import_key(
    state: State<'_, AppState>,
    request: WorkspaceSyncImportKeyRequest,
) -> Result<VaultKeyOperationResult, String> {
    state
        .workspace_sync()
        .import_vault_key_toml(&request.key_toml, request.dry_run)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_sync_rotate_key(
    state: State<'_, AppState>,
    request: WorkspaceSyncRotateKeyRequest,
) -> Result<VaultKeyOperationResult, String> {
    state
        .workspace_sync()
        .rotate_vault_key(request.dry_run)
        .map_err(|error| error.to_string())
}
