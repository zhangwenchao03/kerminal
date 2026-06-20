//! SSH 远程命令 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// SSH 非交互命令执行请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshCommandRequest {
    /// 已保存远程主机 id。
    pub host_id: String,
    /// 需要在远端 shell 中执行的命令或脚本片段。
    pub command: String,
    /// 命令超时时间，单位秒；为空时使用服务默认值。
    pub timeout_seconds: Option<u64>,
    /// stdout/stderr 各自最多保留的字节数；为空时使用服务默认值。
    pub max_output_bytes: Option<usize>,
}

/// SSH 非交互命令执行结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshCommandOutput {
    /// 已保存远程主机 id。
    pub host_id: String,
    /// 用户可见主机名称。
    pub host_name: String,
    /// SSH host。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 进程退出码；被信号终止等平台行为可能没有退出码。
    pub exit_code: Option<i32>,
    /// 是否以成功状态退出。
    pub success: bool,
    /// stdout 受限片段，使用 UTF-8 lossless/lossy 展示。
    pub stdout: String,
    /// stderr 受限片段，使用 UTF-8 lossless/lossy 展示。
    pub stderr: String,
    /// stdout 已捕获字节数。
    pub stdout_bytes: usize,
    /// stderr 已捕获字节数。
    pub stderr_bytes: usize,
    /// stdout 是否因为超出上限被截断。
    pub stdout_truncated: bool,
    /// stderr 是否因为超出上限被截断。
    pub stderr_truncated: bool,
    /// 本次使用的输出上限。
    pub max_output_bytes: usize,
    /// 实际执行耗时，单位毫秒。
    pub duration_ms: u128,
}
