//! Kerminal Agent provider vision adapter 集成测试。
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
        ai_agent::{AiChatAttachmentContext, AiChatRequest},
        ai_conversation::{
            AiAttachment, AiAttachmentInput, AiConversationAttachmentAddRequest,
            AiConversationAttachmentImportBytesRequest, AiConversationCreateRequest,
        },
        ai_tool_invocation::{
            AiToolAuditContext, AiToolConfirmRequest, AiToolInvocationStatus, AiToolPrepareRequest,
        },
        llm_provider::{
            LlmContextStrategy, LlmProvider, LlmProviderCreateRequest, LlmProviderKind,
            LlmReasoningEffort,
        },
        remote_host::RemoteHostAuthType,
    },
    paths::KerminalPaths,
    services::{
        ai_agent_service::{
            AiAgentChatContext, AiAgentService, AiChatExecutionRequest, AiChatExecutionResponse,
            AiChatExecutor,
        },
        ai_tool_invocation_service::AiToolExecutionContext,
        credential_service::{CredentialService, MemoryCredentialVault},
        rig_provider_service::RigProviderService,
    },
    state::AppState,
};
use rig_core::message::ImageMediaType;
use serde_json::json;
use tempfile::{tempdir, TempDir};

#[derive(Debug)]
struct RecordingExecutor {
    requests: Mutex<Vec<AiChatExecutionRequest>>,
    response: AiChatExecutionResponse,
}

impl RecordingExecutor {
    fn new(response: impl Into<String>) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            response: AiChatExecutionResponse {
                message: response.into(),
                pending_invocations: Vec::new(),
            },
        }
    }

    fn requests(&self) -> Vec<AiChatExecutionRequest> {
        self.requests.lock().expect("executor requests").clone()
    }
}

impl AiChatExecutor for RecordingExecutor {
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>> {
        let response = self.response.clone();
        self.requests
            .lock()
            .expect("executor requests")
            .push(request);
        Box::pin(async move { Ok(response) })
    }
}

#[derive(Debug)]
struct VisionRemoteHostExecutor;

impl AiChatExecutor for VisionRemoteHostExecutor {
    fn execute<'a>(
        &'a self,
        request: AiChatExecutionRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<AiChatExecutionResponse>> + Send + 'a>> {
        Box::pin(async move {
            assert_eq!(request.vision_inputs.len(), 1);
            assert!(request.context.contains("本次图片像素进入模型：1 个"));
            assert!(request.context.contains("remote_host.create"));

            let pending = request.ai_tools.prepare_with_ai_policy(
                &request.tool_definitions,
                &request.ai_policy,
                AiToolPrepareRequest {
                    tool_id: "remote_host.create".to_owned(),
                    arguments: json!({
                        "authType": "agent",
                        "host": "prod.example.com",
                        "name": "Vision prod.example.com",
                        "port": 2200,
                        "production": true,
                        "tags": ["vision", "ai"],
                        "username": "deploy"
                    }),
                    requested_by: Some("kerminal-agent".to_owned()),
                    reason: Some(
                        "视觉模型从用户图片中识别到 SSH 连接方式，创建前必须等待用户确认。"
                            .to_owned(),
                    ),
                    conversation_id: Some(request.conversation_id.clone()),
                    conversation_slot_json: request.conversation_slot_json.clone(),
                    run_id: None,
                    step_id: None,
                },
            )?;

            Ok(AiChatExecutionResponse {
                message: "我从图片中识别到 SSH 连接方式，已生成待确认的远程主机创建操作。"
                    .to_owned(),
                pending_invocations: vec![pending],
            })
        })
    }
}

