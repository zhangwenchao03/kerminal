//! Rig LLM Provider 配置服务。
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use rig_core::{
    client::CompletionClient,
    providers::{anthropic, openai},
};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::llm_provider::{
        LlmProvider, LlmProviderCreateRequest, LlmProviderKind, LlmProviderTestResult,
        LlmProviderUpdateRequest,
    },
    services::credential_service::CredentialService,
    storage::{llm_providers::LlmProviderWrite, SqliteStore},
};

/// Rig Provider 服务，负责 provider CRUD、凭据引用和 Rig client dry validation。
#[derive(Debug, Default)]
pub struct RigProviderService;

impl RigProviderService {
    /// 创建 Rig Provider 服务。
    pub fn new() -> Self {
        Self
    }

    /// 返回全部 LLM Provider。
    pub fn list_providers(&self, storage: &SqliteStore) -> AppResult<Vec<LlmProvider>> {
        storage.list_llm_providers()
    }

    /// 新建 LLM Provider。
    pub fn create_provider(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        request: LlmProviderCreateRequest,
    ) -> AppResult<LlmProvider> {
        let api_key = request.normalized_api_key();
        let draft = request.validated()?;
        let id = format!("llm-{}", Uuid::new_v4());
        let api_key_credential_ref = api_key
            .as_ref()
            .map(|_| CredentialService::llm_api_key_ref(&id));

        if let (Some(credential_ref), Some(secret)) = (&api_key_credential_ref, api_key.as_ref()) {
            credentials.set_secret(credential_ref, secret)?;
        }

        let write = LlmProviderWrite {
            id,
            name: draft.name,
            kind: draft.kind,
            base_url: draft.base_url,
            model: draft.model,
            model_list: draft.model_list,
            temperature: draft.temperature,
            context_strategy: draft.context_strategy,
            context_window_tokens: draft.context_window_tokens,
            reasoning_effort: draft.reasoning_effort,
            max_retries: draft.max_retries,
            user_agent: draft.user_agent,
            http_proxy: draft.http_proxy,
            enabled: draft.enabled,
            is_default: draft.is_default,
            api_key_credential_ref,
        };

        match storage.insert_llm_provider(&write) {
            Ok(provider) => Ok(provider),
            Err(error) => {
                if let Some(credential_ref) = &write.api_key_credential_ref {
                    let _ = credentials.delete_secret(credential_ref);
                }
                Err(error)
            }
        }
    }

    /// 更新 LLM Provider。
    pub fn update_provider(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        request: LlmProviderUpdateRequest,
    ) -> AppResult<LlmProvider> {
        let id = request.id.trim().to_string();
        let api_key = request.normalized_api_key();
        let clear_api_key = request.clear_api_key;
        let draft = request.validated()?;
        let existing = storage
            .llm_provider_by_id(&id)?
            .ok_or_else(|| AppError::NotFound(format!("LLM Provider 不存在: {id}")))?;

        let mut credential_ref = existing.api_key_credential_ref;
        if clear_api_key {
            if let Some(existing_ref) = credential_ref.as_deref() {
                let _ = credentials.delete_secret(existing_ref);
            }
            credential_ref = None;
        } else if let Some(secret) = api_key {
            let next_ref =
                credential_ref.unwrap_or_else(|| CredentialService::llm_api_key_ref(&id));
            credentials.set_secret(&next_ref, &secret)?;
            credential_ref = Some(next_ref);
        }

        let write = LlmProviderWrite {
            id,
            name: draft.name,
            kind: draft.kind,
            base_url: draft.base_url,
            model: draft.model,
            model_list: draft.model_list,
            temperature: draft.temperature,
            context_strategy: draft.context_strategy,
            context_window_tokens: draft.context_window_tokens,
            reasoning_effort: draft.reasoning_effort,
            max_retries: draft.max_retries,
            user_agent: draft.user_agent,
            http_proxy: draft.http_proxy,
            enabled: draft.enabled,
            is_default: draft.is_default,
            api_key_credential_ref: credential_ref,
        };

        storage.update_llm_provider(&write)
    }

