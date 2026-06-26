//! tmux 管理 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::{target::RemoteTargetRef, terminal::TerminalCreateRequest};

/// tmux 命令执行目标和 server socket 范围。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxTargetRef {
    /// Kerminal 统一目标引用。
    pub target: RemoteTargetRef,
    /// tmux `-L` socket 名称；不能和 `socket_path` 同时使用。
    #[serde(default)]
    pub socket_name: Option<String>,
    /// tmux `-S` socket 路径；由目标机器解释。
    #[serde(default)]
    pub socket_path: Option<String>,
    /// 可选 tmux 可执行文件路径。
    #[serde(default)]
    pub tmux_path: Option<String>,
}

/// tmux 可用性探测请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxProbeRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
}

/// tmux server/session 列表请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxListSessionsRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
}

/// tmux session 创建请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCreateSessionRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// 新 session 名称。
    pub name: String,
    /// 可选初始目录。
    #[serde(default)]
    pub cwd: Option<String>,
}

/// tmux session 重命名请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxRenameSessionRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// 原 session id 或名称。
    pub session_id: String,
    /// 新 session 名称。
    pub name: String,
}

/// tmux session 删除请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxKillSessionRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// session id 或名称。
    pub session_id: String,
}

/// tmux session 下 window 列表请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxListWindowsRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// session id 或名称。
    pub session_id: String,
}

/// tmux pane 列表请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxListPanesRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// session、window 或 pane id。
    pub target_id: String,
}

/// tmux pane 只读预览请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCapturePaneRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// pane id，例如 `%1`。
    pub pane_id: String,
    /// 最多捕获最近多少行。
    #[serde(default)]
    pub lines: Option<u16>,
}

/// tmux attach 终端启动规格请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxAttachSessionRequest {
    /// 目标和 socket 范围。
    pub target: TmuxTargetRef,
    /// session id 或名称。
    pub session_id: String,
    /// 展示用 session 名称。
    #[serde(default)]
    pub session_name: Option<String>,
    /// 可选初始目录。
    #[serde(default)]
    pub cwd: Option<String>,
}

/// tmux detach 当前 attach pane 请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxDetachCurrentRequest {
    /// 前端当前 Kerminal pane id。
    pub pane_id: String,
}

/// tmux 可用性状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCapabilityStatus {
    /// 目标稳定 id。
    pub target_ref: String,
    /// 原始目标引用。
    pub target: RemoteTargetRef,
    /// 当前目标是否能执行 tmux。
    pub available: bool,
    /// tmux 版本，例如 `tmux 3.4`。
    #[serde(default)]
    pub version: Option<String>,
    /// 不可用或检测失败原因。
    #[serde(default)]
    pub reason: Option<String>,
    /// 当前使用的 socket 名称。
    #[serde(default)]
    pub socket_name: Option<String>,
    /// 当前使用的 socket 路径。
    #[serde(default)]
    pub socket_path: Option<String>,
}

/// tmux session 运行状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TmuxSessionStatus {
    /// 目标侧仍存在。
    Running,
    /// 前端上一轮看到过但本轮操作发现已不存在。
    Stale,
}

/// tmux session 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSessionSummary {
    /// tmux session id，例如 `$0`。
    pub id: String,
    /// tmux session 名称。
    pub name: String,
    /// 是否已有 client attach。
    pub attached: bool,
    /// window 数。
    pub windows: u32,
    /// client 数。
    pub clients: u32,
    /// session 当前目录。
    #[serde(default)]
    pub current_path: Option<String>,
    /// 创建时间 Unix 秒。
    #[serde(default)]
    pub created_at: Option<u64>,
    /// 最近活动 Unix 秒。
    #[serde(default)]
    pub activity_at: Option<u64>,
    /// 目标稳定 id。
    pub target_ref: String,
    /// 当前状态。
    pub status: TmuxSessionStatus,
}

/// tmux window 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindowSummary {
    /// window id，例如 `@1`。
    pub id: String,
    /// session id。
    pub session_id: String,
    /// window index。
    pub index: u32,
    /// window 名称。
    pub name: String,
    /// 是否当前 active window。
    pub active: bool,
    /// pane 数。
    pub panes: u32,
    /// window layout。
    #[serde(default)]
    pub layout: Option<String>,
    /// tmux window flags。
    #[serde(default)]
    pub flags: Option<String>,
}

/// tmux pane 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneSummary {
    /// pane id，例如 `%1`。
    pub id: String,
    /// window id。
    pub window_id: String,
    /// pane index。
    pub index: u32,
    /// 是否当前 active pane。
    pub active: bool,
    /// 当前目录。
    #[serde(default)]
    pub current_path: Option<String>,
    /// 当前命令。
    #[serde(default)]
    pub current_command: Option<String>,
    /// pane 标题。
    #[serde(default)]
    pub title: Option<String>,
    /// 宽度列数。
    pub width: u32,
    /// 高度行数。
    pub height: u32,
    /// 是否 dead pane。
    pub dead: bool,
}

/// tmux pane 只读预览。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneCapture {
    /// pane id。
    pub pane_id: String,
    /// 捕获内容。
    pub text: String,
    /// 返回行数上限。
    pub lines: u16,
    /// 内容是否被行数限制截断。
    pub truncated: bool,
}

/// tmux attach pane 绑定信息。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneBinding {
    /// 目标稳定 id。
    pub target_ref: String,
    /// session id 或名称。
    pub session_id: String,
    /// 展示用 session 名称。
    pub session_name: String,
    /// socket 名称。
    #[serde(default)]
    pub socket_name: Option<String>,
    /// socket 路径。
    #[serde(default)]
    pub socket_path: Option<String>,
    /// 绑定创建时间，Unix 秒字符串。
    pub attached_at: String,
}

/// tmux attach 终端启动模式。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum TmuxAttachLaunch {
    /// 本地 tmux 终端启动规格。
    Local {
        /// Terminal pane 启动参数。
        terminal: TerminalCreateRequest,
        /// pane 标题。
        title: String,
        /// tmux binding 元数据。
        binding: TmuxPaneBinding,
    },
    /// SSH 远端 tmux 终端启动规格。
    Ssh {
        /// SSH 主机 id。
        host_id: String,
        /// 远端 shell 命令，交给后端 SSH terminal service 执行。
        remote_command: String,
        /// 可选初始目录。
        #[serde(default)]
        cwd: Option<String>,
        /// pane 标题。
        title: String,
        /// tmux binding 元数据。
        binding: TmuxPaneBinding,
    },
}
