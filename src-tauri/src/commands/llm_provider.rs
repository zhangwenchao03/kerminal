//! LLM Provider Tauri Commands。
//!
//! @author kongweiguang

use crate::{
    models::llm_provider::{
        LlmProvider, LlmProviderCreateRequest, LlmProviderTestResult, LlmProviderUpdateRequest,
    },
    state::AppState,
};
use tauri::State;

/// 返回全部 LLM Provider 配置。
#[tauri::command]
pub fn llm_provider_list(state: State<'_, AppState>) -> Result<Vec<LlmProvider>, String> {
    state
        .rig_providers()
        .list_providers(state.storage())
        .map_err(|error| error.to_string())
}

/// 新建 LLM Provider 配置。
#[tauri::command]
pub fn llm_provider_create(
    state: State<'_, AppState>,
    request: LlmProviderCreateRequest,
) -> Result<LlmProvider, String> {
    state
        .rig_providers()
        .create_provider(state.storage(), state.credentials(), request)
        .map_err(|error| error.to_string())
}

/// 更新 LLM Provider 配置。
#[tauri::command]
pub fn llm_provider_update(
    state: State<'_, AppState>,
    request: LlmProviderUpdateRequest,
) -> Result<LlmProvider, String> {
    state
        .rig_providers()
        .update_provider(state.storage(), state.credentials(), request)
        .map_err(|error| error.to_string())
}

/// 删除 LLM Provider 配置。
#[tauri::command]
pub fn llm_provider_delete(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state
        .rig_providers()
        .delete_provider(state.storage(), state.credentials(), &id)
        .map_err(|error| error.to_string())
}

/// 对 LLM Provider 做 Rig dry validation。
#[tauri::command]
pub fn llm_provider_test(
    state: State<'_, AppState>,
    id: String,
) -> Result<LlmProviderTestResult, String> {
    state
        .rig_providers()
        .test_provider(state.storage(), state.credentials(), &id)
        .map_err(|error| error.to_string())
}
