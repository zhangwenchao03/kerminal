//! 命令历史 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::command_history::{
        CommandHistoryEntry, CommandHistoryListRequest, CommandHistoryRecordRequest,
        CommandHistoryRecordResult,
    },
    state::AppState,
};
use tauri::State;

/// 搜索和列出命令历史。
#[tauri::command]
pub fn command_history_list(
    state: State<'_, AppState>,
    request: Option<CommandHistoryListRequest>,
) -> Result<Vec<CommandHistoryEntry>, String> {
    state
        .command_history()
        .list_history(state.storage(), request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 记录一条命令历史。
#[tauri::command]
pub fn command_history_record(
    state: State<'_, AppState>,
    request: CommandHistoryRecordRequest,
) -> Result<CommandHistoryRecordResult, String> {
    state
        .command_history()
        .record_command(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 删除一条命令历史。
#[tauri::command]
pub fn command_history_delete(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<bool, String> {
    state
        .command_history()
        .delete_history(state.storage(), &entry_id)
        .map_err(|error| error.to_string())
}

/// 清空所有命令历史。
#[tauri::command]
pub fn command_history_clear(state: State<'_, AppState>) -> Result<usize, String> {
    state
        .command_history()
        .clear_history(state.storage())
        .map_err(|error| error.to_string())
}
