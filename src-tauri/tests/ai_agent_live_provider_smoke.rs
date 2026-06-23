//! 真实 LLM Provider smoke，默认跳过，按需用环境变量启用。
//!
//! @author kongweiguang

use std::{
    fs,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::mpsc,
    time::{Duration, Instant},
};

use kerminal_lib::{
    error::AppResult,
    models::{
        ai_agent::{
            AiApplicationContextRequest, AiApplicationMachineContext, AiApplicationPaneContext,
            AiApplicationTabContext, AiChatAttachmentContext, AiChatRequest,
        },
        ai_agent_run::{AiAgentHarnessRunRequest, AiAgentRunLimits, AiAgentRunStatus},
        ai_context::AiTerminalContextRequest,
        ai_conversation::{
            AiAttachment, AiConversationAttachmentImportBytesRequest, AiConversationCreateRequest,
        },
        ai_tool_invocation::{
            AiToolExecuteIfAllowedRequest, AiToolExecuteIfAllowedResponse, AiToolObservation,
            AiToolObservationStatus,
        },
        llm_provider::{
            LlmContextStrategy, LlmProvider, LlmProviderCreateRequest, LlmProviderKind,
            LlmReasoningEffort,
        },
        terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    paths::KerminalPaths,
    services::{
        ai_agent_harness_rig_model::RigHarnessModel,
        ai_agent_run_service::AiAgentHarnessToolExecutor,
        ai_agent_service::{AiAgentChatContext, AiAgentService},
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
    },
    state::AppState,
};
use tempfile::{tempdir, TempDir};

#[test]
fn live_provider_preflight_reports_configuration_without_external_call() {
    match live_provider_preflight() {
        Ok(report) => eprintln!("{report}"),
        Err(error) => eprintln!("live provider preflight failed before external call: {error}"),
    }
}

#[test]
fn live_configured_provider_matrix_supports_chat_context_and_tools() {
    if std::env::var("KERMINAL_LIVE_LLM_SMOKE").as_deref() != Ok("1") {
        eprintln!("skip live smoke: set KERMINAL_LIVE_LLM_SMOKE=1 to call the configured LLM");
        return;
    }

    let (source, api_key) = load_source_provider_and_key().expect("load source provider and key");
    eprintln!(
        "live smoke source provider: kind={:?}, baseUrl={}, model={}",
        source.kind, source.base_url, source.model
    );

    for kind in live_provider_kinds(source.kind) {
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

#[test]
fn live_configured_provider_accepts_vision_image_input_when_enabled() {
    if std::env::var("KERMINAL_LIVE_LLM_VISION_SMOKE").as_deref() != Ok("1") {
        eprintln!(
            "skip live vision smoke: set KERMINAL_LIVE_LLM_VISION_SMOKE=1 to call the configured LLM with a managed image"
        );
        return;
    }

    let (source, api_key) = load_source_provider_and_key().expect("load source provider and key");
    let kind = live_vision_provider_kind(source.kind);
    let mut capability_provider = source.clone();
    capability_provider.kind = kind;
    if !AiAgentService::provider_supports_vision(&capability_provider) {
        eprintln!(
            "skip live vision smoke: kind={kind:?}, model={} is not marked vision-capable",
            capability_provider.model
        );
        return;
    }

    eprintln!(
        "live vision smoke provider: kind={kind:?}, baseUrl={}, model={}",
        source.base_url, source.model
    );
    let (_home, state, credentials) = temp_state_with_provider(&source, &api_key, kind);
    run_vision_input_smoke(&state, &credentials, kind)
        .unwrap_or_else(|error| panic!("{kind:?} vision smoke failed: {error}"));
}

#[test]
fn live_configured_provider_drives_minimal_harness_loop_when_enabled() {
    if std::env::var("KERMINAL_LIVE_LLM_HARNESS_SMOKE").as_deref() != Ok("1") {
        eprintln!(
            "skip live harness smoke: set KERMINAL_LIVE_LLM_HARNESS_SMOKE=1 to call the configured LLM"
        );
        return;
    }

    let (source, api_key) = load_source_provider_and_key().expect("load source provider and key");
    let kind = live_provider_kinds(source.kind)
        .into_iter()
        .next()
        .unwrap_or(source.kind);
    let (_home, state, _credentials) = temp_state_with_provider(&source, &api_key, kind);
    let mut provider = source.clone();
    provider.kind = kind;
    provider.temperature = 0.0;
    provider.max_retries = 0;
    let model = RigHarnessModel::new(provider, api_key, state.tools().list_tools());
    let tools = HarnessSmokeToolExecutor;

    let result = tauri::async_runtime::block_on(state.ai_agent_runs().run_harness(
        AiAgentHarnessRunRequest {
            goal: "必须先调用 terminal.list 工具，然后根据 observation 用一句中文回答当前终端数量。"
                .to_owned(),
            limits: AiAgentRunLimits {
                max_iterations: Some(6),
                max_tool_calls: Some(2),
            },
            conversation_id: Some("live-harness-smoke".to_owned()),
            conversation_slot_json: None,
        },
        &model,
        &tools,
    ))
    .expect("run harness smoke");

    assert_eq!(result.snapshot.run.status, AiAgentRunStatus::Completed);
    assert!(
        result
            .snapshot
            .steps
            .iter()
            .any(|step| step.tool_id.as_deref() == Some("terminal.list")),
        "harness should call terminal.list before final answer"
    );
    assert!(
        result
            .final_message
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
        "harness should produce final message"
    );
}

fn load_source_provider_and_key() -> AppResult<(LlmProvider, String)> {
    let source_state = AppState::initialize_with_paths(KerminalPaths::from_current_home()?)?;
    let source_credentials = CredentialService::new();
    let providers = source_state
        .rig_providers()
        .list_providers(source_state.storage())?;
    let provider_id = std::env::var("KERMINAL_LIVE_LLM_SOURCE_PROVIDER_ID").ok();
    let provider = select_live_source_provider(&providers, provider_id.as_deref())
        .cloned()
        .ok_or_else(|| {
            kerminal_lib::error::AppError::InvalidInput(
                "没有找到启用的 LLM Provider；可设置 KERMINAL_LIVE_LLM_SOURCE_PROVIDER_ID"
                    .to_owned(),
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

fn live_provider_preflight() -> AppResult<String> {
    let source_state = AppState::initialize_with_paths(KerminalPaths::from_current_home()?)?;
    let source_credentials = CredentialService::new();
    let providers = source_state
        .rig_providers()
        .list_providers(source_state.storage())?;
    let source_provider_id = std::env::var("KERMINAL_LIVE_LLM_SOURCE_PROVIDER_ID").ok();
    let selected = select_live_source_provider(&providers, source_provider_id.as_deref());
    let smoke_enabled = std::env::var("KERMINAL_LIVE_LLM_SMOKE").as_deref() == Ok("1");
    let vision_smoke_enabled =
        std::env::var("KERMINAL_LIVE_LLM_VISION_SMOKE").as_deref() == Ok("1");
    let harness_smoke_enabled =
        std::env::var("KERMINAL_LIVE_LLM_HARNESS_SMOKE").as_deref() == Ok("1");
    let mut lines = vec![
        "AI live provider preflight: no external LLM request was made.".to_owned(),
        format!("configuredProviders={}", providers.len()),
        format!("chatToolSmokeEnabled={smoke_enabled}"),
        format!("visionSmokeEnabled={vision_smoke_enabled}"),
        format!("harnessSmokeEnabled={harness_smoke_enabled}"),
    ];
    if let Some(provider) = selected {
        let vision_kind = parse_live_vision_provider_kind(provider.kind).unwrap_or_else(|error| {
            panic!("parse KERMINAL_LIVE_LLM_VISION_PROVIDER_KIND: {error}")
        });
        let mut vision_provider = provider.clone();
        vision_provider.kind = vision_kind;
        let credential_secret_available = provider
            .api_key_credential_ref
            .as_deref()
            .and_then(|credential_ref| source_credentials.get_secret(credential_ref).ok())
            .flatten()
            .is_some();
        lines.push(format!("selectedProviderId={}", provider.id));
        lines.push(format!(
            "providerSelection={}",
            if source_provider_id.is_some() {
                "KERMINAL_LIVE_LLM_SOURCE_PROVIDER_ID"
            } else {
                "enabled-default"
            }
        ));
        lines.push(format!("selectedProviderKind={:?}", provider.kind));
        lines.push(format!(
            "selectedBaseUrlHost={}",
            safe_base_url_host(&provider.base_url)
        ));
        lines.push(format!("selectedModel={}", provider.model));
        lines.push(format!("selectedEnabled={}", provider.enabled));
        lines.push(format!("selectedDefault={}", provider.is_default));
        lines.push(format!(
            "apiKeyReferenceConfigured={}",
            provider.api_key_credential_ref.is_some()
        ));
        lines.push(format!("apiKeyConfigured={}", provider.api_key_configured));
        lines.push(format!(
            "apiKeySecretAvailable={credential_secret_available}"
        ));
        match parse_live_provider_kinds(provider.kind) {
            Ok(kinds) => lines.push(format!("providerMatrixKinds={kinds:?}")),
            Err(error) => lines.push(format!("providerMatrixKinds=parse-error: {error}")),
        }
        lines.push(format!("visionProviderKind={vision_kind:?}"));
        lines.push(format!(
            "visionCapable={}",
            AiAgentService::provider_supports_vision(&vision_provider)
        ));
        lines.push(format!(
            "visionImagePathConfigured={}",
            std::env::var("KERMINAL_LIVE_LLM_VISION_IMAGE_PATH")
                .ok()
                .is_some_and(|value| !value.trim().is_empty())
        ));
        lines.push(format!("visionImageSource={}", vision_image_source_label()));
    } else if source_provider_id.is_some() {
        lines.push("selectedProvider=missing-source-provider-id".to_owned());
    } else {
        lines.push("selectedProvider=none-enabled".to_owned());
    }
    Ok(lines.join("\n"))
}

fn select_live_source_provider<'a>(
    providers: &'a [LlmProvider],
    provider_id: Option<&str>,
) -> Option<&'a LlmProvider> {
    if let Some(provider_id) = provider_id {
        providers.iter().find(|provider| provider.id == provider_id)
    } else {
        providers
            .iter()
            .find(|provider| provider.enabled && provider.is_default)
            .or_else(|| providers.iter().find(|provider| provider.enabled))
    }
}

fn live_provider_kinds(default_kind: LlmProviderKind) -> Vec<LlmProviderKind> {
    parse_live_provider_kinds(default_kind).expect("parse KERMINAL_LIVE_LLM_PROVIDER_KINDS")
}

fn parse_live_provider_kinds(
    default_kind: LlmProviderKind,
) -> Result<Vec<LlmProviderKind>, String> {
    let Ok(raw) = std::env::var("KERMINAL_LIVE_LLM_PROVIDER_KINDS") else {
        return Ok(vec![default_kind]);
    };
    let kinds = raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| parse_live_provider_kind(value, default_kind))
        .collect::<Result<Vec<_>, _>>()?;
    if kinds.is_empty() {
        Ok(vec![default_kind])
    } else {
        Ok(kinds)
    }
}

fn live_vision_provider_kind(default_kind: LlmProviderKind) -> LlmProviderKind {
    parse_live_vision_provider_kind(default_kind)
        .expect("parse KERMINAL_LIVE_LLM_VISION_PROVIDER_KIND")
}

fn parse_live_vision_provider_kind(
    default_kind: LlmProviderKind,
) -> Result<LlmProviderKind, String> {
    std::env::var("KERMINAL_LIVE_LLM_VISION_PROVIDER_KIND")
        .ok()
        .as_deref()
        .map(|value| parse_live_provider_kind(value, default_kind))
        .transpose()
        .map(|kind| kind.unwrap_or(default_kind))
}

fn parse_live_provider_kind(
    value: &str,
    default_kind: LlmProviderKind,
) -> Result<LlmProviderKind, String> {
    match value
        .trim()
        .replace(['-', ' '], "_")
        .to_ascii_lowercase()
        .as_str()
    {
        "source" | "default" => Ok(default_kind),
        "openai_responses" | "openairesponses" | "responses" => {
            Ok(LlmProviderKind::OpenAiResponses)
        }
        "openai_chat" | "openaichat" | "chat" | "openai_compatible" => {
            Ok(LlmProviderKind::OpenAiChat)
        }
        "anthropic" | "claude" => Ok(LlmProviderKind::Anthropic),
        other => Err(format!(
            "未知 live smoke provider kind: {other}; 支持 source, openai_responses, openai_chat, anthropic"
        )),
    }
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
        terminal_session_bindings: state.terminal_session_bindings(),

        tools: state.tools(),
        mcp_tools: state.mcp_tools(),
        settings: state.settings(),
        paths: state.paths(),
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
            conversation_slot_json: None,
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
            attachments: Vec::new(),
            history: Vec::new(),
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

fn run_vision_input_smoke(
    state: &AppState,
    credentials: &CredentialService,
    kind: LlmProviderKind,
) -> AppResult<()> {
    let service = AiAgentService::new();
    let conversation_id = create_conversation(state)?;
    let attachment = import_image_attachment(state, &conversation_id)?;
    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(state, credentials),
        AiChatRequest {
            application_context: Some(app_context_request("live-vision-session")),
            message: "请确认你收到了随消息附带的图片；只用一句中文回答，不要调用工具。".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))?;

    assert!(
        response.vision_usage.provider_supports_vision,
        "{kind:?} vision smoke should only run for vision-capable providers"
    );
    assert!(
        !response.message.trim().is_empty(),
        "{kind:?} vision smoke should return a message"
    );
    let status = response
        .vision_usage
        .attachments
        .first()
        .expect("vision status");
    assert_eq!(status.requested_usage, "visionInput");
    assert_eq!(status.effective_usage, "visionInput");
    assert_eq!(status.model_input, "visionInput");
    assert_eq!(status.warning, None);
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
            conversation_slot_json: None,
            provider_id: None,
            terminal_context: None,
            execution_visibility: None,
            attachments: Vec::new(),
            history: Vec::new(),
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

struct HarnessSmokeToolExecutor;

impl AiAgentHarnessToolExecutor for HarnessSmokeToolExecutor {
    fn execute_tool<'a>(
        &'a self,
        request: AiToolExecuteIfAllowedRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiToolExecuteIfAllowedResponse>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(request.tool_id, "terminal.list");
            Ok(AiToolExecuteIfAllowedResponse {
                observation: AiToolObservation {
                    status: AiToolObservationStatus::Succeeded,
                    summary: Some("找到 0 个终端会话".to_owned()),
                    data: serde_json::json!({
                        "sessionCount": 0,
                        "sessions": [],
                    }),
                    entities: Vec::new(),
                    recoverable: false,
                    error_kind: None,
                    next_hints: Vec::new(),
                    pending_invocation_id: None,
                    audit_id: Some("live-harness-terminal-list".to_owned()),
                },
                pending_invocation: None,
                audit: None,
            })
        })
    }
}

fn create_conversation(state: &AppState) -> AppResult<String> {
    Ok(state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                title: Some("Live vision smoke".to_owned()),
                scope_kind: "noContext".to_owned(),
                scope_ref_json: Some("{}".to_owned()),
                target_key: None,
                host_id: None,
                tab_id: None,
                pane_id: None,
                provider_id: None,
                model: None,
            },
        )?
        .id)
}

