//! Docker/Podman 容器 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::{
        docker::{
            DockerContainerChmodRequest, DockerContainerDeleteRequest,
            DockerContainerDirectoryListing, DockerContainerFilePreview,
            DockerContainerListRequest, DockerContainerPathRequest, DockerContainerPreviewRequest,
            DockerContainerReadTextFileRequest, DockerContainerReadTextFileResponse,
            DockerContainerRenameRequest, DockerContainerSummary,
            DockerContainerTerminalCreateRequest, DockerContainerTransferRequest,
            DockerContainerWriteTextFileRequest, DockerContainerWriteTextFileResponse,
        },
        terminal::{TerminalOutputEvent, TerminalSessionSummary},
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
        .list_containers(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
    state
        .docker_hosts()
        .create_container_session(state.storage(), state.terminals(), request, move |event| {
            output.send(event).is_ok()
        })
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
        .list_directory(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
        .preview_file(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
        .read_text_file(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
            state.storage(),
            state.credentials(),
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
        .create_directory(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
        .delete_path(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
        .rename_path(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
        .chmod_path(
            state.storage(),
            state.credentials(),
            state.paths(),
            state.ssh_commands(),
            request,
        )
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
        .upload(state.storage(), request)
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
        .download(state.storage(), request)
        .map_err(|error| error.to_string())
}
