//! tmux 管理 Tauri Commands。
//!
//! @author kongweiguang

use tauri::State;

use crate::{
    models::tmux::{
        TmuxAttachLaunch, TmuxAttachSessionRequest, TmuxCapabilityStatus, TmuxCapturePaneRequest,
        TmuxCreateSessionRequest, TmuxDetachCurrentRequest, TmuxKillSessionRequest,
        TmuxListPanesRequest, TmuxListSessionsRequest, TmuxListWindowsRequest, TmuxPaneCapture,
        TmuxPaneSummary, TmuxProbeRequest, TmuxRenameSessionRequest, TmuxSessionSummary,
        TmuxWindowSummary,
    },
    state::AppState,
};

/// 探测当前目标 tmux 是否可用。
#[tauri::command]
pub async fn tmux_probe(
    state: State<'_, AppState>,
    request: TmuxProbeRequest,
) -> Result<TmuxCapabilityStatus, String> {
    state
        .tmux()
        .probe(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 列出目标侧 tmux sessions。
#[tauri::command]
pub async fn tmux_list_sessions(
    state: State<'_, AppState>,
    request: TmuxListSessionsRequest,
) -> Result<Vec<TmuxSessionSummary>, String> {
    state
        .tmux()
        .list_sessions(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 创建 detached tmux session。
#[tauri::command]
pub async fn tmux_create_session(
    state: State<'_, AppState>,
    request: TmuxCreateSessionRequest,
) -> Result<TmuxSessionSummary, String> {
    state
        .tmux()
        .create_session(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 构造 tmux attach 终端启动规格。
#[tauri::command]
pub fn tmux_attach_session(
    state: State<'_, AppState>,
    request: TmuxAttachSessionRequest,
) -> Result<TmuxAttachLaunch, String> {
    state
        .tmux()
        .attach_launch(request)
        .map_err(|error| error.to_string())
}

/// 重命名 tmux session。
#[tauri::command]
pub async fn tmux_rename_session(
    state: State<'_, AppState>,
    request: TmuxRenameSessionRequest,
) -> Result<TmuxSessionSummary, String> {
    state
        .tmux()
        .rename_session(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 删除 tmux session。
#[tauri::command]
pub async fn tmux_kill_session(
    state: State<'_, AppState>,
    request: TmuxKillSessionRequest,
) -> Result<bool, String> {
    state
        .tmux()
        .kill_session(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 列出 tmux session 下的 windows。
#[tauri::command]
pub async fn tmux_list_windows(
    state: State<'_, AppState>,
    request: TmuxListWindowsRequest,
) -> Result<Vec<TmuxWindowSummary>, String> {
    state
        .tmux()
        .list_windows(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 列出 tmux panes。
#[tauri::command]
pub async fn tmux_list_panes(
    state: State<'_, AppState>,
    request: TmuxListPanesRequest,
) -> Result<Vec<TmuxPaneSummary>, String> {
    state
        .tmux()
        .list_panes(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 捕获 tmux pane 最近输出。
#[tauri::command]
pub async fn tmux_capture_pane(
    state: State<'_, AppState>,
    request: TmuxCapturePaneRequest,
) -> Result<TmuxPaneCapture, String> {
    state
        .tmux()
        .capture_pane(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 第一阶段 detach 当前 attach pane 由前端关闭 Kerminal pane 完成。
#[tauri::command]
pub fn tmux_detach_current(request: TmuxDetachCurrentRequest) -> Result<bool, String> {
    if request.pane_id.trim().is_empty() {
        return Err("tmux detach 需要当前 pane id".to_owned());
    }
    Ok(true)
}
