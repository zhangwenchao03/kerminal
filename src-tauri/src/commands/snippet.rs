//! 脚本片段 Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::snippet::{
        CommandSnippet, SnippetCreateRequest, SnippetListRequest, SnippetUpdateRequest,
    },
    state::AppState,
};
use tauri::State;

/// 搜索和列出脚本片段。
#[tauri::command]
pub fn snippet_list(
    state: State<'_, AppState>,
    request: Option<SnippetListRequest>,
) -> Result<Vec<CommandSnippet>, String> {
    state
        .snippets()
        .list_snippets(state.storage(), request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 创建脚本片段。
#[tauri::command]
pub fn snippet_create(
    state: State<'_, AppState>,
    request: SnippetCreateRequest,
) -> Result<CommandSnippet, String> {
    state
        .snippets()
        .create_snippet(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 更新脚本片段。
#[tauri::command]
pub fn snippet_update(
    state: State<'_, AppState>,
    request: SnippetUpdateRequest,
) -> Result<CommandSnippet, String> {
    state
        .snippets()
        .update_snippet(state.storage(), request)
        .map_err(|error| error.to_string())
}

/// 删除脚本片段。
#[tauri::command]
pub fn snippet_delete(state: State<'_, AppState>, snippet_id: String) -> Result<bool, String> {
    state
        .snippets()
        .delete_snippet(state.storage(), &snippet_id)
        .map_err(|error| error.to_string())
}