    /// 删除 LLM Provider，并尽力清理对应凭据。
    pub fn delete_provider(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        provider_id: &str,
    ) -> AppResult<bool> {
        let provider = storage.llm_provider_by_id(provider_id)?;
        let deleted = storage.delete_llm_provider(provider_id)?;
        if deleted {
            if let Some(credential_ref) =
                provider.and_then(|provider| provider.api_key_credential_ref)
            {
                let _ = credentials.delete_secret(&credential_ref);
            }
        }
        Ok(deleted)
    }

    /// 使用 Rig provider 构造做本地 dry validation，不发起真实 LLM 请求。
    pub fn test_provider(
        &self,
        storage: &SqliteStore,
        credentials: &CredentialService,
        provider_id: &str,
    ) -> AppResult<LlmProviderTestResult> {
        let provider = storage
            .llm_provider_by_id(provider_id)?
            .ok_or_else(|| AppError::NotFound(format!("LLM Provider 不存在: {provider_id}")))?;
        let credential_ref = provider
            .api_key_credential_ref
            .as_deref()
            .ok_or_else(|| AppError::InvalidInput("API key 未配置".to_string()))?;
        let api_key = credentials
            .get_secret(credential_ref)?
            .ok_or_else(|| AppError::InvalidInput("API key 未配置".to_string()))?;

        validate_rig_provider(&provider, &api_key)?;

        Ok(LlmProviderTestResult {
            provider_id: provider.id,
            ok: true,
            message: "Rig provider 配置验证通过；未发送真实 LLM 请求。".to_string(),
            mode: "dryRun".to_string(),
            checked_at: current_unix_timestamp(),
        })
    }
}

/// 构造 Rig OpenAI Responses client。该函数只做 SDK client 构造，不发起真实 LLM 请求。
pub(crate) fn build_openai_responses_client(
    provider: &LlmProvider,
    api_key: &str,
) -> AppResult<openai::Client> {
    openai::Client::builder()
        .api_key(api_key)
        .base_url(&provider.base_url)
        .build()
        .map_err(|error| AppError::LlmProvider(format!("Rig OpenAI Responses 配置无效: {error}")))
}

/// 构造 Rig OpenAI Chat Completions client。该函数只做 SDK client 构造，不发起真实 LLM 请求。
pub(crate) fn build_openai_chat_client(
    provider: &LlmProvider,
    api_key: &str,
) -> AppResult<openai::CompletionsClient> {
    openai::CompletionsClient::builder()
        .api_key(api_key)
        .base_url(&provider.base_url)
        .build()
        .map_err(|error| AppError::LlmProvider(format!("Rig OpenAI Chat 配置无效: {error}")))
}

/// 构造 Rig Anthropic client。该函数只做 SDK client 构造，不发起真实 LLM 请求。
pub(crate) fn build_anthropic_client(
    provider: &LlmProvider,
    api_key: &str,
) -> AppResult<anthropic::Client> {
    anthropic::Client::builder()
        .api_key(api_key)
        .base_url(&provider.base_url)
        .build()
        .map_err(|error| AppError::LlmProvider(format!("Rig Anthropic 配置无效: {error}")))
}

/// 使用匹配 provider kind 的 Rig client 做本地 dry validation。
pub(crate) fn validate_rig_provider(provider: &LlmProvider, api_key: &str) -> AppResult<()> {
    match provider.kind {
        LlmProviderKind::OpenAiResponses => {
            let client = build_openai_responses_client(provider, api_key)?;
            let _model = client.completion_model(provider.model.clone());
        }
        LlmProviderKind::OpenAiChat => {
            let client = build_openai_chat_client(provider, api_key)?;
            let _model = client.completion_model(provider.model.clone());
        }
        LlmProviderKind::Anthropic => {
            let client = build_anthropic_client(provider, api_key)?;
            let _model = client.completion_model(provider.model.clone());
        }
    }
    Ok(())
}

fn current_unix_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}