#[test]
fn vision_capable_provider_sends_persisted_managed_image_pixels() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let conversation_id = create_conversation(&state);
    let attachment = import_png_attachment(&state, &conversation_id);
    let executor = Arc::new(RecordingExecutor::new("已读取图片。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "这张图里有什么？".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    assert!(response.vision_usage.provider_supports_vision);
    assert!(response.vision_usage.vision_adapter_enabled);
    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.requested_usage, "visionInput");
    assert_eq!(status.effective_usage, "visionInput");
    assert_eq!(status.model_input, "visionInput");
    assert_eq!(status.warning, None);

    let requests = executor.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].vision_inputs.len(), 1);
    let vision_input = &requests[0].vision_inputs[0];
    assert_eq!(vision_input.id, attachment.id);
    assert_eq!(vision_input.mime_type, "image/png");
    assert_eq!(vision_input.media_type, ImageMediaType::PNG);
    assert_eq!(vision_input.bytes, tiny_png());
    assert!(requests[0].context.contains("本次图片像素进入模型：1 个"));
    assert!(requests[0]
        .context
        .contains("effectiveVisionUsage visionInput"));
}

#[test]
fn vision_image_can_propose_and_confirm_remote_host_create() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let conversation_id = create_conversation(&state);
    let conversation_slot_json =
        r#"{"slotKey":"host:prod.example.com","routeMode":"followWorkspaceTarget"}"#.to_owned();
    let attachment = import_png_attachment(&state, &conversation_id);
    let service = AiAgentService::with_executor(Arc::new(VisionRemoteHostExecutor));

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "图片里有 SSH 登录方式，帮我加到左侧栏主机列表。".to_owned(),
            conversation_id: Some(conversation_id.clone()),
            conversation_slot_json: Some(conversation_slot_json.clone()),
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    assert_eq!(response.pending_invocations.len(), 1);
    let pending = &response.pending_invocations[0];
    assert_eq!(pending.tool_id, "remote_host.create");
    assert_eq!(
        pending.conversation_id.as_deref(),
        Some(conversation_id.as_str())
    );
    assert_eq!(
        pending.conversation_slot_json.as_deref(),
        Some(conversation_slot_json.as_str())
    );
    assert!(pending.requires_confirmation);
    assert!(pending.arguments_summary.contains("host=prod.example.com"));
    assert!(pending.arguments_summary.contains("port=2200"));
    assert!(pending
        .reason
        .as_deref()
        .is_some_and(|reason| reason.contains("等待用户确认")));
    let (stored_pending, _) = state
        .storage()
        .ai_tool_pending_state(&pending.id)
        .expect("load persisted pending")
        .expect("pending is persisted");
    assert_eq!(
        stored_pending.conversation_id.as_deref(),
        Some(conversation_id.as_str())
    );
    assert_eq!(
        stored_pending.conversation_slot_json.as_deref(),
        Some(conversation_slot_json.as_str())
    );

    let audit_context = AiToolAuditContext {
        conversation_id: Some(conversation_id),
        run_id: None,
        step_id: None,
        user_message_id: Some("msg-user-vision-ssh".to_owned()),
        assistant_message_id: Some("msg-assistant-vision-tool".to_owned()),
        context_snapshot_id: None,
        scope_kind: Some("lockedHost".to_owned()),
        scope_ref_json: Some("{\"source\":\"vision-image\"}".to_owned()),
        target_key: Some("host:prod.example.com".to_owned()),
        host_id: None,
        tab_id: None,
        pane_id: None,
        route_mode: Some("followWorkspaceTarget".to_owned()),
        target_ref_json: Some("{\"kind\":\"imageAttachment\"}".to_owned()),
        attachment_ids: vec![attachment.id],
    };
    let audit = state
        .ai_tools()
        .confirm(
            ai_tool_execution_context(&state),
            AiToolConfirmRequest {
                invocation_id: pending.id.clone(),
                approved: true,
                audit_context: Some(audit_context.clone()),
            },
        )
        .expect("confirm remote host create");

    assert_eq!(audit.status, AiToolInvocationStatus::Succeeded);
    assert_eq!(audit.tool_id, "remote_host.create");
    assert_eq!(audit.audit_context.as_ref(), Some(&audit_context));
    assert!(audit
        .result_summary
        .as_deref()
        .is_some_and(|summary| summary.contains("deploy@prod.example.com:2200")));

    let tree = state
        .remote_hosts()
        .list_tree(state.storage())
        .expect("list remote host tree");
    let created = tree
        .iter()
        .flat_map(|group| group.hosts.iter())
        .find(|host| host.name == "Vision prod.example.com")
        .expect("created remote host from vision suggestion");
    assert_eq!(created.host, "prod.example.com");
    assert_eq!(created.port, 2200);
    assert_eq!(created.username, "deploy");
    assert_eq!(created.auth_type, RemoteHostAuthType::Agent);
    assert_eq!(created.tags, vec!["vision", "ai"]);
    assert!(created.production);
}

