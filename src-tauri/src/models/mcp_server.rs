//! Kerminal MCP tool catalog 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// MCP 工具所属运行态能力域。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ToolCategory {
    /// 本地或远程终端能力。
    Terminal,
    /// SSH 连接能力。
    Ssh,
    /// SFTP 文件能力。
    Sftp,
    /// Docker/Podman 容器能力。
    Container,
    /// tmux 会话管理能力。
    Tmux,
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
}

impl ToolCategory {
    /// 返回中文展示名。
    pub fn label(&self) -> &'static str {
        match self {
            Self::Terminal => "终端",
            Self::Ssh => "SSH",
            Self::Sftp => "SFTP",
            Self::Container => "容器",
            Self::Tmux => "tmux",
            Self::PortForward => "端口转发",
            Self::ServerInfo => "服务器信息",
            Self::Snippet => "脚本片段",
            Self::History => "命令历史",
            Self::Diagnostics => "诊断",
        }
    }
}

/// MCP annotations 的稳定内部表示。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolAnnotations {
    /// 是否只读。
    pub read_only_hint: bool,
    /// 是否具有破坏性。
    pub destructive_hint: bool,
    /// 是否幂等。
    pub idempotent_hint: bool,
    /// 是否访问远程或开放世界。
    pub open_world_hint: bool,
}

/// Kerminal MCP tool 定义。
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
    /// MCP annotations，只表达标准工具语义，不承载 Kerminal 私有审批策略。
    pub annotations: McpToolAnnotations,
    /// 当前是否启用。
    pub enabled: bool,
    /// 是否暴露给 rmcp/MCP 工具列表。
    pub exposed_to_mcp: bool,
    /// JSON Schema object，描述工具入参。
    pub input_schema: Value,
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
