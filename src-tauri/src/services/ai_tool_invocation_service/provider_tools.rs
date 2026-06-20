use super::*;

pub(super) fn execute_llm_provider_list(
    rig_providers: &RigProviderService,
    storage: &SqliteStore,
) -> ToolExecutionResult {
    match rig_providers.list_providers(storage) {
        Ok(providers) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_llm_providers_for_ai(&providers)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_llm_provider_create(
    rig_providers: &RigProviderService,
    storage: &SqliteStore,
    credentials: &CredentialService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<LlmProviderCreateRequest>(
        arguments,
        "llm_provider.create",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let api_key_supplied = request
        .api_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());

    match rig_providers.create_provider(storage, credentials, request) {
        Ok(provider) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_llm_provider_write_for_ai(
                "已创建",
                &provider,
                Some(api_key_supplied),
                None,
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_llm_provider_update(
    rig_providers: &RigProviderService,
    storage: &SqliteStore,
    credentials: &CredentialService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<LlmProviderUpdateRequest>(
        arguments,
        "llm_provider.update",
    ) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let api_key_supplied = request
        .api_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let clear_api_key = request.clear_api_key;

    match rig_providers.update_provider(storage, credentials, request) {
        Ok(provider) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_llm_provider_write_for_ai(
                "已更新",
                &provider,
                Some(api_key_supplied),
                Some(clear_api_key),
            )),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_llm_provider_delete(
    rig_providers: &RigProviderService,
    storage: &SqliteStore,
    credentials: &CredentialService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let provider_id = match required_string_arg(arguments, "id") {
        Ok(provider_id) => provider_id,
        Err(error) => return failure(error.to_string()),
    };

    match rig_providers.delete_provider(storage, credentials, &provider_id) {
        Ok(true) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(format!(
                "LLM Provider 已删除：{}，对应凭据已尽力清理。",
                truncate_string(&provider_id)
            )),
            error: None,
        },
        Ok(false) => failure(format!("LLM Provider 不存在或未删除：{provider_id}。")),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn execute_llm_provider_test(
    rig_providers: &RigProviderService,
    storage: &SqliteStore,
    credentials: &CredentialService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let provider_id = match required_string_arg(arguments, "id") {
        Ok(provider_id) => provider_id,
        Err(error) => return failure(error.to_string()),
    };

    match rig_providers.test_provider(storage, credentials, &provider_id) {
        Ok(result) => ToolExecutionResult {
            status: AiToolInvocationStatus::Succeeded,
            result_summary: Some(summarize_llm_provider_test_for_ai(&result)),
            error: None,
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_llm_providers_for_ai(providers: &[LlmProvider]) -> String {
    if providers.is_empty() {
        return "当前没有配置 LLM Provider。".to_owned();
    }

    let enabled = providers.iter().filter(|provider| provider.enabled).count();
    let samples = providers
        .iter()
        .take(5)
        .map(|provider| {
            format!(
                "{}（{:?}，model={}，默认={}，API key={}，id={}）",
                provider.name,
                provider.kind,
                provider.model,
                if provider.is_default { "是" } else { "否" },
                if provider.api_key_configured {
                    "已配置"
                } else {
                    "未配置"
                },
                provider.id
            )
        })
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个 LLM Provider，启用 {} 个。示例：{}。",
        providers.len(),
        enabled,
        samples
    )
}

pub(super) fn summarize_llm_provider_write_for_ai(
    action: &str,
    provider: &LlmProvider,
    api_key_supplied: Option<bool>,
    clear_api_key: Option<bool>,
) -> String {
    let api_key_note = match (api_key_supplied, clear_api_key) {
        (_, Some(true)) => "API key 已清除",
        (Some(true), _) => "API key 已写入本地凭据存储",
        _ if provider.api_key_configured => "API key 已配置",
        _ => "API key 未配置",
    };
    format!(
        "LLM Provider {}：“{}”（{:?}，model={}，默认={}，启用={}，{}，id={}）。",
        action,
        provider.name,
        provider.kind,
        provider.model,
        if provider.is_default { "是" } else { "否" },
        if provider.enabled { "是" } else { "否" },
        api_key_note,
        provider.id
    )
}

pub(super) fn summarize_llm_provider_test_for_ai(result: &LlmProviderTestResult) -> String {
    format!(
        "LLM Provider 验证{}：{}，模式：{}，providerId={}。",
        if result.ok { "通过" } else { "未通过" },
        result.message,
        result.mode,
        result.provider_id
    )
}
