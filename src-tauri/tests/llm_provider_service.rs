//! Rig LLM Provider 服务集成测试。
//!
//! @author kongweiguang

use std::sync::Arc;

use kerminal_lib::{
    models::llm_provider::{
        LlmContextStrategy, LlmProviderCreateRequest, LlmProviderKind, LlmProviderUpdateRequest,
        LlmReasoningEffort,
    },
    paths::KerminalPaths,
    services::{
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
    },
    state::AppState,
};
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn provider_kind_serializes_for_ipc_and_maps_legacy_database_value() {
    assert_eq!(
        serde_json::to_value(LlmProviderKind::OpenAiResponses).expect("serialize responses kind"),
        serde_json::json!("openAiResponses")
    );
    assert_eq!(
        serde_json::to_value(LlmProviderKind::OpenAiChat).expect("serialize chat kind"),
        serde_json::json!("openAiChat")
    );
    assert_eq!(
        serde_json::to_value(LlmProviderKind::Anthropic).expect("serialize anthropic kind"),
        serde_json::json!("anthropic")
    );
    assert_eq!(
        LlmProviderKind::try_from("openai_compatible").expect("legacy db kind"),
        LlmProviderKind::OpenAiChat
    );
    assert_eq!(LlmProviderKind::OpenAiChat.as_db_str(), "openai_chat");
}

#[test]
fn creates_provider_with_keyring_ref_without_plaintext_in_sqlite() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let vault = Arc::new(MemoryCredentialVault::new());
    let credentials = CredentialService::with_vault(vault.clone());
    let service = RigProviderService::new();

    let provider = service
        .create_provider(
            state.storage(),
            &credentials,
            LlmProviderCreateRequest {
                name: "OpenAI Chat".to_string(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1/".to_string(),
                model: "gpt-test".to_string(),
                model_list: vec!["gpt-test".to_string()],
                temperature: 0.3,
                context_strategy: LlmContextStrategy::CurrentTerminal,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: true,
                api_key: Some("sk-test-secret".to_string()),
            },
        )
        .expect("create provider");

    assert_eq!(provider.base_url, "https://api.example.com/v1");
    assert!(provider.api_key_configured);
    assert!(provider.is_default);

    let credential_ref = provider
        .api_key_credential_ref
        .as_deref()
        .expect("credential ref");
    assert!(credential_ref.starts_with("credential:llm/"));
    assert!(vault.contains(credential_ref));

    let conn = Connection::open(state.storage().database_file()).expect("open db");
    let raw_provider: String = conn
        .query_row(
            "SELECT id || name || base_url || model || COALESCE(api_key_credential_ref, '') FROM llm_providers WHERE id = ?1",
            [provider.id.as_str()],
            |row| row.get(0),
        )
        .expect("read raw provider");
    assert!(!raw_provider.contains("sk-test-secret"));
}

