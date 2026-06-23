//! Kerminal Agent 图片 vision adapter。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rig_core::{
    completion::message::{ImageDetail, ImageMediaType, Message, UserContent},
    OneOrMany,
};

use crate::{
    error::{AppError, AppResult},
    models::{
        ai_agent::{
            AiChatAttachmentContext, AiChatAttachmentVisionStatus, AiChatVisionUsageReport,
        },
        ai_conversation::AiAttachment,
        llm_provider::{LlmProvider, LlmProviderKind},
    },
    paths::{KerminalPaths, AI_ATTACHMENTS_DIR_NAME},
    storage::SqliteStore,
};

use super::AiChatExecutionRequest;

const MAX_VISION_INPUT_BYTES: u64 = 25 * 1024 * 1024;
const VISION_ADAPTER_ENABLED: bool = true;
const VISION_INPUT: &str = "visionInput";
const OCR_ONLY: &str = "ocrOnly";
const METADATA_ONLY: &str = "metadataOnly";
const BLOCKED: &str = "blocked";
const NOT_SENT: &str = "notSent";

/// 已通过后端持久化记录和路径校验的图片输入。
#[derive(Debug, Clone, PartialEq)]
pub struct AiChatVisionInput {
    /// 附件 id。
    pub id: String,
    /// 附件 MIME 类型。
    pub mime_type: String,
    /// Rig 识别的图片媒体类型。
    pub media_type: ImageMediaType,
    /// 原始图片字节。
    pub bytes: Vec<u8>,
}

pub(super) fn build_prompt_message(request: &AiChatExecutionRequest) -> AppResult<Message> {
    if request.vision_inputs.is_empty() {
        return Ok(request.prompt.clone().into());
    }

    let mut content = Vec::with_capacity(request.vision_inputs.len() + 1);
    content.push(UserContent::text(request.prompt.clone()));
    for input in &request.vision_inputs {
        content.push(UserContent::image_base64(
            BASE64_STANDARD.encode(&input.bytes),
            Some(input.media_type.clone()),
            Some(ImageDetail::Auto),
        ));
    }

    Ok(Message::User {
        content: OneOrMany::many(content)
            .map_err(|_| AppError::AiAgent("无法构造包含图片的 Kerminal Agent 请求".to_owned()))?,
    })
}

pub(super) fn resolve_chat_vision_usage(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    conversation_id: &str,
    attachments: &[AiChatAttachmentContext],
    provider: &LlmProvider,
) -> AppResult<(
    Vec<AiChatAttachmentContext>,
    AiChatVisionUsageReport,
    Vec<AiChatVisionInput>,
)> {
    let provider_has_vision = provider_supports_vision(provider);
    let mut resolved_attachments = Vec::with_capacity(attachments.len());
    let mut attachment_statuses = Vec::with_capacity(attachments.len());
    let mut vision_inputs = Vec::new();

    for attachment in attachments {
        let trusted_attachment = trusted_attachment_context(storage, conversation_id, attachment)?;
        let requested_usage =
            requested_attachment_vision_usage(attachment, &trusted_attachment).to_owned();
        let vision_input = if requested_usage == VISION_INPUT
            && VISION_ADAPTER_ENABLED
            && provider_has_vision
        {
            resolve_attachment_vision_input(storage, paths, conversation_id, &trusted_attachment)?
        } else {
            Err(String::new())
        };
        let vision_input_available = vision_input.is_ok();
        let effective_usage = effective_attachment_vision_usage(
            &trusted_attachment,
            &requested_usage,
            provider_has_vision,
            vision_input_available,
        )
        .to_owned();
        let model_input = attachment_model_input(&effective_usage).to_owned();
        let warning = attachment_vision_warning(
            &requested_usage,
            &effective_usage,
            provider_has_vision,
            vision_input.as_ref().err().map(String::as_str),
        );

        let mut resolved_attachment = trusted_attachment;
        resolved_attachment.vision_usage = Some(effective_usage.clone());
        resolved_attachments.push(resolved_attachment);
        if effective_usage == VISION_INPUT {
            if let Ok(input) = vision_input {
                vision_inputs.push(input);
            }
        }
        attachment_statuses.push(AiChatAttachmentVisionStatus {
            id: attachment.id.clone(),
            requested_usage,
            effective_usage,
            model_input,
            warning,
        });
    }

    Ok((
        resolved_attachments,
        AiChatVisionUsageReport {
            provider_supports_vision: provider_has_vision,
            vision_adapter_enabled: VISION_ADAPTER_ENABLED && provider_has_vision,
            attachments: attachment_statuses,
        },
        vision_inputs,
    ))
}

