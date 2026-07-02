//! 终端会话 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    error::AppError,
    models::terminal::{
        local_terminal_target_ref, TerminalCommandError, TerminalCreateRequest,
        TerminalErrorOperation, TerminalOutputEvent, TerminalPtyOutputPumpStats,
        TerminalResizeRequest, TerminalSessionLogState, TerminalSessionReapDiagnostics,
        TerminalSessionSummary,
    },
    state::AppState,
};
use tauri::{ipc::Channel, State};

pub(crate) type TerminalCommandResult<T> = Result<T, TerminalCommandError>;

pub(crate) fn map_terminal_command_error(
    operation: TerminalErrorOperation,
) -> impl FnOnce(AppError) -> TerminalCommandError {
    move |error| TerminalCommandError::from_app_error(operation, &error)
}

/// 创建本地 PTY 终端会话。
#[tauri::command]
pub fn terminal_create_session(
    state: State<'_, AppState>,
    output: Channel<TerminalOutputEvent>,
    request: TerminalCreateRequest,
) -> TerminalCommandResult<TerminalSessionSummary> {
    state
        .terminals()
        .create_session(request, move |event| output.send(event).is_ok())
        .and_then(|summary| {
            state
                .terminals()
                .set_target_ref(&summary.id, local_terminal_target_ref())
        })
        .map_err(map_terminal_command_error(
            TerminalErrorOperation::CreateSession,
        ))
}

/// 向终端会话写入输入数据。
#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> TerminalCommandResult<()> {
    state
        .terminals()
        .write(&session_id, &data)
        .map_err(map_terminal_command_error(TerminalErrorOperation::Write))
}

/// 调整终端会话尺寸。
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    session_id: String,
    request: TerminalResizeRequest,
) -> TerminalCommandResult<()> {
    state
        .terminals()
        .resize(&session_id, request)
        .map_err(map_terminal_command_error(TerminalErrorOperation::Resize))
}

/// 关闭终端会话。
#[tauri::command]
pub fn terminal_close(state: State<'_, AppState>, session_id: String) -> TerminalCommandResult<()> {
    state
        .terminals()
        .close(&session_id)
        .map_err(map_terminal_command_error(TerminalErrorOperation::Close))
}

/// 收割当前进程内的本地 PTY orphan 会话。
#[tauri::command]
pub fn terminal_reap_orphan_sessions(
    state: State<'_, AppState>,
) -> TerminalCommandResult<TerminalSessionReapDiagnostics> {
    let diagnostics =
        state
            .terminals()
            .reap_orphan_sessions()
            .map_err(map_terminal_command_error(
                TerminalErrorOperation::ReapOrphanSessions,
            ))?;
    tauri_plugin_log::log::info!(
        "terminal orphan reaper completed: reaped_count={} session_ids={:?} elapsed_ms={}",
        diagnostics.reaped_count,
        diagnostics.session_ids,
        diagnostics.elapsed_ms
    );
    Ok(diagnostics)
}

/// 列出当前终端会话。
#[tauri::command]
pub fn terminal_list_sessions(
    state: State<'_, AppState>,
) -> TerminalCommandResult<Vec<TerminalSessionSummary>> {
    state
        .terminals()
        .list_sessions()
        .map_err(map_terminal_command_error(
            TerminalErrorOperation::ListSessions,
        ))
}

/// 开始记录指定终端会话的新输出。
#[tauri::command]
pub fn terminal_start_log(
    state: State<'_, AppState>,
    session_id: String,
) -> TerminalCommandResult<TerminalSessionLogState> {
    state
        .terminals()
        .start_log(&session_id, &state.paths().logs)
        .map_err(map_terminal_command_error(TerminalErrorOperation::StartLog))
}

/// 停止记录指定终端会话输出。
#[tauri::command]
pub fn terminal_stop_log(
    state: State<'_, AppState>,
    session_id: String,
) -> TerminalCommandResult<TerminalSessionLogState> {
    state
        .terminals()
        .stop_log(&session_id)
        .map_err(map_terminal_command_error(TerminalErrorOperation::StopLog))
}

/// 查询指定终端会话日志记录状态。
#[tauri::command]
pub fn terminal_log_state(
    state: State<'_, AppState>,
    session_id: String,
) -> TerminalCommandResult<TerminalSessionLogState> {
    state
        .terminals()
        .log_state(&session_id)
        .map_err(map_terminal_command_error(TerminalErrorOperation::LogState))
}

/// 查询指定本地 PTY 会话的 output pump 非敏感指标。
#[tauri::command]
pub fn terminal_pty_output_pump_stats(
    state: State<'_, AppState>,
    session_id: String,
) -> TerminalCommandResult<TerminalPtyOutputPumpStats> {
    state
        .terminals()
        .pty_output_pump_stats(&session_id)
        .map_err(map_terminal_command_error(
            TerminalErrorOperation::Diagnostics,
        ))
}
