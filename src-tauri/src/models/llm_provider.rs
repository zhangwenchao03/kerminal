//! LLM Provider IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

/// LLM Provider 类型。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LlmProviderKind {
    /// OpenAI Responses API，由 Rig OpenAI Responses provider 负责连接。
    OpenAiResponses,
    /// OpenAI Chat Completions API，由 Rig OpenAI Completions provider 负责连接。
    #[default]
    #[serde(alias = "openAiCompatible")]
    OpenAiChat,
    /// Anthropic Messages API，由 Rig Anthropic provider 负责连接。
    Anthropic,
}

impl LlmProviderKind {
    /// 返回 SQLite 中保存的稳定枚举值。
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::OpenAiResponses => "openai_responses",
            Self::OpenAiChat => "openai_chat",
            Self::Anthropic => "anthropic",
        }
    }
}

impl TryFrom<&str> for LlmProviderKind {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "openai_responses" => Ok(Self::OpenAiResponses),
            "openai_chat" | "openai_compatible" => Ok(Self::OpenAiChat),
            "anthropic" => Ok(Self::Anthropic),
            other => Err(format!("未知 LLM Provider 类型: {other}")),
        }
    }
}

/// AI 上下文读取策略。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LlmContextStrategy {
    /// 只发送用户明确输入和必要系统提示。
    Minimal,
    /// 允许读取当前终端必要上下文。
    #[default]
    CurrentTerminal,
    /// 允许读取当前工作区聚合上下文。
    CurrentWorkspace,
}

/// OpenAI-compatible reasoning effort 传递策略。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LlmReasoningEffort {
    /// 不显式传递，交给模型或服务端默认值。
    #[default]
    ModelDefault,
    /// 最小推理强度。
    Minimal,
    /// 低推理强度。
    Low,
    /// 中等推理强度。
    Medium,
    /// 高推理强度。
    High,
}

impl LlmReasoningEffort {
    /// 返回 SQLite 中保存的稳定枚举值。
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::ModelDefault => "model_default",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

impl TryFrom<&str> for LlmReasoningEffort {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "model_default" => Ok(Self::ModelDefault),
            "minimal" => Ok(Self::Minimal),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            other => Err(format!("未知 reasoning effort: {other}")),
        }
    }
}

impl LlmContextStrategy {
    /// 返回 SQLite 中保存的稳定枚举值。
    pub fn as_db_str(&self) -> &'static str {
        match self {
            Self::Minimal => "minimal",
            Self::CurrentTerminal => "current_terminal",
            Self::CurrentWorkspace => "current_workspace",
        }
    }
}

impl TryFrom<&str> for LlmContextStrategy {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "minimal" => Ok(Self::Minimal),
            "current_terminal" => Ok(Self::CurrentTerminal),
            "current_workspace" => Ok(Self::CurrentWorkspace),
            other => Err(format!("未知上下文策略: {other}")),
        }
    }
}

/// 可展示给前端的 LLM Provider 配置摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    /// 稳定 provider id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// Provider 类型。
    pub kind: LlmProviderKind,
    /// Provider API base URL。
    pub base_url: String,
    /// 默认模型名称。
    pub model: String,
    /// 可选模型列表；`model` 始终会包含在列表中。
    pub model_list: Vec<String>,
    /// 默认 temperature。
    pub temperature: f64,
    /// AI 上下文读取策略。
    pub context_strategy: LlmContextStrategy,
    /// 模型上下文窗口 tokens，用于 UI 展示和后续预算策略。
    pub context_window_tokens: u32,
    /// 推理强度配置；不支持该字段的 provider 会保持模型默认。
    pub reasoning_effort: LlmReasoningEffort,
    /// 遇到临时错误时的最大重试次数。
    pub max_retries: u8,
    /// 自定义 User-Agent，真实请求能力取决于底层 SDK 支持。
    pub user_agent: Option<String>,
    /// HTTP 代理地址，真实请求能力取决于底层 SDK 支持。
    pub http_proxy: Option<String>,
    /// 是否启用。
    pub enabled: bool,
    /// 是否默认 provider。
    pub is_default: bool,
    /// API key 凭据引用，真实密钥不进入 SQLite。
    pub api_key_credential_ref: Option<String>,
    /// 前端展示用布尔值，避免显示密钥。
    pub api_key_configured: bool,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 新建 LLM Provider 请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderCreateRequest {
    /// 用户可见名称。
    pub name: String,
    /// Provider 类型。
    #[serde(default)]
    pub kind: LlmProviderKind,
    /// Provider API base URL。
    pub base_url: String,
    /// 默认模型名称。
    pub model: String,
    /// 模型列表。
    #[serde(default)]
    pub model_list: Vec<String>,
    /// 默认 temperature。
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    /// AI 上下文读取策略。
    #[serde(default)]
    pub context_strategy: LlmContextStrategy,
    /// 模型上下文窗口 tokens。
    #[serde(default = "default_context_window_tokens")]
    pub context_window_tokens: u32,
    /// 推理强度。
    #[serde(default)]
    pub reasoning_effort: LlmReasoningEffort,
    /// 最大重试次数。
    #[serde(default = "default_max_retries")]
    pub max_retries: u8,
    /// 自定义 User-Agent。
    #[serde(default)]
    pub user_agent: Option<String>,
    /// HTTP 代理地址。
    #[serde(default)]
    pub http_proxy: Option<String>,
    /// 是否启用。
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// 是否设置为默认 provider。
    #[serde(default)]
    pub is_default: bool,
    /// API key 明文只通过 IPC 短暂传输到 Rust，随后进入 keyring。
    #[serde(default)]
    pub api_key: Option<String>,
}

