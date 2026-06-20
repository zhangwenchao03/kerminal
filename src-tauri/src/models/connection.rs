//! 连接启动 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// RDP 系统客户端启动请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RdpOpenRequest {
    /// 用户可见连接名称，仅用于生成临时文件名和前端展示。
    pub name: String,
    /// RDP 主机，可为域名、IPv4 或 IPv6。
    pub host: String,
    /// RDP 端口。
    pub port: u16,
    /// 可选用户名；为空时由系统客户端提示。
    pub username: Option<String>,
    /// 可选密码；仅用于本次启动系统客户端，不写入数据库。
    pub password: Option<String>,
    /// 是否全屏启动。
    #[serde(default)]
    pub fullscreen: bool,
    /// 固定窗口宽度；非全屏时可用。
    pub desktop_width: Option<u32>,
    /// 固定窗口高度；非全屏时可用。
    pub desktop_height: Option<u32>,
    /// 用户备注；当前仅保留在请求模型中，便于后续保存配置。
    pub note: Option<String>,
}

/// RDP 系统客户端启动结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RdpOpenResult {
    /// 是否已成功请求系统客户端启动。
    pub launched: bool,
    /// 用户可见结果信息。
    pub message: String,
    /// 生成的临时 .rdp 文件路径。
    pub file_path: Option<String>,
}
