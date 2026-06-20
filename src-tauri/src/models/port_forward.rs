//! SSH 端口转发 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// SSH 端口转发类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PortForwardKind {
    /// 本地转发，对应 OpenSSH `-L`。
    Local,
    /// 远程转发，对应 OpenSSH `-R`。
    Remote,
    /// 动态 SOCKS 转发，对应 OpenSSH `-D`。
    Dynamic,
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
    /// 监听地址，默认由服务按类型补 `127.0.0.1`。
    pub bind_host: Option<String>,
    /// 监听端口，本地/动态时是本机端口，远程时是远端监听端口。
    pub source_port: u16,
    /// 目标主机，本地/远程转发必填，动态转发为空。
    pub target_host: Option<String>,
    /// 目标端口，本地/远程转发必填，动态转发为空。
    pub target_port: Option<u16>,
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
    /// 监听地址。
    pub bind_host: String,
    /// 监听端口。
    pub source_port: u16,
    /// 目标主机。
    pub target_host: Option<String>,
    /// 目标端口。
    pub target_port: Option<u16>,
    /// OpenSSH 子进程 pid。
    pub pid: Option<u32>,
    /// 运行状态。
    pub status: PortForwardStatus,
    /// 创建时间，Unix epoch 秒。
    pub created_at: String,
}
