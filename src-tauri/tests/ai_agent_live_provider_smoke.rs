//! 真实 LLM Provider smoke，默认跳过，按需用环境变量启用。
//!
//! @author kongweiguang

use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

use kerminal_lib::{
    error::AppResult,
    models::{
        ai_agent::{
            AiApplicationContextRequest, AiApplicationMachineContext, AiApplicationPaneContext,
            AiApplicationTabContext, AiChatRequest,
        },
        ai_context::AiTerminalContextRequest,
        llm_provider::{
            LlmContextStrategy, LlmProvider, LlmProviderCreateRequest, LlmProviderKind,
            LlmReasoningEffort,
        },
        terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    paths::KerminalPaths,
    services::{
        ai_agent_service::{AiAgentChatContext, AiAgentService},
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
    },
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn live_current_provider_supports_responses_and_anthropic_chat_context_and_tools() {
    if std::env::var("KERMINAL_LIVE_LLM_SMOKE").as_deref() != Ok("1") {
        eprintln!("skip live smoke: set KERMINAL_LIVE_LLM_SMOKE=1 to call the configured LLM");
        return;
    }

    let (source, api_key) = load_source_provider_and_key().expect("load source provider and key");
    eprintln!(
        "live smoke source provider: kind={:?}, baseUrl={}, model={}",
        source.kind, source.base_url, source.model
    );

    for kind in [LlmProviderKind::OpenAiResponses, LlmProviderKind::Anthropic] {
        eprintln!("live smoke kind={kind:?}: context chat");
        let (_home, state, credentials) = temp_state_with_provider(&source, &api_key, kind);
        run_context_chat_smoke(&state, &credentials, kind)
            .unwrap_or_else(|error| panic!("{kind:?} context chat smoke failed: {error}"));

        eprintln!("live smoke kind={kind:?}: tool call");
        let (_home, state, credentials) = temp_state_with_provider(&source, &api_key, kind);
        run_tool_call_smoke(&state, &credentials, kind)
            .unwrap_or_else(|error| panic!("{kind:?} tool call smoke failed: {error}"));
    }
}

fn load_source_provider_and_key() -> AppResult<(LlmProvider, String)> {
    let source_state = AppState::initialize_with_paths(KerminalPaths::from_current_home()?)?;
    let source_credentials = CredentialService::new();
    let providers = source_state
        .rig_providers()
        .list_providers(source_state.storage())?;
    let provider_id = std::env::var("KERMINAL_LIVE_LLM_SOURCE_PROVIDER_ID").ok();
    let provider = if let Some(provider_id) = provider_id.as_deref() {
        providers
            .iter()
            .find(|provider| provider.id == provider_id)
            .cloned()
    } else {
        providers
            .iter()
            .find(|provider| provider.enabled && provider.is_default)
            .or_else(|| providers.iter().find(|provider| provider.enabled))
            .cloned()
    }
    .ok_or_else(|| {
        kerminal_lib::error::AppError::InvalidInput(
            "没有找到启用的 LLM Provider；可设置 KERMINAL_LIVE_LLM_SOURCE_PROVIDER_ID".to_owned(),
        )
    })?;
    let credential_ref = provider.api_key_credential_ref.as_deref().ok_or_else(|| {
        kerminal_lib::error::AppError::InvalidInput("源 Provider 未配置 API key".to_owned())
    })?;
    let api_key = source_credentials
        .get_secret(credential_ref)?
        .ok_or_else(|| kerminal_lib::error::AppError::InvalidInput("API key 未配置".to_owned()))?;
    Ok((provider, api_key))
}

fn temp_state_with_provider(
    source: &LlmProvider,
    api_key: &str,
    kind: LlmProviderKind,
) -> (TempDir, AppState, CredentialService) {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize temp state");
    let credentials =
        CredentialService::with_vault(std::sync::Arc::new(MemoryCredentialVault::new()));
    RigProviderService::new()
        .create_provider(
            state.storage(),
            &credentials,
            LlmProviderCreateRequest {
                name: format!("live smoke {kind:?}"),
                kind,
                base_url: source.base_url.clone(),
                model: source.model.clone(),
                model_list: vec![source.model.clone()],
                temperature: 0.0,
                context_strategy: LlmContextStrategy::CurrentTerminal,
                context_window_tokens: source.context_window_tokens,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 0,
                user_agent: source.user_agent.clone(),
                http_proxy: source.http_proxy.clone(),
                enabled: true,
                is_default: true,
                api_key: Some(api_key.to_owned()),
            },
        )
        .expect("create temp provider");
    (home, state, credentials)
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
        tools: state.tools(),
        mcp_tools: state.mcp_tools(),
        settings: state.settings(),
    }
}

fn run_context_chat_smoke(
    state: &AppState,
    credentials: &CredentialService,
    kind: LlmProviderKind,
) -> AppResult<()> {
    let service = AiAgentService::new();
    let (sender, receiver) = mpsc::channel();
    let session = state
        .terminals()
        .create_session(context_output_request(), move |event| {
            sender.send(event).is_ok()
        })?;
    wait_for_output(
        state.terminals(),
        &session.id,
        &receiver,
        "kerminal-live-context",
    );

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(state, credentials),
        AiChatRequest {
            application_context: Some(app_context_request(&session.id)),
            message: "请基于当前终端上下文，用一句中文说明你看到了 kerminal-live-context；不要调用工具。"
                .to_owned(),
            conversation_id: None,
            provider_id: None,
            terminal_context: Some(AiTerminalContextRequest {
                session_id: session.id.clone(),
                pane_id: Some("pane-live".to_owned()),
                pane_title: Some("Live smoke pane".to_owned()),
                tab_id: Some("tab-live".to_owned()),
                tab_title: Some("Live smoke tab".to_owned()),
                machine_id: Some("local".to_owned()),
                machine_name: Some("Local".to_owned()),
                machine_kind: Some("local".to_owned()),
                max_output_bytes: Some(4096),
            }),
            execution_visibility: None,
        },
    ));
    state.terminals().close(&session.id)?;
    let response = response?;

    assert!(
        response.context_used,
        "{kind:?} response should report terminal context usage"
    );
    assert!(
        response.pending_invocations.is_empty(),
        "{kind:?} context chat should not create tool calls"
    );
    assert!(
        !response.message.trim().is_empty(),
        "{kind:?} context chat should return a message"
    );
    Ok(())
}