fn trusted_attachment_context(
    storage: &SqliteStore,
    conversation_id: &str,
    attachment: &AiChatAttachmentContext,
) -> AppResult<AiChatAttachmentContext> {
    let Some(persisted) = storage.ai_attachment_by_id(&attachment.id)? else {
        return Ok(attachment.clone());
    };
    if persisted.conversation_id != conversation_id {
        let mut sanitized = attachment.clone();
        sanitized.ocr_text = None;
        sanitized.redaction_summary = None;
        return Ok(sanitized);
    }
    Ok(chat_attachment_context_from_persisted(&persisted))
}

fn chat_attachment_context_from_persisted(attachment: &AiAttachment) -> AiChatAttachmentContext {
    AiChatAttachmentContext {
        id: attachment.id.clone(),
        kind: attachment.kind.clone(),
        mime_type: attachment.mime_type.clone(),
        original_name: attachment.original_name.clone(),
        size_bytes: u64::try_from(attachment.size_bytes).unwrap_or_default(),
        status: attachment.status.clone(),
        width: attachment.width.and_then(|value| value.try_into().ok()),
        height: attachment.height.and_then(|value| value.try_into().ok()),
        missing_reason: attachment.missing_reason.clone(),
        ocr_text: attachment.ocr_text.clone(),
        redaction_summary: attachment.redaction_summary.clone(),
        vision_usage: attachment.vision_usage.clone(),
    }
}

fn requested_attachment_vision_usage(
    attachment: &AiChatAttachmentContext,
    trusted_attachment: &AiChatAttachmentContext,
) -> &'static str {
    match attachment
        .vision_usage
        .as_deref()
        .or(trusted_attachment.vision_usage.as_deref())
    {
        Some(VISION_INPUT) => VISION_INPUT,
        Some(OCR_ONLY) => OCR_ONLY,
        Some(METADATA_ONLY) => METADATA_ONLY,
        Some(BLOCKED) => BLOCKED,
        Some(NOT_SENT) => NOT_SENT,
        _ if trusted_attachment.kind == "image" && trusted_attachment.status == "available" => {
            METADATA_ONLY
        }
        _ => NOT_SENT,
    }
}

fn effective_attachment_vision_usage(
    attachment: &AiChatAttachmentContext,
    requested_usage: &str,
    provider_supports_vision: bool,
    vision_input_available: bool,
) -> &'static str {
    match requested_usage {
        BLOCKED => BLOCKED,
        VISION_INPUT
            if VISION_ADAPTER_ENABLED && provider_supports_vision && vision_input_available =>
        {
            VISION_INPUT
        }
        VISION_INPUT | OCR_ONLY if has_ocr_text(attachment) => OCR_ONLY,
        VISION_INPUT | OCR_ONLY | METADATA_ONLY => METADATA_ONLY,
        NOT_SENT if attachment.kind == "image" && attachment.status == "available" => METADATA_ONLY,
        _ => NOT_SENT,
    }
}

fn attachment_model_input(effective_usage: &str) -> &'static str {
    match effective_usage {
        VISION_INPUT => "visionInput",
        OCR_ONLY | METADATA_ONLY => "textContext",
        _ => "notSent",
    }
}