#[test]
fn updates_provider_and_keeps_existing_api_key_when_not_replaced() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let vault = Arc::new(MemoryCredentialVault::new());
    let credentials = CredentialService::with_vault(vault);
    let service = RigProviderService::new();

    let provider = service
        .create_provider(
            state.storage(),
            &credentials,
            LlmProviderCreateRequest {
                name: "默认 Provider".to_string(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1".to_string(),
                model: "gpt-a".to_string(),
                model_list: vec!["gpt-a".to_string()],
                temperature: 0.2,
                context_strategy: LlmContextStrategy::Minimal,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: false,
                api_key: Some("sk-original".to_string()),
            },
        )
        .expect("create provider");
    let original_ref = provider.api_key_credential_ref.clone();

    let updated = service
        .update_provider(
            state.storage(),
            &credentials,
            LlmProviderUpdateRequest {
                id: provider.id.clone(),
                name: "更新后的 Provider".to_string(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://llm.local/v1".to_string(),
                model: "gpt-b".to_string(),
                model_list: vec!["gpt-b".to_string()],
                temperature: 0.7,
                context_strategy: LlmContextStrategy::CurrentWorkspace,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::High,
                max_retries: 4,
                user_agent: Some("Kerminal-Test/1.0".to_string()),
                http_proxy: None,
                enabled: false,
                is_default: true,
                api_key: None,
                clear_api_key: false,
            },
        )
        .expect("update provider");

    assert_eq!(updated.name, "更新后的 Provider");
    assert_eq!(updated.model, "gpt-b");
    assert!(!updated.enabled);
    assert!(updated.is_default);
    assert_eq!(updated.api_key_credential_ref, original_ref);
}

#[test]
fn dry_test_uses_rig_provider_configuration_and_requires_api_key() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let vault = Arc::new(MemoryCredentialVault::new());
    let credentials = CredentialService::with_vault(vault);
    let service = RigProviderService::new();

    let missing_key_provider = service
        .create_provider(
            state.storage(),
            &credentials,
            LlmProviderCreateRequest {
                name: "缺少 Key".to_string(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                model_list: vec!["gpt-test".to_string()],
                temperature: 0.2,
                context_strategy: LlmContextStrategy::CurrentTerminal,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: false,
                api_key: None,
            },
        )
        .expect("create provider without key");

    let error = service
        .test_provider(state.storage(), &credentials, &missing_key_provider.id)
        .expect_err("reject missing key");
    assert!(error.to_string().contains("API key 未配置"));

    let provider = service
        .create_provider(
            state.storage(),
            &credentials,
            LlmProviderCreateRequest {
                name: "可测试 Provider".to_string(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                model_list: vec!["gpt-test".to_string()],
                temperature: 0.2,
                context_strategy: LlmContextStrategy::CurrentTerminal,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: false,
                api_key: Some("sk-test".to_string()),
            },
        )
        .expect("create provider with key");

    let result = service
        .test_provider(state.storage(), &credentials, &provider.id)
        .expect("dry validate");

    assert!(result.ok);
    assert_eq!(result.mode, "dryRun");
    assert!(result.message.contains("未发送真实 LLM 请求"));
}

#[test]
fn dry_test_accepts_supported_rig_provider_kinds() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let vault = Arc::new(MemoryCredentialVault::new());
    let credentials = CredentialService::with_vault(vault);
    let service = RigProviderService::new();

    let cases = [
        (
            "OpenAI Responses",
            LlmProviderKind::OpenAiResponses,
            "https://api.openai.com/v1",
            "gpt-5.2",
        ),
        (
            "OpenAI Chat",
            LlmProviderKind::OpenAiChat,
            "https://api.openai.com/v1",
            "gpt-4.1-mini",
        ),
        (
            "Anthropic",
            LlmProviderKind::Anthropic,
            "https://api.anthropic.com",
            "claude-sonnet-4-6",
        ),
    ];

    for (name, kind, base_url, model) in cases {
        let provider = service
            .create_provider(
                state.storage(),
                &credentials,
                LlmProviderCreateRequest {
                    name: name.to_string(),
                    kind,
                    base_url: base_url.to_string(),
                    model: model.to_string(),
                    model_list: vec![model.to_string()],
                    temperature: 0.2,
                    context_strategy: LlmContextStrategy::CurrentTerminal,
                    context_window_tokens: 128_000,
                    reasoning_effort: LlmReasoningEffort::ModelDefault,
                    max_retries: 3,
                    user_agent: None,
                    http_proxy: None,
                    enabled: true,
                    is_default: false,
                    api_key: Some("sk-test".to_string()),
                },
            )
            .expect("create provider");

        assert_eq!(provider.kind, kind);

        let result = service
            .test_provider(state.storage(), &credentials, &provider.id)
            .expect("dry validate");

        assert!(result.ok);
        assert_eq!(result.mode, "dryRun");
    }
}

#[test]
fn delete_provider_removes_metadata_and_stored_secret() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let vault = Arc::new(MemoryCredentialVault::new());
    let credentials = CredentialService::with_vault(vault.clone());
    let service = RigProviderService::new();

    let provider = service
        .create_provider(
            state.storage(),
            &credentials,
            LlmProviderCreateRequest {
                name: "待删除 Provider".to_string(),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1".to_string(),
                model: "gpt-test".to_string(),
                model_list: vec!["gpt-test".to_string()],
                temperature: 0.2,
                context_strategy: LlmContextStrategy::CurrentTerminal,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: false,
                api_key: Some("sk-delete".to_string()),
            },
        )
        .expect("create provider");
    let credential_ref = provider
        .api_key_credential_ref
        .clone()
        .expect("credential ref");

    let deleted = service
        .delete_provider(state.storage(), &credentials, &provider.id)
        .expect("delete provider");

    assert!(deleted);
    assert!(!vault.contains(&credential_ref));
    assert!(state
        .storage()
        .llm_provider_by_id(&provider.id)
        .expect("query deleted provider")
        .is_none());
}
