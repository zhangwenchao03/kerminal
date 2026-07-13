//! SSH 远程终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::commands::terminal::{map_terminal_command_error, TerminalCommandResult};
use crate::{
    error::AppError,
    models::terminal::{
        host_terminal_target_ref, SshTerminalCreateRequest, TerminalErrorOperation,
        TerminalOutputEvent, TerminalSessionSummary,
    },
    state::AppState,
};
use tauri::{ipc::Channel, AppHandle, Manager};

#[doc(hidden)]
pub mod rules {
    use super::*;

    /// 将可能等待网络超时和重试的 SSH 创建流程移出 Tauri 窗口处理线程。
    ///
    /// worker 保留原有同步 service 契约，避免改变 managed shell 自有 Tokio runtime 的生命周期。
    pub async fn run_ssh_create_task<T, F>(task: F) -> TerminalCommandResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> TerminalCommandResult<T> + Send + 'static,
    {
        tauri::async_runtime::spawn_blocking(task)
            .await
            .map_err(|error| {
                map_terminal_command_error(TerminalErrorOperation::CreateSession)(
                    AppError::Terminal(format!("SSH 终端创建后台任务失败: {error}")),
                )
            })?
    }
}

/// 创建 SSH 远程终端会话。
#[tauri::command]
pub async fn ssh_create_session(
    app: AppHandle,
    output: Channel<TerminalOutputEvent>,
    request: SshTerminalCreateRequest,
) -> TerminalCommandResult<TerminalSessionSummary> {
    rules::run_ssh_create_task(move || {
        let state = app.state::<AppState>();
        let target_ref = host_terminal_target_ref("ssh", &request.host_id);
        state
            .ssh_terminals()
            .create_session(
                state.remote_hosts(),
                state.paths(),
                state.terminals(),
                request,
                move |event| output.send(event).is_ok(),
            )
            .and_then(|summary| state.terminals().set_target_ref(&summary.id, target_ref))
            .map_err(map_terminal_command_error(
                TerminalErrorOperation::CreateSession,
            ))
    })
    .await
}
