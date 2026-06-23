//! Kerminal Tool Registry IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::{ai_agent::AiApplicationContextRequest, ai_context::AiTerminalContextRequest};

/// MCP 定义来源，用于区分 Kerminal 内置能力和用户自定义扩展。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum McpDefinitionOrigin {
    /// Kerminal 应用内置能力。
    #[default]
    System,
    /// 用户在设置中添加的自定义能力。
    Custom,
}

/// 工具所属能力域，用于前端分组和后续权限策略。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ToolCategory {
    /// 本地或远程终端能力。
    Terminal,
    /// 工作区布局和 tab/pane 操作。
    Workspace,
    /// 应用设置和主题配置。
    Settings,
    /// LLM Provider 配置管理。
    LlmProvider,
    /// 本地终端 profile 管理。
    Profile,
    /// 远程主机配置管理。
    RemoteHost,
    /// SSH 连接能力。
    Ssh,
    /// SFTP 文件能力。
    Sftp,
    /// Docker/Podman 容器能力。
    Container,
    /// SSH 端口转发能力。
    PortForward,
    /// 服务器信息读取能力。
    ServerInfo,
    /// 脚本片段能力。
    Snippet,
    /// 命令历史能力。
    History,
    /// 本地诊断和运行体检能力。
    Diagnostics,
    /// 后续 workflow/snippet 能力。
    Workflow,
    /// 连接启动能力，例如 RDP。
    Connection,
}

impl ToolCategory {
    /// 返回中文展示名。
    pub fn label(&self) -> &'static str {
        match self {
            Self::Terminal => "终端",
            Self::Workspace => "工作区",
            Self::Settings => "设置",
            Self::LlmProvider => "模型 Provider",
            Self::Profile => "配置",
            Self::RemoteHost => "远程主机",
            Self::Ssh => "SSH",
            Self::Sftp => "SFTP",
            Self::Container => "容器",
            Self::PortForward => "端口转发",
            Self::ServerInfo => "服务器信息",
            Self::Snippet => "片段",
            Self::History => "命令历史",
            Self::Diagnostics => "诊断",
            Self::Workflow => "工作流",
            Self::Connection => "连接",
        }
    }
}

/// 工具风险等级。AI、rmcp 和 UI 都只能依据该等级进入策略链路。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ToolRiskLevel {
    /// 只读取本地状态或安全上下文。
    Read,
    /// 会修改本地应用状态或向终端写入内容。
    Write,
    /// 会访问远程主机或远程文件系统。
    Remote,
    /// 会同时影响多个终端、pane 或主机。
    Batch,
    /// 会删除、覆盖、停止或执行高风险动作。
    Destructive,
}

impl ToolRiskLevel {
    /// 返回风险等级对应的默认确认策略。
    pub fn default_confirmation(self) -> ToolConfirmationPolicy {
        match self {
            Self::Read => ToolConfirmationPolicy::Auto,
            Self::Write => ToolConfirmationPolicy::Contextual,
            Self::Remote | Self::Batch => ToolConfirmationPolicy::Always,
            Self::Destructive => ToolConfirmationPolicy::Always,
        }
    }
}

/// 工具调用确认策略。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ToolConfirmationPolicy {
    /// 可自动执行，但仍需审计。
    Auto,
    /// 根据上下文和设置策略决定是否确认。
    Contextual,
    /// 每次执行前都必须确认。
    Always,
}

/// 工具调用审计策略。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ToolAuditPolicy {
    /// 记录工具名、风险和参数摘要。
    Summary,
    /// 记录完整结构化参数；不得包含密钥明文。
    Full,
}

/// Kerminal 内部稳定工具定义。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    /// 稳定工具 id，同时作为 MCP tool name。
    pub id: String,
    /// 中文标题。
    pub title: String,
    /// 中文能力说明。
    pub description: String,
    /// 能力域。
    pub category: ToolCategory,
    /// 风险等级。
    pub risk: ToolRiskLevel,
    /// 确认策略。
    pub confirmation: ToolConfirmationPolicy,
    /// 审计策略。
    pub audit: ToolAuditPolicy,
    /// 当前是否启用。
    pub enabled: bool,
    /// 是否暴露给 rmcp/MCP 工具列表。
    pub exposed_to_mcp: bool,
    /// JSON Schema object，描述工具入参。
    pub input_schema: Value,
}

/// 前端可展示的 rmcp/MCP tool 视图。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDefinition {
    /// MCP tool name。
    pub name: String,
    /// 中文标题。
    pub title: Option<String>,
    /// MCP 描述。
    pub description: Option<String>,
    /// JSON Schema object，描述工具入参。
    pub input_schema: Value,
    /// Kerminal 内部工具 id。
    pub source_tool_id: String,
    /// Kerminal 风险等级。
    pub risk: ToolRiskLevel,
    /// Kerminal 确认策略。
    pub confirmation: ToolConfirmationPolicy,
    /// Kerminal 审计策略。
    pub audit: ToolAuditPolicy,
    /// MCP annotations 的前端可读摘要。
    pub annotations: McpToolAnnotations,
    /// 工具来源。
    #[serde(default)]
    pub origin: McpDefinitionOrigin,
    /// 自定义 MCP Server id；内置工具为空。
    #[serde(default)]
    pub server_id: Option<String>,
}

