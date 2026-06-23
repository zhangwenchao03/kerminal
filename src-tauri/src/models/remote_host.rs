//! 远程主机 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// SSH 认证方式。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RemoteHostAuthType {
    /// 用户密码认证，密码随主机记录明文保存。
    Password,
    /// 私钥认证，私钥路径或内联私钥内容随主机记录保存。
    Key,
    /// 使用系统 SSH agent。
    #[default]
    Agent,
}

impl RemoteHostAuthType {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Key => "key",
            Self::Agent => "agent",
        }
    }
}

impl TryFrom<&str> for RemoteHostAuthType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "password" => Ok(Self::Password),
            "key" => Ok(Self::Key),
            "agent" => Ok(Self::Agent),
            _ => Err(format!("未知 SSH 认证方式: {value}")),
        }
    }
}

/// SSH 连接附加选项。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshOptions {
    /// 代理配置。
    #[serde(default)]
    pub proxy: SshProxyOptions,
    /// SSH 端口转发配置。
    #[serde(default)]
    pub tunnels: Vec<SshTunnelOptions>,
    /// ProxyJump / 跳板链配置。
    #[serde(default)]
    pub jump_hosts: Vec<SshJumpHostOptions>,
    /// 登录后的终端行为。
    #[serde(default)]
    pub terminal: SshTerminalOptions,
    /// SFTP / 传输行为。
    #[serde(default)]
    pub transfer: SshTransferOptions,
}

/// SSH 代理协议。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SshProxyProtocol {
    /// 不使用代理。
    #[default]
    None,
    /// HTTP CONNECT 代理。
    Http,
    /// SOCKS5 代理。
    Socks5,
}

/// SSH 代理配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshProxyOptions {
    /// 代理协议。
    #[serde(default)]
    pub protocol: SshProxyProtocol,
    /// 代理主机。
    #[serde(default)]
    pub host: Option<String>,
    /// 代理端口。
    #[serde(default)]
    pub port: Option<u16>,
    /// 代理用户名。
    #[serde(default)]
    pub username: Option<String>,
    /// 代理密码引用；当前 SSH 主机连接不使用该字段。
    #[serde(default)]
    pub credential_ref: Option<String>,
}

/// SSH 端口转发类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SshTunnelKind {
    /// 本地监听并转发到远端。
    #[default]
    Local,
    /// 远端监听并转发到本地。
    Remote,
    /// 本地 SOCKS 动态转发。
    Dynamic,
}

/// SSH 端口转发配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelOptions {
    /// 用户可见名称。
    #[serde(default)]
    pub name: String,
    /// 转发类型。
    #[serde(default)]
    pub kind: SshTunnelKind,
    /// 监听地址。
    #[serde(default)]
    pub bind_host: String,
    /// 监听端口。
    #[serde(default)]
    pub bind_port: Option<u16>,
    /// 目标地址；动态转发时可为空。
    #[serde(default)]
    pub target_host: String,
    /// 目标端口；动态转发时可为空。
    #[serde(default)]
    pub target_port: Option<u16>,
}

/// SSH 跳板配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshJumpHostOptions {
    /// 用户可见名称。
    #[serde(default)]
    pub name: String,
    /// 跳板主机。
    pub host: String,
    /// 跳板 SSH 端口。
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    /// 跳板用户名。
    #[serde(default)]
    pub username: String,
    /// 跳板认证方式。
    #[serde(default)]
    pub auth_type: RemoteHostAuthType,
    /// 跳板私钥路径；密码和内联私钥走 `credential_secret`。
    #[serde(default)]
    pub credential_ref: Option<String>,
    /// 跳板密码或内联私钥内容，随 SSH 配置明文保存。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_secret: Option<String>,
}

/// SSH 终端选项。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTerminalOptions {
    /// 字符编码。
    #[serde(default = "default_terminal_encoding")]
    pub encoding: String,
    /// TERM 环境值。
    #[serde(default = "default_terminal_type")]
    pub terminal_type: String,
    /// 键盘高亮方案。
    #[serde(default = "default_keyboard_profile")]
    pub keyboard_profile: String,
    /// Alt 键修饰行为。
    #[serde(default = "default_alt_modifier")]
    pub alt_modifier: String,
    /// 退格键发送序列。
    #[serde(default = "default_backspace_key")]
    pub backspace_key: String,
    /// Delete 键发送序列。
    #[serde(default = "default_delete_key")]
    pub delete_key: String,
    /// 连接超时秒数。
    #[serde(default = "default_connect_timeout_seconds")]
    pub connect_timeout_seconds: u16,
    /// 心跳间隔秒数；0 表示关闭。
    #[serde(default = "default_keepalive_seconds")]
    pub keepalive_seconds: u16,
    /// 登录后启动命令。
    #[serde(default)]
    pub startup_command: String,
    /// 远端环境变量，KEY=value，每行一项。
    #[serde(default)]
    pub environment: String,
    /// 登录脚本，按行保存。
    #[serde(default)]
    pub login_script: String,
}