fn attachment_vision_warning(
    requested_usage: &str,
    effective_usage: &str,
    provider_supports_vision: bool,
    vision_input_warning: Option<&str>,
) -> Option<String> {
    if requested_usage == VISION_INPUT && effective_usage != VISION_INPUT {
        if provider_supports_vision {
            if let Some(warning) = vision_input_warning.filter(|value| !value.is_empty()) {
                return Some(format!(
                    "Provider 支持视觉，但图片像素未进入模型：{warning}；本次只发送文本附件上下文。"
                ));
            }
        }
        return Some(if provider_supports_vision {
            "Provider 支持视觉，但当前 Kerminal adapter 尚未发送图片像素；本次只发送文本附件上下文。"
                .to_owned()
        } else {
            "当前 Provider 未标记为支持视觉，图片像素未进入模型；本次只发送文本附件上下文。"
                .to_owned()
        });
    }
    if requested_usage == OCR_ONLY && effective_usage == METADATA_ONLY {
        return Some("附件没有可用 OCR 文本，已降级为 metadata 文本上下文。".to_owned());
    }
    if requested_usage == NOT_SENT && effective_usage == METADATA_ONLY {
        return Some("图片像素未发送；附件 metadata/status 已作为文本上下文进入模型。".to_owned());
    }
    None
}

fn resolve_attachment_vision_input(
    storage: &SqliteStore,
    paths: &KerminalPaths,
    conversation_id: &str,
    attachment: &AiChatAttachmentContext,
) -> AppResult<Result<AiChatVisionInput, String>> {
    if attachment.kind != "image" {
        return Ok(Err("附件不是图片".to_owned()));
    }
    let Some(persisted) = storage.ai_attachment_by_id(&attachment.id)? else {
        return Ok(Err("没有找到已持久化附件记录".to_owned()));
    };
    if persisted.conversation_id != conversation_id {
        return Ok(Err("附件不属于当前 AI 会话".to_owned()));
    }
    if persisted.kind != "image" {
        return Ok(Err("持久化附件不是图片".to_owned()));
    }
    if persisted.status != "available" {
        return Ok(Err(format!("附件状态为 {}", persisted.status)));
    }

    let Some(media_type) =
        image_media_type(&persisted.mime_type).or_else(|| image_media_type(&attachment.mime_type))
    else {
        return Ok(Err(format!(
            "附件 MIME 不支持 vision adapter: {}",
            persisted.mime_type
        )));
    };

    let path = match resolve_attachment_file_path(paths, &persisted) {
        Ok(path) => path,
        Err(reason) => return Ok(Err(reason)),
    };
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok(Err(format!("图片文件不存在或无法访问: {error}")));
        }
    };
    if !metadata.is_file() {
        return Ok(Err("附件路径不是文件".to_owned()));
    }
    if metadata.len() == 0 {
        return Ok(Err("图片文件为空".to_owned()));
    }
    if metadata.len() > MAX_VISION_INPUT_BYTES {
        return Ok(Err(format!(
            "图片文件超过 {} MB",
            MAX_VISION_INPUT_BYTES / 1024 / 1024
        )));
    }
    let path = match canonicalize_managed_attachment_file(paths, &path) {
        Ok(path) => path,
        Err(reason) => return Ok(Err(reason)),
    };

    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Ok(Err(format!("无法读取图片文件: {error}")));
        }
    };
    Ok(Ok(AiChatVisionInput {
        id: persisted.id,
        mime_type: persisted.mime_type,
        media_type,
        bytes,
    }))
}

fn resolve_attachment_file_path(
    paths: &KerminalPaths,
    attachment: &AiAttachment,
) -> Result<PathBuf, String> {
    match attachment.storage_mode.as_str() {
        "managedCopy" => attachment
            .asset_path
            .as_deref()
            .ok_or_else(|| "受管附件缺少 assetPath".to_owned())
            .and_then(|value| resolve_managed_attachment_relative_path(paths, attachment, value)),
        "linkedFile" => Err("linkedFile 附件首版不发送到 Provider，请导入为受管副本".to_owned()),
        _ => Err("附件存储模式不支持 vision adapter".to_owned()),
    }
}

