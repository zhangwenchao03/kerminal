//! 命令工作流 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::workflow::{
        CommandWorkflow, WorkflowCreateRequest, WorkflowListRequest, WorkflowUpdateRequest,
    },
    state::AppState,
};
use tauri::State;

/// 搜索和列出命令工作流。
#[tauri::command]
pub fn workflow_list(
    state: State<'_, AppState>,
    request: Option<WorkflowListRequest>,
) -> Result<Vec<CommandWorkflow>, String> {
    state
        .workflows()
        .list_workflows(request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 创建命令工作流。
#[tauri::command]
pub fn workflow_create(
    state: State<'_, AppState>,
    request: WorkflowCreateRequest,
) -> Result<CommandWorkflow, String> {
    state
        .workflows()
        .create_workflow(request)
        .map_err(|error| error.to_string())
}

/// 更新命令工作流。
#[tauri::command]
pub fn workflow_update(
    state: State<'_, AppState>,
    request: WorkflowUpdateRequest,
) -> Result<CommandWorkflow, String> {
    state
        .workflows()
        .update_workflow(request)
        .map_err(|error| error.to_string())
}

/// 删除命令工作流。
#[tauri::command]
pub fn workflow_delete(state: State<'_, AppState>, workflow_id: String) -> Result<bool, String> {
    state
        .workflows()
        .delete_workflow(&workflow_id)
        .map_err(|error| error.to_string())
}
