//! 诊断包 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::config_change::ConfigWatchStatusSnapshot,
    models::diagnostics::{DiagnosticBundle, RuntimeHealthSnapshot},
    services::diagnostics_service::{DiagnosticBundleSnapshot, DiagnosticsService},
    state::AppState,
};
use tauri::State;

/// 生成本地脱敏诊断包。
#[tauri::command]
pub async fn diagnostics_create_bundle(
    state: State<'_, AppState>,
) -> Result<DiagnosticBundle, String> {
    let paths = state.paths().clone();
    let snapshot = DiagnosticBundleSnapshot {
        command_database_file: state.command_store().database_file().to_path_buf(),
        command_schema_version: state
            .command_store()
            .schema_version()
            .map_err(|error| error.to_string())?,
        sessions: state
            .terminals()
            .list_sessions()
            .map_err(|error| error.to_string())?,
        settings: state
            .settings()
            .load_settings()
            .map_err(|error| error.to_string())?,
    };

    tauri::async_runtime::spawn_blocking(move || {
        DiagnosticsService::new().create_bundle_from_snapshot(&paths, snapshot)
    })
    .await
    .map_err(|error| format!("诊断包生成任务失败: {error}"))?
    .map_err(|error| error.to_string())
}

/// 采集当前应用和本机资源运行体检。
#[tauri::command]
pub async fn diagnostics_runtime_health(
    state: State<'_, AppState>,
) -> Result<RuntimeHealthSnapshot, String> {
    let paths = state.paths().clone();
    let command_database_file = state.command_store().database_file().to_path_buf();

    tauri::async_runtime::spawn_blocking(move || {
        DiagnosticsService::new()
            .runtime_health_for_command_database_file(&paths, &command_database_file)
    })
    .await
    .map_err(|error| format!("运行体检采集任务失败: {error}"))?
    .map_err(|error| error.to_string())
}

/// 查询文件型配置 watcher 状态。
#[tauri::command]
pub async fn config_watch_status(
    state: State<'_, AppState>,
) -> Result<ConfigWatchStatusSnapshot, String> {
    Ok(state.config_change_observer().status())
}