/// 更新 LLM Provider 请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderUpdateRequest {
    /// Provider id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// Provider 类型。
    #[serde(default)]
    pub kind: LlmProviderKind,
    /// Provider API base URL。
    pub base_url: String,
    /// 默认模型名称。
    pub model: String,
    /// 模型列表。
    #[serde(default)]
    pub model_list: Vec<String>,
    /// 默认 temperature。
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    /// AI 上下文读取策略。
    #[serde(default)]
    pub context_strategy: LlmContextStrategy,
    /// 模型上下文窗口 tokens。
    #[serde(default = "default_context_window_tokens")]
    pub context_window_tokens: u32,
    /// 推理强度。
    #[serde(default)]
    pub reasoning_effort: LlmReasoningEffort,
    /// 最大重试次数。
    #[serde(default = "default_max_retries")]
    pub max_retries: u8,
    /// 自定义 User-Agent。
    #[serde(default)]
    pub user_agent: Option<String>,
    /// HTTP 代理地址。
    #[serde(default)]
    pub http_proxy: Option<String>,
    /// 是否启用。
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// 是否设置为默认 provider。
    #[serde(default)]
    pub is_default: bool,
    /// 新 API key；为 `None` 时保留原凭据，为空字符串时按未填写处理。
    #[serde(default)]
    pub api_key: Option<String>,
    /// 是否清除已保存 API key。
    #[serde(default)]
    pub clear_api_key: bool,
}

/// LLM Provider dry validation 结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderTestResult {
    /// Provider id。
    pub provider_id: String,
    /// 是否通过本地配置验证。
    pub ok: bool,
    /// 中文结果消息。
    pub message: String,
    /// 验证模式。
    pub mode: String,
    /// 检查时间戳。
    pub checked_at: String,
}

