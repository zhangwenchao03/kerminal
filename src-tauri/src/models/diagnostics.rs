//! 诊断包 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// 诊断包生成结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticBundle {
    /// 本次诊断包 id。
    pub id: String,
    /// 生成时间，Unix 秒字符串。
    pub created_at: String,
    /// 诊断包文件名。
    pub file_name: String,
    /// 诊断包完整路径。
    pub path: String,
    /// 写入字节数。
    pub bytes_written: u64,
    /// 本次包含的诊断分区。
    pub sections: Vec<String>,
    /// 是否应用了脱敏策略。
    pub redacted: bool,
}

/// 本机运行体检快照。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthSnapshot {
    /// 采集时间，Unix 秒字符串。
    pub captured_at: String,
    /// 当前 Kerminal 进程资源摘要。
    pub process: RuntimeProcessHealth,
    /// 当前本机系统资源摘要。
    pub system: RuntimeSystemHealth,
    /// Kerminal 本地数据目录摘要。
    pub storage: RuntimeStorageHealth,
    /// 采样说明。
    pub sampling: RuntimeSamplingInfo,
    /// 是否应用了脱敏策略。
    pub redacted: bool,
}

/// 当前进程资源摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProcessHealth {
    /// 进程 ID。
    pub pid: u32,
    /// 进程名。
    pub name: String,
    /// 常驻内存字节数。
    pub memory_bytes: u64,
    /// 虚拟内存字节数。
    pub virtual_memory_bytes: u64,
    /// 当前进程 CPU 使用率百分比。
    pub cpu_usage_percent: f32,
    /// 进程启动时间，Unix 秒。
    pub started_at_seconds: u64,
    /// 进程运行时长，秒。
    pub uptime_seconds: u64,
    /// 进程累计读磁盘字节数。
    pub disk_read_bytes: u64,
    /// 进程累计写磁盘字节数。
    pub disk_written_bytes: u64,
}

/// 本机系统资源摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSystemHealth {
    /// 操作系统名称。
    pub os: String,
    /// CPU 架构。
    pub arch: String,
    /// 主机名。
    pub host_name: Option<String>,
    /// 内核版本。
    pub kernel_version: Option<String>,
    /// 系统版本。
    pub os_version: Option<String>,
    /// CPU 数量。
    pub cpu_count: usize,
    /// 全局 CPU 使用率百分比。
    pub global_cpu_usage_percent: f32,
    /// 每个 CPU 核心的使用率百分比。
    pub cpu_core_usage_percents: Vec<f32>,
    /// 总内存字节数。
    pub total_memory_bytes: u64,
    /// 已用内存字节数。
    pub used_memory_bytes: u64,
    /// 可用内存字节数。
    pub available_memory_bytes: u64,
    /// 总 swap 字节数。
    pub total_swap_bytes: u64,
    /// 已用 swap 字节数。
    pub used_swap_bytes: u64,
    /// 系统运行时长，秒。
    pub uptime_seconds: u64,
    /// 系统启动时间，Unix 秒。
    pub boot_time_seconds: u64,
    /// 本机可识别显卡摘要。
    pub gpus: Vec<RuntimeGpuHealth>,
}

/// 本机显卡资源摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeGpuHealth {
    /// 显卡名称。
    pub name: String,
    /// 显卡厂商。
    pub vendor: Option<String>,
    /// 驱动版本。
    pub driver_version: Option<String>,
    /// 显存总量，单位字节。
    pub memory_total_bytes: Option<u64>,
    /// 显存已用量，单位字节。
    pub memory_used_bytes: Option<u64>,
    /// GPU 使用率百分比。
    pub utilization_percent: Option<f32>,
    /// GPU 温度，摄氏度。
    pub temperature_celsius: Option<f32>,
}

/// Kerminal 本地数据目录摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStorageHealth {
    /// `~/.kerminal` 根目录。
    pub root: String,
    /// SQLite 数据库文件路径。
    pub database_file: String,
    /// 日志目录路径。
    pub logs: String,
    /// 诊断目录路径。
    pub diagnostics: String,
    /// 数据目录总字节数。
    pub root_size_bytes: u64,
    /// SQLite 数据库文件字节数。
    pub database_file_size_bytes: u64,
}

/// 运行体检采样说明。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSamplingInfo {
    /// 系统信息来源。
    pub source: String,
    /// CPU 两次刷新之间的采样间隔毫秒数。
    pub cpu_sample_interval_ms: u64,
    /// CPU 指标是否完成两次刷新。
    pub cpu_refreshed_twice: bool,
}
