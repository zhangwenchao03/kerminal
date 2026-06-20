//! 终端会话 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::terminal::{
        TerminalCreateRequest, TerminalOutputEvent, TerminalResizeRequest, TerminalSessionLogState,
        TerminalSessionSummary,
    },
    state::AppState,
};
use tauri::{ipc::Channel, State};

/// 创建本地 PTY 终端会话。
#[tauri::command]
pub fn terminal_create_session(
    state: State<'_, AppState>,
    output: Channel<TerminalOutputEvent>,
    request: TerminalCreateRequest,
) -> Result<TerminalSessionSummary, String> {
    state
        .terminals()
        .create_session(request, move |event| output.send(event).is_ok())
        .map_err(|error| error.to_string())
}

/// 向终端会话写入输入数据。
#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .terminals()
        .write(&session_id, &data)
        .map_err(|error| error.to_string())
}

/// 调整终端会话尺寸。
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    session_id: String,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    state
        .terminals()
        .resize(&session_id, request)
        .map_err(|error| error.to_string())
}

/// 关闭终端会话。
#[tauri::command]
pub fn terminal_close(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state
        .terminals()
        .close(&session_id)
        .map_err(|error| error.to_string())
}

/// 列出当前终端会话。
#[tauri::command]
pub fn terminal_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<TerminalSessionSummary>, String> {
    state
        .terminals()
        .list_sessions()
        .map_err(|error| error.to_string())
}

/// 开始记录指定终端会话的新输出。
#[tauri::command]
pub fn terminal_start_log(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<TerminalSessionLogState, String> {
    state
        .terminals()
        .start_log(&session_id, &state.paths().logs)
        .map_err(|error| error.to_string())
}

/// 停止记录指定终端会话输出。
#[tauri::command]
pub fn terminal_stop_log(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<TerminalSessionLogState, String> {
    state
        .terminals()
        .stop_log(&session_id)
        .map_err(|error| error.to_string())
}

/// 查询指定终端会话日志记录状态。
#[tauri::command]
pub fn terminal_log_state(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<TerminalSessionLogState, String> {
    state
        .terminals()
        .log_state(&session_id)
        .map_err(|error| error.to_string())
}