fn resolve_managed_attachment_relative_path(
    paths: &KerminalPaths,
    attachment: &AiAttachment,
    value: &str,
) -> Result<PathBuf, String> {
    let relative = Path::new(value);
    if relative.is_absolute() {
        return Err("受管附件路径不能是绝对路径".to_owned());
    }

    let mut clean = PathBuf::new();
    let mut path_parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => {
                let value = value
                    .to_str()
                    .ok_or_else(|| "受管附件路径包含非法片段".to_owned())?;
                clean.push(value);
                path_parts.push(value.to_owned());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("受管附件路径越界".to_owned());
            }
        }
    }

    if clean
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        != Some(AI_ATTACHMENTS_DIR_NAME)
    {
        return Err("受管附件路径必须位于 ai-attachments 目录".to_owned());
    }
    if path_parts.len() != 4
        || path_parts[1] != attachment.conversation_id
        || path_parts[2] != attachment.id
        || path_parts[3]
            .strip_prefix("original.")
            .is_none_or(|extension| extension.is_empty())
    {
        return Err(
            "受管附件路径必须匹配 ai-attachments/<conversation>/<attachment>/original.<ext>"
                .to_owned(),
        );
    }

    let target = paths.root.join(clean);
    if !target.starts_with(&paths.ai_attachments) {
        return Err("受管附件路径越界".to_owned());
    }
    Ok(target)
}

fn canonicalize_managed_attachment_file(
    paths: &KerminalPaths,
    path: &Path,
) -> Result<PathBuf, String> {
    let root = paths
        .ai_attachments
        .canonicalize()
        .map_err(|error| format!("无法校验受管附件目录: {error}"))?;
    let target = path
        .canonicalize()
        .map_err(|error| format!("无法校验图片路径: {error}"))?;
    if !target.starts_with(&root) {
        return Err("受管附件真实路径越界".to_owned());
    }
    Ok(target)
}

fn image_media_type(mime_type: &str) -> Option<ImageMediaType> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Some(ImageMediaType::JPEG),
        "image/png" => Some(ImageMediaType::PNG),
        "image/gif" => Some(ImageMediaType::GIF),
        "image/webp" => Some(ImageMediaType::WEBP),
        _ => None,
    }
}

fn has_ocr_text(attachment: &AiChatAttachmentContext) -> bool {
    attachment
        .ocr_text
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
}

/// 判断当前 Provider/model 是否可以安全尝试图片输入。
pub fn provider_supports_vision(provider: &LlmProvider) -> bool {
    detect_provider_vision_support(provider)
}

fn detect_provider_vision_support(provider: &LlmProvider) -> bool {
    let model = provider.model.to_ascii_lowercase().replace('_', "-");
    match provider.kind {
        LlmProviderKind::OpenAiResponses | LlmProviderKind::OpenAiChat => {
            openai_model_supports_vision(&model)
        }
        LlmProviderKind::Anthropic => anthropic_model_supports_vision(&model),
    }
}

fn openai_model_supports_vision(model: &str) -> bool {
    model.contains("vision")
        || model == "chatgpt-4o-latest"
        || model == "computer-use-preview"
        || ["gpt-4o", "gpt-4.1", "gpt-4.5", "gpt-5", "o1", "o3", "o4"]
            .iter()
            .any(|prefix| model.starts_with(prefix))
}

