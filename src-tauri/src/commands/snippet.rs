//! 脚本片段 Tauri Commands。
//!
//! @author kongweiguang

use crate::storage::config_file_store::{
    SnippetDeleteReceipt, SnippetDocumentList, SnippetDocumentPatch, SnippetDocumentSnapshot,
};
use crate::{
    models::snippet::{
        CommandSnippet, SnippetCatalogItem, SnippetCatalogListRequest, SnippetCreateRequest,
        SnippetImportCandidate, SnippetListRequest, SnippetUpdateRequest,
    },
    state::AppState,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// 搜索和列出脚本片段。
#[tauri::command]
pub fn snippet_list(
    state: State<'_, AppState>,
    request: Option<SnippetListRequest>,
) -> Result<Vec<CommandSnippet>, String> {
    state
        .snippets()
        .list_snippets(request.unwrap_or_default())
        .map_err(|error| error.to_string())
}

/// 返回内置与用户片段的统一目录投影。
#[tauri::command]
pub fn snippet_catalog_list(
    state: State<'_, AppState>,
    request: Option<SnippetCatalogListRequest>,
) -> Result<Vec<SnippetCatalogItem>, String> {
    crate::services::snippet_catalog_service::list_catalog(
        state.snippets(),
        state.command_store(),
        request.unwrap_or_default(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snippet_document_list(state: State<'_, AppState>) -> Result<SnippetDocumentList, String> {
    state
        .snippets()
        .config()
        .list_snippet_documents()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snippet_document_get(
    state: State<'_, AppState>,
    snippet_id: String,
) -> Result<SnippetDocumentSnapshot, String> {
    state
        .snippets()
        .config()
        .read_snippet_document(&snippet_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snippet_document_patch(
    state: State<'_, AppState>,
    snippet_id: String,
    patch: SnippetDocumentPatch,
) -> Result<SnippetDocumentSnapshot, String> {
    let snapshot = state
        .snippets()
        .config()
        .patch_snippet_document(&snippet_id, &patch)
        .map_err(|error| error.to_string())?;
    state.snippets().invalidate_catalog_cache();
    Ok(snapshot)
}

#[tauri::command]
pub fn snippet_delete_with_receipt(
    state: State<'_, AppState>,
    snippet_id: String,
) -> Result<SnippetDeleteReceipt, String> {
    state
        .snippets()
        .delete_snippet_with_receipt(&snippet_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snippet_delete_restore(
    state: State<'_, AppState>,
    receipt: SnippetDeleteReceipt,
) -> Result<CommandSnippet, String> {
    state
        .snippets()
        .restore_deleted_snippet(&receipt)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snippet_favorite_set(
    state: State<'_, AppState>,
    origin: crate::storage::snippet_preferences::SnippetPreferenceOrigin,
    snippet_id: String,
    favorite: bool,
) -> Result<(), String> {
    ensure_preference_identity(&state, origin, &snippet_id)?;
    state
        .command_store()
        .set_snippet_favorite(origin, &snippet_id, favorite)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snippet_usage_record(
    state: State<'_, AppState>,
    receipt_id: String,
    origin: crate::storage::snippet_preferences::SnippetPreferenceOrigin,
    snippet_id: String,
    action: crate::storage::snippet_preferences::SnippetUsageAction,
    occurred_at_unix_ms: i64,
) -> Result<bool, String> {
    let _ = occurred_at_unix_ms;
    ensure_preference_identity(&state, origin, &snippet_id)?;
    state
        .command_store()
        .record_snippet_usage(
            &receipt_id,
            origin,
            &snippet_id,
            action,
            server_unix_time_millis(),
        )
        .map_err(|error| error.to_string())
}

fn ensure_preference_identity(
    state: &State<'_, AppState>,
    origin: crate::storage::snippet_preferences::SnippetPreferenceOrigin,
    snippet_id: &str,
) -> Result<(), String> {
    match crate::services::snippet_catalog_service::catalog_identity_exists(
        state.snippets(),
        origin,
        snippet_id,
    ) {
        Ok(true) => Ok(()),
        Ok(false) => Err("片段来源或 ID 不存在".to_owned()),
        Err(error) => Err(error.to_string()),
    }
}

fn server_unix_time_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn snippet_usage_clear(state: State<'_, AppState>) -> Result<usize, String> {
    state
        .command_store()
        .clear_snippet_usage()
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
        .create_snippet(request)
        .map_err(|error| error.to_string())
}

/// 原子导入一批用户片段。
#[tauri::command]
pub fn snippet_import(
    state: State<'_, AppState>,
    candidates: Vec<SnippetImportCandidate>,
) -> Result<Vec<CommandSnippet>, String> {
    state
        .snippets()
        .import_snippets(candidates)
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
        .update_snippet(request)
        .map_err(|error| error.to_string())
}

/// 删除脚本片段。
#[tauri::command]
pub fn snippet_delete(state: State<'_, AppState>, snippet_id: String) -> Result<bool, String> {
    state
        .snippets()
        .delete_snippet(&snippet_id)
        .map_err(|error| error.to_string())
}
