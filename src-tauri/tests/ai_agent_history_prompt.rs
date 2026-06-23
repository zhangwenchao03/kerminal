//! Kerminal Agent 结构化会话历史 prompt 测试。
//!
//! @author kongweiguang

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use kerminal_lib::{
    error::AppResult,
    models::{
        ai_agent::{AiChatHistoryMessage, AiChatRequest},
        llm_provider::{
            LlmContextStrategy, LlmProviderCreateRequest, LlmProviderKind, LlmReasoningEffort,
        },
    },
    paths::KerminalPaths,
    services::{
        ai_agent_service::{
            AiAgentChatContext, AiAgentService, AiChatExecutionRequest, AiChatExecutionResponse,
            AiChatExecutor,
        },
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
    },
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[derive(Debug)]
struct RecordingExecutor {
    requests: Mutex<Vec<AiChatExecutionRequest>>,
}

impl RecordingExecutor {
    fn requests(&self) -> Vec<AiChatExecutionRequest> {
        self.requests.lock().expect("executor requests").clone()
    }
}

impl AiChatExecutor for RecordingExecutor {
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>> {
        self.requests
            .lock()
            .expect("executor requests")
            .push(request);
        Box::pin(async move {
            Ok(AiChatExecutionResponse {
                message: "已继续会话。".to_owned(),
                pending_invocations: Vec::new(),
            })
        })
    }
}

#[test]
fn chat_assembles_structured_history_before_provider_prompt() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    create_provider(&state, &credentials);
    let executor = Arc::new(RecordingExecutor {
        requests: Mutex::new(Vec::new()),
    });
    let service = AiAgentService::with_executor(executor.clone());

    tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            attachments: Vec::new(),
            conversation_id: Some("conv-history".to_owned()),
            conversation_slot_json: None,
            execution_visibility: None,
            history: vec![
                AiChatHistoryMessage {
                    content: "帮我解释当前输出".to_owned(),
                    role: "user".to_owned(),
                },
                AiChatHistoryMessage {
                    content: "第一条回复。".to_owned(),
                    role: "assistant".to_owned(),
                },
            ],
            message: "继续给下一步".to_owned(),
            provider_id: None,
            terminal_context: None,
        },
    ))
    .expect("chat response");

    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    let prompt = &requests[0].prompt;
    assert!(prompt.contains("<history>"));
    assert!(prompt.contains("用户: 帮我解释当前输出"));
    assert!(prompt.contains("AI: 第一条回复。"));
    assert!(prompt.contains("用户最新问题:\n继续给下一步"));
    assert!(!prompt.contains("sk-history"));
}

fn setup_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    (home, state)
}

fn memory_credentials() -> CredentialService {
    CredentialService::with_vault(Arc::new(MemoryCredentialVault::new()))
}

fn chat_context<'a>(
    state: &'a AppState,
    credentials: &'a CredentialService,
) -> AiAgentChatContext<'a> {
    AiAgentChatContext {
        storage: state.storage(),
        credentials,
        ai_context: state.ai_context(),
        ai_tools: state.ai_tools(),
        terminals: state.terminals(),
        terminal_session_bindings: state.terminal_session_bindings(),

        tools: state.tools(),
        mcp_tools: state.mcp_tools(),
        settings: state.settings(),
        paths: state.paths(),
    }
}

fn create_provider(state: &AppState, credentials: &CredentialService) {
    RigProviderService::new()
        .create_provider(
            state.storage(),
            credentials,
            LlmProviderCreateRequest {
                api_key: Some("sk-history".to_owned()),
                base_url: "https://api.example.com/v1".to_owned(),
                context_strategy: LlmContextStrategy::Minimal,
                context_window_tokens: 128_000,
                enabled: true,
                http_proxy: None,
                is_default: true,
                kind: LlmProviderKind::OpenAiChat,
                max_retries: 1,
                model: "gpt-test".to_owned(),
                model_list: vec!["gpt-test".to_owned()],
                name: "History Provider".to_owned(),
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                temperature: 0.2,
                user_agent: None,
            },
        )
        .expect("create provider");
}