fn anthropic_model_supports_vision(model: &str) -> bool {
    [
        "claude-3",
        "claude-sonnet-4",
        "claude-opus-4",
        "claude-haiku-4",
        "claude-fable-5",
        "claude-mythos-5",
    ]
    .iter()
    .any(|prefix| model.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{
            llm_provider::{LlmContextStrategy, LlmReasoningEffort},
            settings::AiSecuritySettings,
        },
        services::ai_agent_service::AiChatExecutionRequest,
        services::ai_tool_invocation_service::AiToolInvocationService,
    };

    #[test]
    fn detect_provider_vision_support_matches_model_matrix() {
        let supported = [
            (LlmProviderKind::OpenAiResponses, "gpt-5.5"),
            (LlmProviderKind::OpenAiChat, "gpt-4.1-mini"),
            (LlmProviderKind::OpenAiChat, "gpt-4.5-preview"),
            (LlmProviderKind::OpenAiChat, "gpt-4o-mini"),
            (LlmProviderKind::OpenAiChat, "chatgpt-4o-latest"),
            (LlmProviderKind::OpenAiChat, "o1"),
            (LlmProviderKind::OpenAiResponses, "o4-mini"),
            (LlmProviderKind::OpenAiResponses, "computer-use-preview"),
            (LlmProviderKind::Anthropic, "claude-3-7-sonnet-latest"),
            (LlmProviderKind::Anthropic, "claude-sonnet-4-20250514"),
            (LlmProviderKind::Anthropic, "claude-opus-4-1-20250805"),
            (LlmProviderKind::Anthropic, "claude-fable-5-20260201"),
            (LlmProviderKind::Anthropic, "claude-mythos-5-20260201"),
        ];
        for (kind, model) in supported {
            assert!(
                provider_supports_vision(&test_provider(kind, model)),
                "{kind:?} model {model} should support image input"
            );
        }

        let unsupported = [
            (LlmProviderKind::OpenAiChat, "gpt-test"),
            (LlmProviderKind::OpenAiResponses, "text-davinci-003"),
            (LlmProviderKind::Anthropic, "claude-2.1"),
            (LlmProviderKind::Anthropic, "claude-instant-1.2"),
        ];
        for (kind, model) in unsupported {
            assert!(
                !provider_supports_vision(&test_provider(kind, model)),
                "{kind:?} model {model} should not be marked vision-capable"
            );
        }
    }

    #[test]
    fn build_prompt_message_encodes_vision_inputs_as_base64() {
        let request = AiChatExecutionRequest {
            provider: test_provider(LlmProviderKind::OpenAiChat, "gpt-4o-mini"),
            api_key: "sk-test".to_owned(),
            preamble: "system".to_owned(),
            context: "context".to_owned(),
            prompt: "请看图".to_owned(),
            conversation_id: "conv-vision".to_owned(),
            conversation_slot_json: None,
            vision_inputs: vec![AiChatVisionInput {
                id: "att-1".to_owned(),
                mime_type: "image/png".to_owned(),
                media_type: ImageMediaType::PNG,
                bytes: vec![1, 2, 3],
            }],
            tool_definitions: Vec::new(),
            ai_policy: AiSecuritySettings::legacy_tool_policy(),
            ai_tools: AiToolInvocationService::new(),
        };

        let message = build_prompt_message(&request).expect("prompt message");

        let Message::User { content } = message else {
            panic!("vision prompt should be a user message");
        };
        assert_eq!(content.len(), 2);
        let UserContent::Text(text) = content.first_ref() else {
            panic!("first content should be text");
        };
        assert_eq!(text.text, "请看图");
        let rest = content.rest();
        let UserContent::Image(image) = &rest[0] else {
            panic!("second content should be image");
        };
        assert_eq!(
            image.data,
            rig_core::completion::message::DocumentSourceKind::Base64("AQID".to_owned())
        );
        assert_eq!(image.media_type, Some(ImageMediaType::PNG));
        assert_eq!(image.detail, Some(ImageDetail::Auto));
    }

    fn test_provider(kind: LlmProviderKind, model: &str) -> LlmProvider {
        LlmProvider {
            id: "provider-vision".to_owned(),
            name: "Vision Provider".to_owned(),
            kind,
            base_url: "https://api.example.com/v1".to_owned(),
            model: model.to_owned(),
            model_list: vec![model.to_owned()],
            temperature: 0.2,
            context_strategy: LlmContextStrategy::Minimal,
            context_window_tokens: 128_000,
            reasoning_effort: LlmReasoningEffort::ModelDefault,
            max_retries: 0,
            user_agent: None,
            http_proxy: None,
            enabled: true,
            is_default: true,
            api_key_credential_ref: Some("test".to_owned()),
            api_key_configured: true,
            created_at: "1".to_owned(),
            updated_at: "1".to_owned(),
        }
    }
}