impl Default for SshTerminalOptions {
    fn default() -> Self {
        Self {
            encoding: default_terminal_encoding(),
            terminal_type: default_terminal_type(),
            keyboard_profile: default_keyboard_profile(),
            alt_modifier: default_alt_modifier(),
            backspace_key: default_backspace_key(),
            delete_key: default_delete_key(),
            connect_timeout_seconds: default_connect_timeout_seconds(),
            keepalive_seconds: default_keepalive_seconds(),
            startup_command: String::new(),
            environment: String::new(),
            login_script: String::new(),
        }
    }
}

/// SFTP / 传输选项。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTransferOptions {
    /// 是否启用 SFTP。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 远端默认目录。
    #[serde(default)]
    pub remote_start_directory: String,
    /// 本地默认目录。
    #[serde(default)]
    pub local_start_directory: String,
    /// 是否保留文件时间戳。
    #[serde(default = "default_true")]
    pub preserve_timestamps: bool,
    /// 是否跟随符号链接。
    #[serde(default)]
    pub follow_symlinks: bool,
    /// 同时传输数量。
    #[serde(default = "default_max_concurrent_transfers")]
    pub max_concurrent_transfers: u8,
}

impl Default for SshTransferOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            remote_start_directory: String::new(),
            local_start_directory: String::new(),
            preserve_timestamps: true,
            follow_symlinks: false,
            max_concurrent_transfers: default_max_concurrent_transfers(),
        }
    }
}

fn default_ssh_port() -> u16 {
    22
}

fn default_terminal_encoding() -> String {
    "UTF-8".to_owned()
}

fn default_terminal_type() -> String {
    "xterm-256color".to_owned()
}

fn default_keyboard_profile() -> String {
    "default".to_owned()
}

fn default_alt_modifier() -> String {
    "8bit".to_owned()
}

fn default_backspace_key() -> String {
    "ascii-delete".to_owned()
}

fn default_delete_key() -> String {
    "delete-sequence".to_owned()
}

fn default_connect_timeout_seconds() -> u16 {
    30
}

fn default_keepalive_seconds() -> u16 {
    60
}

fn default_true() -> bool {
    true
}

fn default_max_concurrent_transfers() -> u8 {
    4
}

/// 远程主机分组。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroup {
    /// 稳定分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 带主机列表的分组树。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroupWithHosts {
    /// 稳定分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
    /// 该分组下的远程主机。
    pub hosts: Vec<RemoteHost>,
}

/// SSH 远程主机配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHost {
    /// 稳定主机 id。
    pub id: String,
    /// 所属分组 id；为空表示未分组。
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host，可为域名或 IP。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径；密码和内联私钥内容走 `credential_secret`。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥内容，随远程主机记录明文保存。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_secret: Option<String>,
    /// 用户标签。
    pub tags: Vec<String>,
    /// 是否生产主机；后续用于确认策略。
    pub production: bool,
    /// SSH 附加连接选项。
    #[serde(default)]
    pub ssh_options: SshOptions,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 创建远程主机分组请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroupCreateRequest {
    /// 用户可见分组名称。
    pub name: String,
}

/// 更新远程主机分组请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroupUpdateRequest {
    /// 需要更新的分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 列表排序字段。
    pub sort_order: i64,
}

/// 创建远程主机请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostCreateRequest {
    /// 所属分组 id；为空表示未分组。
    #[serde(default)]
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host，可为域名或 IP。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径；密码和内联私钥内容走 `credential_secret`。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥内容，随远程主机记录明文保存。
    #[serde(default)]
    pub credential_secret: Option<String>,
    /// 用户标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 是否生产主机。
    #[serde(default)]
    pub production: bool,
    /// SSH 附加连接选项。
    #[serde(default)]
    pub ssh_options: SshOptions,
}

/// 更新远程主机请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostUpdateRequest {
    /// 需要更新的主机 id。
    pub id: String,
    /// 所属分组 id；为空表示未分组。
    #[serde(default)]
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host，可为域名或 IP。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径；密码和内联私钥内容走 `credential_secret`。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥内容，随远程主机记录明文保存。
    #[serde(default)]
    pub credential_secret: Option<String>,
    /// 用户标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 是否生产主机。
    #[serde(default)]
    pub production: bool,
    /// SSH 附加连接选项。
    #[serde(default)]
    pub ssh_options: SshOptions,
    /// 列表排序字段。
    pub sort_order: i64,
}