/// 经过校验和归一化的 provider 草稿。
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedLlmProviderDraft {
    /// 用户可见名称。
    pub name: String,
    /// Provider 类型。
    pub kind: LlmProviderKind,
    /// Provider API base URL。
    pub base_url: String,
    /// 默认模型名称。
    pub model: String,
    /// 模型列表。
    pub model_list: Vec<String>,
    /// 默认 temperature。
    pub temperature: f64,
    /// AI 上下文读取策略。
    pub context_strategy: LlmContextStrategy,
    /// 模型上下文窗口 tokens。
    pub context_window_tokens: u32,
    /// 推理强度。
    pub reasoning_effort: LlmReasoningEffort,
    /// 最大重试次数。
    pub max_retries: u8,
    /// 自定义 User-Agent。
    pub user_agent: Option<String>,
    /// HTTP 代理地址。
    pub http_proxy: Option<String>,
    /// 是否启用。
    pub enabled: bool,
    /// 是否默认 provider。
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct UnvalidatedLlmProviderDraft {
    name: String,
    kind: LlmProviderKind,
    base_url: String,
    model: String,
    model_list: Vec<String>,
    temperature: f64,
    context_strategy: LlmContextStrategy,
    context_window_tokens: u32,
    reasoning_effort: LlmReasoningEffort,
    max_retries: u8,
    user_agent: Option<String>,
    http_proxy: Option<String>,
    enabled: bool,
    is_default: bool,
}

impl LlmProviderCreateRequest {
    /// 校验并归一化新建请求。
    pub fn validated(self) -> AppResult<ValidatedLlmProviderDraft> {
        validate_draft(UnvalidatedLlmProviderDraft {
            name: self.name,
            kind: self.kind,
            base_url: self.base_url,
            model: self.model,
            model_list: self.model_list,
            temperature: self.temperature,
            context_strategy: self.context_strategy,
            context_window_tokens: self.context_window_tokens,
            reasoning_effort: self.reasoning_effort,
            max_retries: self.max_retries,
            user_agent: self.user_agent,
            http_proxy: self.http_proxy,
            enabled: self.enabled,
            is_default: self.is_default,
        })
    }

    /// 返回归一化后的 API key。
    pub fn normalized_api_key(&self) -> Option<String> {
        normalize_secret(self.api_key.as_deref())
    }
}

impl LlmProviderUpdateRequest {
    /// 校验并归一化更新请求。
    pub fn validated(self) -> AppResult<ValidatedLlmProviderDraft> {
        if self.id.trim().is_empty() {
            return Err(AppError::InvalidInput("Provider id 不能为空".to_string()));
        }

        validate_draft(UnvalidatedLlmProviderDraft {
            name: self.name,
            kind: self.kind,
            base_url: self.base_url,
            model: self.model,
            model_list: self.model_list,
            temperature: self.temperature,
            context_strategy: self.context_strategy,
            context_window_tokens: self.context_window_tokens,
            reasoning_effort: self.reasoning_effort,
            max_retries: self.max_retries,
            user_agent: self.user_agent,
            http_proxy: self.http_proxy,
            enabled: self.enabled,
            is_default: self.is_default,
        })
    }

    /// 返回归一化后的 API key。
    pub fn normalized_api_key(&self) -> Option<String> {
        normalize_secret(self.api_key.as_deref())
    }
}

fn validate_draft(draft: UnvalidatedLlmProviderDraft) -> AppResult<ValidatedLlmProviderDraft> {
    let name = draft.name.trim().to_string();
    let base_url = normalize_base_url(&draft.base_url)?;
    let model = draft.model.trim().to_string();
    let model_list = normalize_model_list(draft.model_list, &model);
    let user_agent = normalize_optional_text(draft.user_agent);
    let http_proxy = normalize_optional_text(draft.http_proxy);

    if name.is_empty() {
        return Err(AppError::InvalidInput("Provider 名称不能为空".to_string()));
    }
    if name.len() > 80 {
        return Err(AppError::InvalidInput(
            "Provider 名称不能超过 80 个字符".to_string(),
        ));
    }
    if model.is_empty() {
        return Err(AppError::InvalidInput("模型名称不能为空".to_string()));
    }
    if model.len() > 120 {
        return Err(AppError::InvalidInput(
            "模型名称不能超过 120 个字符".to_string(),
        ));
    }
    if !(0.0..=2.0).contains(&draft.temperature) {
        return Err(AppError::InvalidInput(
            "temperature 需要在 0 到 2 之间".to_string(),
        ));
    }
    if !(1024..=2_000_000).contains(&draft.context_window_tokens) {
        return Err(AppError::InvalidInput(
            "上下文窗口需要在 1024 到 2000000 tokens 之间".to_string(),
        ));
    }
    if user_agent.as_ref().is_some_and(|value| value.len() > 160) {
        return Err(AppError::InvalidInput(
            "User-Agent 不能超过 160 个字符".to_string(),
        ));
    }
    if http_proxy.as_ref().is_some_and(|value| value.len() > 240) {
        return Err(AppError::InvalidInput(
            "HTTP 代理地址不能超过 240 个字符".to_string(),
        ));
    }

    Ok(ValidatedLlmProviderDraft {
        name,
        kind: draft.kind,
        base_url,
        model,
        model_list,
        temperature: draft.temperature,
        context_strategy: draft.context_strategy,
        context_window_tokens: draft.context_window_tokens,
        reasoning_effort: draft.reasoning_effort,
        max_retries: draft.max_retries.min(10),
        user_agent,
        http_proxy,
        enabled: draft.enabled,
        is_default: draft.is_default,
    })
}

fn normalize_base_url(base_url: &str) -> AppResult<String> {
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    let parsed = Url::parse(&base_url)
        .map_err(|_| AppError::InvalidInput("base URL 不是合法 URL".to_string()))?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidInput(
            "base URL 只支持 http 或 https".to_string(),
        ));
    }
    if parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(
            "base URL 必须包含主机名".to_string(),
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError::InvalidInput(
            "base URL 不应包含 query 或 fragment".to_string(),
        ));
    }

    Ok(base_url)
}

fn normalize_secret(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_model_list(model_list: Vec<String>, model: &str) -> Vec<String> {
    let mut values = model_list
        .into_iter()
        .chain(std::iter::once(model.to_string()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .take(32)
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn default_temperature() -> f64 {
    0.2
}

fn default_enabled() -> bool {
    true
}

fn default_context_window_tokens() -> u32 {
    128_000
}

fn default_max_retries() -> u8 {
    3
}