/// MCP annotations 的前端可读摘要。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolAnnotations {
    /// 是否只读。
    pub read_only_hint: Option<bool>,
    /// 是否具有破坏性。
    pub destructive_hint: Option<bool>,
    /// 是否幂等。
    pub idempotent_hint: Option<bool>,
    /// 是否访问远程或开放世界。
    pub open_world_hint: Option<bool>,
}

/// MCP-compatible 工具列表。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolList {
    /// 协议方向说明。
    pub protocol: String,
    /// 当前可暴露的工具。
    pub tools: Vec<McpToolDefinition>,
}

/// Kerminal 内置 Agent 身份与行为边界。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpAgentProfile {
    /// 稳定 Agent id。
    pub id: String,
    /// Agent 名称。
    pub name: String,
    /// 中文展示标题。
    pub title: String,
    /// Agent 角色定位。
    pub role: String,
    /// 默认回复语言。
    pub default_language: String,
    /// 用户可读描述。
    pub description: String,
    /// 能力摘要。
    pub capabilities: Vec<McpAgentCapability>,
    /// 系统级操作规则。
    pub operating_rules: Vec<String>,
    /// 工具建议输出协议说明。
    pub tool_call_protocol: String,
}

/// Agent 能力摘要，用于 UI、MCP resource 和 system prompt。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpAgentCapability {
    /// 能力 id。
    pub id: String,
    /// 中文标题。
    pub title: String,
    /// 能力说明。
    pub description: String,
    /// 覆盖的工具分类。
    pub tool_categories: Vec<ToolCategory>,
    /// 代表性工具 id。
    pub tool_examples: Vec<String>,
}

/// Agent skills 路由定义，把用户目标映射到一组 MCP 工具和风险规则。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpSkillDefinition {
    /// Skill id。
    pub id: String,
    /// 中文标题。
    pub title: String,
    /// Skill 说明。
    pub description: String,
    /// 何时使用该 skill。
    pub when_to_use: String,
    /// 触发示例。
    pub trigger_examples: Vec<String>,
    /// 该 skill 可路由的 MCP 工具 id。
    pub tool_ids: Vec<String>,
    /// Prompt 中给模型的路由指导。
    pub prompt_guidance: String,
    /// Skill 来源。
    #[serde(default)]
    pub origin: McpDefinitionOrigin,
}

/// Kerminal 本地 MCP 清单，供前端展示和后续外部 MCP Server/Client 复用。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpGatewayManifest {
    /// 清单协议标识。
    pub protocol: String,
    /// 清单生成时间戳。
    pub generated_at: String,
    /// 本地 MCP server 身份。
    pub server: McpServerInfo,
    /// Kerminal 内置 Agent 身份与行为边界。
    pub agent: McpAgentProfile,
    /// 当前可暴露的工具列表。
    pub tools: McpToolList,
    /// Agent skills 路由目录。
    pub skills: Vec<McpSkillDefinition>,
    /// 可供模型读取的资源入口。
    pub resources: Vec<McpResourceDefinition>,
    /// 面向终端工作流的提示模板。
    pub prompts: Vec<McpPromptDefinition>,
    /// 当前和后续预留的 transport。
    pub transports: Vec<McpTransportDefinition>,
    /// MCP 暴露面的安全策略摘要。
    pub security: McpSecurityPolicy,
}

/// MCP server 身份信息。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    /// 稳定 server name。
    pub name: String,
    /// 展示标题。
    pub title: String,
    /// 应用版本。
    pub version: String,
    /// 中文说明。
    pub description: String,
}

/// MCP resource 定义。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceDefinition {
    /// 稳定资源 URI。
    pub uri: String,
    /// 稳定资源名。
    pub name: String,
    /// 中文标题。
    pub title: String,
    /// 中文说明。
    pub description: String,
    /// MIME 类型。
    pub mime_type: String,
    /// 是否需要运行时根据当前会话动态生成。
    pub dynamic: bool,
}

/// MCP resource 读取请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceReadRequest {
    /// 要读取的稳定 resource URI。
    pub uri: String,
    /// 当前应用工作台上下文，仅 `kerminal://application/context/current` 使用。
    pub application_context: Option<AiApplicationContextRequest>,
    /// 当前终端上下文读取参数，仅 `kerminal://terminal-context/current` 使用。
    pub terminal_context: Option<AiTerminalContextRequest>,
    /// 审计摘要读取上限，仅 `kerminal://ai/audit-summary` 使用。
    pub audit_limit: Option<usize>,
}