fn import_image_attachment(state: &AppState, conversation_id: &str) -> AppResult<AiAttachment> {
    let image = load_vision_smoke_image()?;
    state.ai_conversations().import_image_attachment_bytes(
        state.storage(),
        state.paths(),
        AiConversationAttachmentImportBytesRequest {
            conversation_id: conversation_id.to_owned(),
            original_name: Some(image.original_name),
            bytes: image.bytes,
            source_kind: Some("live-smoke".to_owned()),
            vision_usage: Some("visionInput".to_owned()),
        },
    )
}

struct VisionSmokeImage {
    original_name: String,
    bytes: Vec<u8>,
}

fn load_vision_smoke_image() -> AppResult<VisionSmokeImage> {
    let Some(path) = std::env::var("KERMINAL_LIVE_LLM_VISION_IMAGE_PATH")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    else {
        return Ok(VisionSmokeImage {
            original_name: "live-vision-smoke.png".to_owned(),
            bytes: tiny_png().to_vec(),
        });
    };
    let original_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("live-vision-smoke.png")
        .to_owned();
    let bytes = fs::read(&path)?;
    Ok(VisionSmokeImage {
        original_name,
        bytes,
    })
}

fn safe_base_url_host(base_url: &str) -> String {
    let value = base_url.trim();
    if let Some((scheme, rest)) = value.split_once("://") {
        let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        if !scheme.is_empty() && !host.is_empty() {
            return format!("{scheme}://{host}");
        }
    }
    "<invalid-url>".to_owned()
}

