//! 命令建议 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::command_suggestion::{
        CommandSuggestionAuditRecordRequest, CommandSuggestionAuditRecordResult,
        CommandSuggestionCandidate, CommandSuggestionDiagnosticsCleanupRequest,
        CommandSuggestionDiagnosticsCleanupResult, CommandSuggestionFeedbackRecordRequest,
        CommandSuggestionFeedbackRecordResult, CommandSuggestionGitRefreshRequest,
        CommandSuggestionGitRefreshResult, CommandSuggestionRemoteCommandRefreshRequest,
        CommandSuggestionRemoteCommandRefreshResult, CommandSuggestionRemoteHistoryRefreshRequest,
        CommandSuggestionRemoteHistoryRefreshResult, CommandSuggestionRemotePathRefreshRequest,
        CommandSuggestionRemotePathRefreshResult, CommandSuggestionRequest,
        CommandSuggestionTelemetryExport, CommandSuggestionTelemetrySummary,
    },
    state::AppState,
};
use tauri::State;

/// 搜索当前终端输入的命令建议。
#[tauri::command]
pub fn command_suggestion_list(
    state: State<'_, AppState>,
    request: CommandSuggestionRequest,
) -> Result<Vec<CommandSuggestionCandidate>, String> {
    state
        .command_suggestions()
        .list_suggestions(state.storage(), state.command_history(), request)
        .map_err(|error| error.to_string())
}

/// 记录命令建议反馈。
#[tauri::command]
pub fn command_suggestion_record_feedback(
    state: State<'_, AppState>,
    request: CommandSuggestionFeedbackRecordRequest,
) -> Result<CommandSuggestionFeedbackRecordResult, String> {
    state
        .command_suggestions()
        .record_feedback(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 记录命令建议审计事件。
#[tauri::command]
pub fn command_suggestion_record_audit_event(
    state: State<'_, AppState>,
    request: CommandSuggestionAuditRecordRequest,
) -> Result<CommandSuggestionAuditRecordResult, String> {
    state
        .command_suggestions()
        .record_audit_event(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 返回命令建议运行期观测汇总。
#[tauri::command]
pub fn command_suggestion_telemetry_summary(
    state: State<'_, AppState>,
) -> Result<CommandSuggestionTelemetrySummary, String> {
    state
        .command_suggestions()
        .telemetry_summary()
        .map_err(|error| error.to_string())
}

/// 导出命令建议运行期与持久化观测数据。
#[tauri::command]
pub fn command_suggestion_telemetry_export(
    state: State<'_, AppState>,
) -> Result<CommandSuggestionTelemetryExport, String> {
    state
        .command_suggestions()
        .telemetry_export(state.storage())
        .map_err(|error| error.to_string())
}

/// 清理命令建议诊断数据。
#[tauri::command]
pub fn command_suggestion_cleanup_diagnostics(
    state: State<'_, AppState>,
    request: CommandSuggestionDiagnosticsCleanupRequest,
) -> Result<CommandSuggestionDiagnosticsCleanupResult, String> {
    state
        .command_suggestions()
        .cleanup_diagnostics(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 刷新远端命令建议缓存。
#[tauri::command]
pub async fn command_suggestion_refresh_remote_commands(
    state: State<'_, AppState>,
    request: CommandSuggestionRemoteCommandRefreshRequest,
) -> Result<CommandSuggestionRemoteCommandRefreshResult, String> {
    state
        .command_suggestions()
        .refresh_remote_commands(
            state.storage(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 刷新远端 shell history 建议缓存。
#[tauri::command]
pub async fn command_suggestion_refresh_remote_history(
    state: State<'_, AppState>,
    request: CommandSuggestionRemoteHistoryRefreshRequest,
) -> Result<CommandSuggestionRemoteHistoryRefreshResult, String> {
    state
        .command_suggestions()
        .refresh_remote_history(
            state.storage(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 刷新 Git refs 建议缓存。
#[tauri::command]
pub async fn command_suggestion_refresh_git_refs(
    state: State<'_, AppState>,
    request: CommandSuggestionGitRefreshRequest,
) -> Result<CommandSuggestionGitRefreshResult, String> {
    state
        .command_suggestions()
        .refresh_git_refs(
            state.storage(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 刷新远端路径建议缓存。
#[tauri::command]
pub async fn command_suggestion_refresh_remote_paths(
    state: State<'_, AppState>,
    request: CommandSuggestionRemotePathRefreshRequest,
) -> Result<CommandSuggestionRemotePathRefreshResult, String> {
    state
        .command_suggestions()
        .refresh_remote_paths(state.storage(), state.paths(), state.sftp(), request)
        .await
        .map_err(|error| error.to_string())
}
