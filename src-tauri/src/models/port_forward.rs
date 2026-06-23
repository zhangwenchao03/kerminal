//! SSH 端口转发 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// SSH 端口转发类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardKind {
    /// 本地转发，对应 OpenSSH `-L`。
    #[default]
    Local,
    /// 远程转发，对应 OpenSSH `-R`。
    Remote,
    /// 动态 SOCKS 转发，对应 OpenSSH `-D`。
    Dynamic,
}

/// 端口转发用途。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardPurpose {
    /// 普通 SSH 端口转发。
    #[default]
    Generic,
    /// 主机使用本机网络助手。
    HostNetworkAssist,
}

/// 端口转发来源。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardOrigin {
    /// 用户手动创建。
    #[default]
    User,
    /// AI 工具创建。
    AiTool,
    /// 网络助手创建。
    NetworkAssist,
    /// 主机预设创建。
    HostPreset,
}

/// 代理协议。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardProxyProtocol {
    /// HTTP/HTTPS 代理，通常由本机受管 HTTP CONNECT proxy 提供。
    Http,
    /// SOCKS5 代理。
    Socks5,
}

/// 远端监听可见范围。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardRemoteAccessScope {
    /// 仅远端 loopback 可访问。
    Loopback,
    /// 远端局域网地址可访问。
    PrivateNetwork,
    /// 远端所有接口可访问。
    AllInterfaces,
    /// 用户自定义地址。
    Custom,
}

/// 代理应用范围。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardProxyApplyScope {
    /// 只创建隧道，不自动应用到终端或配置。
    #[default]
    None,
    /// 注入当前同主机终端会话。
    CurrentTerminal,
    /// 后续同主机 Kerminal 终端自动注入。
    FutureTerminals,
    /// 用户级远端配置助手。
    UserProfile,
    /// AI/工具调用命令临时使用。
    ToolOnly,
}

/// 端口转发端点。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardEndpoint {
    /// 端点主机或绑定地址。
    #[serde(default)]
    pub host: String,
    /// 端点端口；动态 SOCKS 出口等场景可为空。
    #[serde(default)]
    pub port: Option<u16>,
    /// 用户可见端点标签。
    #[serde(default)]
    pub label: Option<String>,
}

/// 端口转发运行状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardStatus {
    /// 子进程仍在运行。
    Running,
    /// 子进程已经退出。
    Exited,
}

/// 创建端口转发请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardCreateRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 用户可见名称。
    pub name: Option<String>,
    /// 转发类型。
    pub kind: PortForwardKind,
    /// 创建用途；缺省为普通端口转发。
    #[serde(default)]
    pub purpose: PortForwardPurpose,
    /// 创建来源；缺省为用户手动创建。
    #[serde(default)]
    pub origin: PortForwardOrigin,
    /// 监听地址，默认由服务按类型补 `127.0.0.1`。
    pub bind_host: Option<String>,
    /// 本机监听地址或本机侧代理入口地址。
    #[serde(default)]
    pub local_bind_host: Option<String>,
    /// 远端监听地址。
    #[serde(default)]
    pub remote_bind_host: Option<String>,
    /// 监听端口，本地/动态时是本机端口，远程时是远端监听端口。
    pub source_port: u16,
    /// 目标主机，本地/远程转发必填，动态转发为空。
    pub target_host: Option<String>,
    /// 目标端口，本地/远程转发必填，动态转发为空。
    pub target_port: Option<u16>,
    /// 本机端点；网络助手 HTTP 模式用来表达本机受管代理入口。
    #[serde(default)]
    pub local_endpoint: Option<PortForwardEndpoint>,
    /// 远端端点；网络助手用来表达远端代理监听地址。
    #[serde(default)]
    pub remote_endpoint: Option<PortForwardEndpoint>,
    /// 主机网络助手代理协议。
    #[serde(default)]
    pub proxy_protocol: Option<PortForwardProxyProtocol>,
    /// 远端监听可见范围。
    #[serde(default)]
    pub remote_access_scope: Option<PortForwardRemoteAccessScope>,
    /// 代理应用范围。
    #[serde(default)]
    pub proxy_apply_scope: PortForwardProxyApplyScope,
    /// 共享本机代理服务 id；LocalNetworkProxyService 集成后填充。
    #[serde(default)]
    pub shared_proxy_service_id: Option<String>,
    /// 共享本机代理服务内的逻辑入口 id。
    #[serde(default)]
    pub local_proxy_entry_id: Option<String>,
}

impl Default for PortForwardCreateRequest {
    fn default() -> Self {
        Self {
            host_id: String::new(),
            name: None,
            kind: PortForwardKind::Local,
            purpose: PortForwardPurpose::Generic,
            origin: PortForwardOrigin::User,
            bind_host: None,
            local_bind_host: None,
            remote_bind_host: None,
            source_port: 0,
            target_host: None,
            target_port: None,
            local_endpoint: None,
            remote_endpoint: None,
            proxy_protocol: None,
            remote_access_scope: None,
            proxy_apply_scope: PortForwardProxyApplyScope::None,
            shared_proxy_service_id: None,
            local_proxy_entry_id: None,
        }
    }
}

/// 端口转发会话摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardSummary {
    /// 转发会话 id。
    pub id: String,
    /// 远程主机 id。
    pub host_id: String,
    /// 远程主机名称。
    pub host_name: String,
    /// 用户可见名称。
    pub name: String,
    /// 转发类型。
    pub kind: PortForwardKind,
    /// 创建用途。
    #[serde(default)]
    pub purpose: PortForwardPurpose,
    /// 创建来源。
    #[serde(default)]
    pub origin: PortForwardOrigin,
    /// 监听地址。
    pub bind_host: String,
    /// 本机监听地址或本机侧代理入口地址。
    #[serde(default)]
    pub local_bind_host: Option<String>,
    /// 远端监听地址。
    #[serde(default)]
    pub remote_bind_host: Option<String>,
    /// 监听端口。
    pub source_port: u16,
    /// 目标主机。
    pub target_host: Option<String>,
    /// 目标端口。
    pub target_port: Option<u16>,
    /// 本机侧端点。
    #[serde(default)]
    pub local_endpoint: Option<PortForwardEndpoint>,
    /// 远端侧端点。
    #[serde(default)]
    pub remote_endpoint: Option<PortForwardEndpoint>,
    /// 主机网络助手代理协议。
    #[serde(default)]
    pub proxy_protocol: Option<PortForwardProxyProtocol>,
    /// 远端监听可见范围。
    #[serde(default)]
    pub remote_access_scope: Option<PortForwardRemoteAccessScope>,
    /// 远端可复制代理 URL。
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// 代理应用范围。
    #[serde(default)]
    pub proxy_apply_scope: PortForwardProxyApplyScope,
    /// 共享本机代理服务 id。
    #[serde(default)]
    pub shared_proxy_service_id: Option<String>,
    /// 共享本机代理服务逻辑入口 id。
    #[serde(default)]
    pub local_proxy_entry_id: Option<String>,
    /// 脱敏后的 OpenSSH 命令预览。
    #[serde(default)]
    pub command_preview: String,
    /// 最近一次错误；不包含密码、私钥或 token。
    #[serde(default)]
    pub last_error: Option<String>,
    /// OpenSSH 子进程 pid。
    pub pid: Option<u32>,
    /// 运行状态。
    pub status: PortForwardStatus,
    /// 创建时间，Unix epoch 秒。
    pub created_at: String,
}