/// MCP resource 读取结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceReadResult {
    /// 稳定资源 URI。
    pub uri: String,
    /// 稳定资源名。
    pub name: String,
    /// 中文标题。
    pub title: String,
    /// MIME 类型。
    pub mime_type: String,
    /// 生成时间戳。
    pub generated_at: String,
    /// 已脱敏或受限的 JSON 内容。
    pub content: Value,
}

/// MCP prompt 渲染请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptRenderRequest {
    /// 稳定 prompt name。
    pub name: String,
    /// Prompt 参数，按 MCP `prompts/get` 的 arguments object 传入。
    #[serde(default)]
    pub arguments: serde_json::Map<String, Value>,
    /// 当前应用工作台上下文；Agent 路由类 prompt 会把摘要注入渲染结果。
    pub application_context: Option<AiApplicationContextRequest>,
    /// 当前终端上下文读取参数；终端类 prompt 会把快照注入渲染结果。
    pub terminal_context: Option<AiTerminalContextRequest>,
}

/// MCP prompt 渲染结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptRenderResult {
    /// 协议方向说明。
    pub protocol: String,
    /// 稳定 prompt name。
    pub name: String,
    /// 中文标题。
    pub title: String,
    /// 中文说明。
    pub description: String,
    /// 生成时间戳。
    pub generated_at: String,
    /// 本次渲染使用的参数。
    pub arguments: Value,
    /// 已渲染的 MCP prompt messages。
    pub messages: Vec<McpPromptMessage>,
}

/// 前端可展示的 MCP prompt message。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptMessage {
    /// MCP message role，例如 `user` 或 `assistant`。
    pub role: String,
    /// MCP content 类型，目前本地 prompt 只生成 `text`。
    pub content_type: String,
    /// 文本内容；非文本内容会转成可读占位摘要。
    pub text: String,
}

/// MCP prompt 定义。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptDefinition {
    /// 稳定 prompt name。
    pub name: String,
    /// 中文标题。
    pub title: String,
    /// 中文说明。
    pub description: String,
    /// Prompt 参数。
    pub arguments: Vec<McpPromptArgument>,
}

/// MCP prompt 参数定义。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptArgument {
    /// 参数名。
    pub name: String,
    /// 中文说明。
    pub description: String,
    /// 是否必填。
    pub required: bool,
}

/// MCP transport 状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum McpTransportStatus {
    /// 已在应用内部启用。
    Enabled,
    /// 已设计但尚未开放。
    Planned,
    /// 明确禁用。
    Disabled,
}

/// MCP transport 定义。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpTransportDefinition {
    /// transport 或 MCP Server 的稳定 id。
    #[serde(default)]
    pub id: Option<String>,
    /// transport 类型或代号。
    pub kind: String,
    /// 中文标题。
    pub title: String,
    /// 当前状态。
    pub status: McpTransportStatus,
    /// 后续可能使用的启动命令。
    pub command: Option<String>,
    /// 后续可能使用的本地端点。
    pub endpoint: Option<String>,
    /// stdio transport 的参数；内置或非 stdio 为空。
    #[serde(default)]
    pub args: Vec<String>,
    /// 暴露给 MCP Client 的环境变量名；值不会进入 manifest。
    #[serde(default)]
    pub env_keys: Vec<String>,
    /// Streamable HTTP transport 的 header 名；值不会进入 manifest。
    #[serde(default)]
    pub header_keys: Vec<String>,
    /// 中文说明。
    pub description: String,
    /// transport 来源。
    #[serde(default)]
    pub origin: McpDefinitionOrigin,
}

/// Streamable HTTP MCP Server 启动请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpServerStartRequest {
    /// 监听地址。当前只允许 loopback，未传时使用 `127.0.0.1`。
    pub host: Option<String>,
    /// 监听端口。未传或传 0 时从固定默认端口开始，冲突时向后递增探测。
    pub port: Option<u16>,
}

/// Streamable HTTP MCP Server 运行状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpServerStatus {
    /// 当前是否正在监听。
    pub running: bool,
    /// 可提供给 MCP client 的 endpoint，例如 `http://127.0.0.1:12345/mcp`。
    pub endpoint: Option<String>,
    /// 实际绑定地址。
    pub bind_address: String,
    /// 实际监听端口。
    pub port: Option<u16>,
    /// 是否仅允许本机访问。
    pub local_only: bool,
}

/// MCP 暴露面的安全策略摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpSecurityPolicy {
    /// 当前是否只允许本地应用内访问。
    pub local_only: bool,
    /// 是否已开放外部访问。
    pub external_access_enabled: bool,
    /// 工具执行是否必须经过 Kerminal 确认策略。
    pub requires_kerminal_confirmation: bool,
    /// 是否写入 AI 工具审计。
    pub audit_enabled: bool,
    /// 是否默认脱敏敏感内容。
    pub secrets_redacted: bool,
    /// 用户可读策略说明。
    pub notes: Vec<String>,
}