fn vision_image_source_label() -> &'static str {
    if std::env::var("KERMINAL_LIVE_LLM_VISION_IMAGE_PATH")
        .ok()
        .is_some_and(|value| !value.trim().is_empty())
    {
        "custom-file"
    } else {
        "builtin-tiny-png"
    }
}

fn chat_attachment(attachment: &AiAttachment, vision_usage: &str) -> AiChatAttachmentContext {
    AiChatAttachmentContext {
        height: attachment.height.and_then(|value| value.try_into().ok()),
        id: attachment.id.clone(),
        kind: attachment.kind.clone(),
        mime_type: attachment.mime_type.clone(),
        missing_reason: attachment.missing_reason.clone(),
        ocr_text: attachment.ocr_text.clone(),
        original_name: attachment.original_name.clone(),
        redaction_summary: attachment.redaction_summary.clone(),
        size_bytes: u64::try_from(attachment.size_bytes).unwrap_or_default(),
        status: attachment.status.clone(),
        vision_usage: Some(vision_usage.to_owned()),
        width: attachment.width.and_then(|value| value.try_into().ok()),
    }
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

fn tiny_png() -> &'static [u8] {
    &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
        251, 3, 253, 160, 105, 45, 164, 0, 0, 0, 0, 73, 69, 68, 174, 66, 96, 130,
    ]
}