fn run_tool_call_smoke(
    state: &AppState,
    credentials: &CredentialService,
    kind: LlmProviderKind,
) -> AppResult<()> {
    let service = AiAgentService::new();
    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(state, credentials),
        AiChatRequest {
            application_context: Some(app_context_request("live-tool-session")),
            message: "必须使用标准 tool-call 调用 Kerminal id settings.get 读取当前设置；不要直接回答。"
                .to_owned(),
            conversation_id: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
        },
    ))?;

    assert!(
        response
            .pending_invocations
            .iter()
            .any(|invocation| invocation.tool_id == "settings.get"),
        "{kind:?} should create a pending settings.get invocation, got {:?}",
        response
            .pending_invocations
            .iter()
            .map(|invocation| invocation.tool_id.as_str())
            .collect::<Vec<_>>()
    );
    Ok(())
}

fn app_context_request(session_id: &str) -> AiApplicationContextRequest {
    AiApplicationContextRequest {
        active_tool_id: Some("ai".to_owned()),
        active_tab: Some(AiApplicationTabContext {
            id: "tab-live".to_owned(),
            title: "Live smoke tab".to_owned(),
            machine_id: Some("local".to_owned()),
        }),
        focused_pane: Some(AiApplicationPaneContext {
            id: "pane-live".to_owned(),
            title: "Live smoke pane".to_owned(),
            mode: "local".to_owned(),
            status: "online".to_owned(),
            machine_id: Some("local".to_owned()),
            session_id: Some(session_id.to_owned()),
        }),
        selected_machine: Some(AiApplicationMachineContext {
            id: "local".to_owned(),
            name: "Local".to_owned(),
            kind: "local".to_owned(),
            status: "online".to_owned(),
            production: Some(false),
        }),
    }
}

fn wait_for_output(
    manager: &kerminal_lib::services::terminal_manager::TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }

        if received.contains(expected) {
            return;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

#[cfg(target_os = "windows")]
fn context_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/C".to_owned(), "echo kerminal-live-context".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn context_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf 'kerminal-live-context\\n'".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}