#[test]
fn unsupported_provider_downgrades_without_reading_image_pixels() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-test");
    let conversation_id = create_conversation(&state);
    let attachment = import_png_attachment(&state, &conversation_id);
    let executor = Arc::new(RecordingExecutor::new("已按文本上下文处理。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "这个 provider 能看图片吗？".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    assert!(!response.vision_usage.provider_supports_vision);
    assert!(!response.vision_usage.vision_adapter_enabled);
    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.effective_usage, "metadataOnly");
    assert_eq!(status.model_input, "textContext");
    assert!(status
        .warning
        .as_deref()
        .is_some_and(|warning| warning.contains("Provider 未标记为支持视觉")));
    assert!(executor.requests()[0].vision_inputs.is_empty());
}

#[test]
fn missing_managed_asset_downgrades_without_failing_chat() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let conversation_id = create_conversation(&state);
    let attachment = import_png_attachment(&state, &conversation_id);
    let asset_path = state
        .paths()
        .root
        .join(attachment.asset_path.as_deref().expect("asset path"));
    std::fs::remove_file(asset_path).expect("remove managed image");
    let executor = Arc::new(RecordingExecutor::new("已降级处理。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "图片还在吗？".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.effective_usage, "metadataOnly");
    assert_eq!(status.model_input, "textContext");
    assert!(status
        .warning
        .as_deref()
        .is_some_and(|warning| warning.contains("图片文件不存在或无法访问")));
    assert!(executor.requests()[0].vision_inputs.is_empty());
}

#[test]
fn outside_scope_managed_asset_path_is_not_sent_to_provider() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let conversation_id = create_conversation(&state);
    let attachment = state
        .ai_conversations()
        .add_attachment_metadata(
            state.storage(),
            AiConversationAttachmentAddRequest {
                conversation_id: conversation_id.clone(),
                attachment: AiAttachmentInput {
                    kind: "image".to_owned(),
                    storage_mode: "managedCopy".to_owned(),
                    source_kind: Some("picker".to_owned()),
                    mime_type: "image/png".to_owned(),
                    original_name: "outside.png".to_owned(),
                    original_path: None,
                    asset_path: Some("../outside.png".to_owned()),
                    thumbnail_path: None,
                    sha256: None,
                    width: Some(1),
                    height: Some(1),
                    size_bytes: tiny_png().len() as i64,
                    ocr_text: None,
                    status: Some("available".to_owned()),
                    missing_reason: None,
                    vision_usage: Some("visionInput".to_owned()),
                    redaction_summary: None,
                },
            },
        )
        .expect("insert bad attachment metadata");
    let executor = Arc::new(RecordingExecutor::new("已拒绝越界路径。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "尝试读取这张图".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.effective_usage, "metadataOnly");
    assert!(status
        .warning
        .as_deref()
        .is_some_and(|warning| warning.contains("受管附件路径越界")));
    assert!(executor.requests()[0].vision_inputs.is_empty());
}

#[test]
fn cross_conversation_attachment_id_is_not_sent_to_provider() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let owner_conversation_id = create_conversation(&state);
    let active_conversation_id = create_conversation(&state);
    let attachment = import_png_attachment(&state, &owner_conversation_id);
    let executor = Arc::new(RecordingExecutor::new("已拒绝跨会话图片。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "尝试读取另一条会话的图片".to_owned(),
            conversation_id: Some(active_conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.effective_usage, "metadataOnly");
    assert!(status
        .warning
        .as_deref()
        .is_some_and(|warning| warning.contains("附件不属于当前 AI 会话")));
    assert!(executor.requests()[0].vision_inputs.is_empty());
}

#[test]
fn linked_file_attachment_is_not_sent_to_provider() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let conversation_id = create_conversation(&state);
    let linked_path = state.paths().root.join("linked-image.png");
    std::fs::write(&linked_path, tiny_png()).expect("write linked image");
    let attachment = state
        .ai_conversations()
        .add_attachment_metadata(
            state.storage(),
            AiConversationAttachmentAddRequest {
                conversation_id: conversation_id.clone(),
                attachment: AiAttachmentInput {
                    kind: "image".to_owned(),
                    storage_mode: "linkedFile".to_owned(),
                    source_kind: Some("picker".to_owned()),
                    mime_type: "image/png".to_owned(),
                    original_name: "linked-image.png".to_owned(),
                    original_path: Some(linked_path.to_string_lossy().to_string()),
                    asset_path: None,
                    thumbnail_path: None,
                    sha256: None,
                    width: Some(1),
                    height: Some(1),
                    size_bytes: tiny_png().len() as i64,
                    ocr_text: None,
                    status: Some("available".to_owned()),
                    missing_reason: None,
                    vision_usage: Some("visionInput".to_owned()),
                    redaction_summary: None,
                },
            },
        )
        .expect("insert linked attachment metadata");
    let executor = Arc::new(RecordingExecutor::new("已拒绝 linkedFile。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "读取这张 linkedFile 图片".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![chat_attachment(&attachment, "visionInput")],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.effective_usage, "metadataOnly");
    assert!(status
        .warning
        .as_deref()
        .is_some_and(|warning| warning.contains("linkedFile 附件首版不发送到 Provider")));
    assert!(executor.requests()[0].vision_inputs.is_empty());
}

#[test]
fn persisted_attachment_metadata_wins_over_frontend_forged_metadata() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let conversation_id = create_conversation(&state);
    let attachment = import_png_attachment(&state, &conversation_id);
    let mut forged_attachment = chat_attachment(&attachment, "visionInput");
    forged_attachment.mime_type = "image/jpeg".to_owned();
    forged_attachment.original_name = "forged-name.jpg".to_owned();
    forged_attachment.ocr_text = Some("forged OCR text must not enter prompt".to_owned());
    forged_attachment.size_bytes = 999_999;
    let executor = Arc::new(RecordingExecutor::new("已读取可信附件。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "读取数据库里的那张图".to_owned(),
            conversation_id: Some(conversation_id),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![forged_attachment],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    assert_eq!(
        response.vision_usage.attachments[0].effective_usage,
        "visionInput"
    );
    let requests = executor.requests();
    assert_eq!(requests[0].vision_inputs.len(), 1);
    assert_eq!(requests[0].vision_inputs[0].mime_type, "image/png");
    assert_eq!(requests[0].vision_inputs[0].media_type, ImageMediaType::PNG);
    assert!(requests[0].context.contains("screen.png"));
    assert!(!requests[0].context.contains("forged-name.jpg"));
    assert!(!requests[0].context.contains("forged OCR text"));
}

#[test]
fn ocr_only_attachment_uses_text_context_without_vision_input() {
    let (_home, state) = setup_state();
    let credentials = memory_credentials();
    let provider = create_provider(&state, &credentials, "gpt-4o-mini");
    let executor = Arc::new(RecordingExecutor::new("已读取 OCR 文本。"));
    let service = AiAgentService::with_executor(executor.clone());

    let response = tauri::async_runtime::block_on(service.chat(
        chat_context(&state, &credentials),
        AiChatRequest {
            application_context: None,
            message: "从 OCR 里提取 SSH 信息".to_owned(),
            conversation_id: Some("legacy-conversation".to_owned()),
            conversation_slot_json: None,
            provider_id: Some(provider.id),
            terminal_context: None,
            execution_visibility: None,
            attachments: vec![AiChatAttachmentContext {
                height: Some(720),
                id: "legacy-ocr-image".to_owned(),
                kind: "image".to_owned(),
                mime_type: "image/png".to_owned(),
                missing_reason: None,
                ocr_text: Some("ssh deploy@10.0.0.12 -p 2222".to_owned()),
                original_name: "ssh-login.png".to_owned(),
                redaction_summary: None,
                size_bytes: 42_000,
                status: "available".to_owned(),
                vision_usage: Some("ocrOnly".to_owned()),
                width: Some(1280),
            }],
            history: Vec::new(),
        },
    ))
    .expect("chat response");

    let status = &response.vision_usage.attachments[0];
    assert_eq!(status.requested_usage, "ocrOnly");
    assert_eq!(status.effective_usage, "ocrOnly");
    assert_eq!(status.model_input, "textContext");
    assert!(executor.requests()[0].vision_inputs.is_empty());
    assert!(executor.requests()[0]
        .context
        .contains("ssh deploy@10.0.0.12 -p 2222"));
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

fn ai_tool_execution_context(state: &AppState) -> AiToolExecutionContext<'_> {
    AiToolExecutionContext {
        terminals: state.terminals(),
        terminal_session_bindings: state.terminal_session_bindings(),
        command_history: state.command_history(),
        credentials: state.credentials(),
        settings: state.settings(),
        profiles: state.profiles(),
        remote_hosts: state.remote_hosts(),
        rig_providers: state.rig_providers(),
        server_info: state.server_info(),
        diagnostics: state.diagnostics(),
        sftp: state.sftp(),
        docker_hosts: state.docker_hosts(),
        port_forwards: state.port_forwards(),
        local_network_proxy: state.local_network_proxy(),
        snippets: state.snippets(),
        workflows: state.workflows(),
        ssh_commands: state.ssh_commands(),
        paths: state.paths(),
        storage: state.storage(),
    }
}

fn create_provider(state: &AppState, credentials: &CredentialService, model: &str) -> LlmProvider {
    RigProviderService::new()
        .create_provider(
            state.storage(),
            credentials,
            LlmProviderCreateRequest {
                name: format!("Vision Provider {model}"),
                kind: LlmProviderKind::OpenAiChat,
                base_url: "https://api.example.com/v1".to_owned(),
                model: model.to_owned(),
                model_list: vec![model.to_owned()],
                temperature: 0.2,
                context_strategy: LlmContextStrategy::Minimal,
                context_window_tokens: 128_000,
                reasoning_effort: LlmReasoningEffort::ModelDefault,
                max_retries: 3,
                user_agent: None,
                http_proxy: None,
                enabled: true,
                is_default: true,
                api_key: Some("sk-vision".to_owned()),
            },
        )
        .expect("create provider")
}

fn create_conversation(state: &AppState) -> String {
    state
        .ai_conversations()
        .create_conversation(
            state.storage(),
            AiConversationCreateRequest {
                title: Some("Vision adapter".to_owned()),
                scope_kind: "noContext".to_owned(),
                scope_ref_json: Some("{}".to_owned()),
                target_key: None,
                host_id: None,
                tab_id: None,
                pane_id: None,
                provider_id: None,
                model: None,
            },
        )
        .expect("create conversation")
        .id
}

fn import_png_attachment(state: &AppState, conversation_id: &str) -> AiAttachment {
    state
        .ai_conversations()
        .import_image_attachment_bytes(
            state.storage(),
            state.paths(),
            AiConversationAttachmentImportBytesRequest {
                conversation_id: conversation_id.to_owned(),
                original_name: Some("screen.png".to_owned()),
                bytes: tiny_png().to_vec(),
                source_kind: Some("paste".to_owned()),
                vision_usage: Some("metadataOnly".to_owned()),
            },
        )
        .expect("import png attachment")
}

fn chat_attachment(attachment: &AiAttachment, vision_usage: &str) -> AiChatAttachmentContext {
    AiChatAttachmentContext {
        id: attachment.id.clone(),
        kind: attachment.kind.clone(),
        mime_type: attachment.mime_type.clone(),
        original_name: attachment.original_name.clone(),
        size_bytes: attachment.size_bytes as u64,
        status: attachment.status.clone(),
        width: attachment.width.and_then(|value| value.try_into().ok()),
        height: attachment.height.and_then(|value| value.try_into().ok()),
        missing_reason: attachment.missing_reason.clone(),
        ocr_text: attachment.ocr_text.clone(),
        redaction_summary: attachment.redaction_summary.clone(),
        vision_usage: Some(vision_usage.to_owned()),
    }
}

fn tiny_png() -> &'static [u8] {
    &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
        251, 3, 253, 160, 105, 45, 164, 0, 0, 0, 0, 73, 69, 68, 174, 66, 96, 130,
    ]
}
