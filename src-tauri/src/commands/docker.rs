//! Docker/Podman 容器 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::{
        docker::{
            DockerContainerChmodRequest, DockerContainerDeleteRequest,
            DockerContainerDirectoryListing, DockerContainerFilePreview,
            DockerContainerInfoRequest, DockerContainerInspectSummary,
            DockerContainerLifecycleRequest, DockerContainerLifecycleResult,
            DockerContainerListRequest, DockerContainerLogsRequest, DockerContainerLogsResult,
            DockerContainerPathRequest, DockerContainerPreviewRequest,
            DockerContainerReadTextFileRequest, DockerContainerReadTextFileResponse,
            DockerContainerRenameRequest, DockerContainerStatsRequest, DockerContainerStatsResult,
            DockerContainerSummary, DockerContainerTerminalCreateRequest,
            DockerContainerTransferRequest, DockerContainerWriteTextFileRequest,
            DockerContainerWriteTextFileResponse,
        },
        terminal::{
            docker_container_terminal_target_ref, TerminalOutputEvent, TerminalSessionSummary,
        },
    },
    state::AppState,
};
use tauri::{ipc::Channel, State};

/// 列出指定 SSH 宿主上的容器。
#[tauri::command]
pub async fn docker_list_containers(
    state: State<'_, AppState>,
    request: DockerContainerListRequest,
) -> Result<Vec<DockerContainerSummary>, String> {
    state
        .docker_hosts()
        .list_containers(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 启动指定容器。
#[tauri::command]
pub async fn docker_start_container(
    state: State<'_, AppState>,
    request: DockerContainerLifecycleRequest,
) -> Result<DockerContainerLifecycleResult, String> {
    state
        .docker_hosts()
        .start_container(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 停止指定容器。
#[tauri::command]
pub async fn docker_stop_container(
    state: State<'_, AppState>,
    request: DockerContainerLifecycleRequest,
) -> Result<DockerContainerLifecycleResult, String> {
    state
        .docker_hosts()
        .stop_container(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 重启指定容器。
#[tauri::command]
pub async fn docker_restart_container(
    state: State<'_, AppState>,
    request: DockerContainerLifecycleRequest,
) -> Result<DockerContainerLifecycleResult, String> {
    state
        .docker_hosts()
        .restart_container(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 删除指定容器。
#[tauri::command]
pub async fn docker_remove_container(
    state: State<'_, AppState>,
    request: DockerContainerLifecycleRequest,
) -> Result<DockerContainerLifecycleResult, String> {
    state
        .docker_hosts()
        .remove_container(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 读取容器 inspect 摘要。
#[tauri::command]
pub async fn docker_inspect_container(
    state: State<'_, AppState>,
    request: DockerContainerInfoRequest,
) -> Result<DockerContainerInspectSummary, String> {
    state
        .docker_hosts()
        .inspect_container(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 读取容器最近日志。
#[tauri::command]
pub async fn docker_tail_container_logs(
    state: State<'_, AppState>,
    request: DockerContainerLogsRequest,
) -> Result<DockerContainerLogsResult, String> {
    state
        .docker_hosts()
        .tail_container_logs(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 读取容器一次性 stats。
#[tauri::command]
pub async fn docker_container_stats(
    state: State<'_, AppState>,
    request: DockerContainerStatsRequest,
) -> Result<DockerContainerStatsResult, String> {
    state
        .docker_hosts()
        .container_stats(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 创建容器交互式终端会话。
#[tauri::command]
pub fn docker_create_container_session(
    state: State<'_, AppState>,
    output: Channel<TerminalOutputEvent>,
    request: DockerContainerTerminalCreateRequest,
) -> Result<TerminalSessionSummary, String> {
    let target_ref = docker_container_terminal_target_ref(&request.host_id, &request.container_id);
    state
        .docker_hosts()
        .create_container_session(
            state.remote_hosts(),
            state.paths(),
            state.ssh_terminals(),
            state.terminals(),
            request,
            move |event| output.send(event).is_ok(),
        )
        .and_then(|summary| state.terminals().set_target_ref(&summary.id, target_ref))
        .map_err(|error| error.to_string())
}

/// 列出容器内目录。
#[tauri::command]
pub async fn docker_list_directory(
    state: State<'_, AppState>,
    request: DockerContainerPathRequest,
) -> Result<DockerContainerDirectoryListing, String> {
    state
        .docker_hosts()
        .list_directory(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 预览容器内文件。
#[tauri::command]
pub async fn docker_preview_file(
    state: State<'_, AppState>,
    request: DockerContainerPreviewRequest,
) -> Result<DockerContainerFilePreview, String> {
    state
        .docker_hosts()
        .preview_file(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 读取容器内文本文件。
#[tauri::command]
pub async fn docker_read_text_file(
    state: State<'_, AppState>,
    request: DockerContainerReadTextFileRequest,
) -> Result<DockerContainerReadTextFileResponse, String> {
    state
        .docker_hosts()
        .read_text_file(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 写入容器内文本文件。
#[tauri::command]
pub async fn docker_write_text_file(
    state: State<'_, AppState>,
    request: DockerContainerWriteTextFileRequest,
) -> Result<DockerContainerWriteTextFileResponse, String> {
    state
        .docker_hosts()
        .write_text_file(
            state.remote_hosts(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
        .await
        .map_err(|error| error.to_string())
}

/// 创建容器内目录。
#[tauri::command]
pub async fn docker_create_directory(
    state: State<'_, AppState>,
    request: DockerContainerPathRequest,
) -> Result<bool, String> {
    state
        .docker_hosts()
        .create_directory(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 删除容器内路径。
#[tauri::command]
pub async fn docker_delete_path(
    state: State<'_, AppState>,
    request: DockerContainerDeleteRequest,
) -> Result<bool, String> {
    state
        .docker_hosts()
        .delete_path(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 重命名容器内路径。
#[tauri::command]
pub async fn docker_rename_path(
    state: State<'_, AppState>,
    request: DockerContainerRenameRequest,
) -> Result<bool, String> {
    state
        .docker_hosts()
        .rename_path(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 修改容器内路径权限。
#[tauri::command]
pub async fn docker_chmod_path(
    state: State<'_, AppState>,
    request: DockerContainerChmodRequest,
) -> Result<bool, String> {
    state
        .docker_hosts()
        .chmod_path(state.paths(), state.ssh_commands(), request)
        .await
        .map_err(|error| error.to_string())
}

/// 上传本地文件或目录到容器。
#[tauri::command]
pub fn docker_upload(
    state: State<'_, AppState>,
    request: DockerContainerTransferRequest,
) -> Result<bool, String> {
    state
        .docker_hosts()
        .upload(state.remote_hosts(), request)
        .map_err(|error| error.to_string())
}

/// 下载容器内文件或目录到本地。
#[tauri::command]
pub fn docker_download(
    state: State<'_, AppState>,
    request: DockerContainerTransferRequest,
) -> Result<bool, String> {
    state
        .docker_hosts()
        .download(state.remote_hosts(), request)
        .map_err(|error| error.to_string())
}
