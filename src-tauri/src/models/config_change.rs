//! 文件型配置变更事件模型。
//!
//! @author kongweiguang

use std::path::Path;

use serde::{Deserialize, Serialize};

/// 前端监听的配置变更事件名。
pub const CONFIG_CHANGE_EVENT_NAME: &str = "kerminal-config-changed";
/// 配置变更事件 payload 版本。
pub const CONFIG_CHANGE_EVENT_VERSION: u32 = 1;

/// 文件型配置所属域。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigDomain {
    /// `settings.toml`。
    Settings,
    /// `profiles/*.toml`。
    Profiles,
    /// `hosts/groups.toml` 和 `hosts/*.toml`。
    Hosts,
    /// `snippets/*.toml`。
    Snippets,
    /// `workflows/*.toml`。
    Workflows,
}

/// 配置变更批次状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigWatchStatus {
    /// 文件已经过稳定窗口和 typed reader 校验，可以刷新前端事实源。
    Ready,
    /// 文件暂时无效，前端应保留 last-known-good。
    Invalid,
    /// watcher 不可用，自动刷新被禁用或降级失败。
    WatcherUnavailable,
}

/// 配置变更来源提示。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigChangeSourceHint {
    /// Kerminal 内部保存触发。
    Kerminal,
    /// 外部 agent、编辑器或脚本触发。
    External,
    /// 无法可靠判断来源。
    Unknown,
}

/// 配置变更诊断摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangeDiagnostic {
    /// 相关配置域。
    pub domain: Option<ConfigDomain>,
    /// 安全、用户可读的诊断摘要。
    pub message: String,
    /// 可安全展示的相对路径；secret 相关变化必须为 `None`。
    pub path: Option<String>,
    /// TOML 或 schema 诊断行号，1-based。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    /// TOML 或 schema 诊断列号，1-based。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    /// 尽量定位到的 TOML key 或业务字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 可安全展示的恢复建议。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

/// 发送给前端的配置变更批次。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChangeBatch {
    /// payload 版本。
    pub version: u32,
    /// 进程内单调递增序号。
    pub sequence: u64,
    /// 合并后的批次 id。
    pub batch_id: String,
    /// 观察时间，ISO 8601 字符串。
    pub observed_at: String,
    /// 本批次涉及的配置域。
    pub domains: Vec<ConfigDomain>,
    /// 本批次状态。
    pub status: ConfigWatchStatus,
    /// 安全诊断摘要。
    pub diagnostics: Vec<ConfigChangeDiagnostic>,
    /// 来源提示。
    pub source_hint: ConfigChangeSourceHint,
}

/// 配置 watcher 后端。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigWatchBackend {
    /// 原生平台 watcher。
    Native,
    /// 轮询 watcher fallback。
    Polling,
    /// watcher 当前不可用。
    Unavailable,
}

/// 配置 watcher 可诊断状态。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWatchStatusSnapshot {
    /// 是否已启用并尝试启动 watcher。
    pub enabled: bool,
    /// 当前 watcher 后端。
    pub backend: ConfigWatchBackend,
    /// 被监听的配置相对根目录，不包含具体 secret 文件名。
    pub watched_roots: Vec<String>,
    /// 已知忽略项摘要。
    pub ignored_globs: Vec<String>,
    /// 最近一次已发出的事件序号。
    pub last_sequence: u64,
    /// 最近批次观察时间。
    pub last_batch_at: Option<String>,
    /// 最近批次涉及域。
    pub last_domains: Vec<ConfigDomain>,
    /// 最近批次状态。
    pub last_status: Option<ConfigWatchStatus>,
    /// 最近安全错误摘要。
    pub last_error: Option<String>,
    /// fallback 原因。
    pub fallback_reason: Option<String>,
}

/// 配置路径分类结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigPathClassification {
    /// 该路径会失效的配置域。
    pub domain: ConfigDomain,
    /// 可安全展示的相对路径。
    pub safe_relative_path: Option<String>,
}

impl ConfigPathClassification {
    fn public(domain: ConfigDomain, normalized_relative_path: String) -> Self {
        Self {
            domain,
            safe_relative_path: Some(normalized_relative_path),
        }
    }
}

/// 将绝对路径归类到文件型配置域。
pub fn classify_config_path(
    config_root: impl AsRef<Path>,
    path: impl AsRef<Path>,
) -> Option<ConfigPathClassification> {
    let relative = path.as_ref().strip_prefix(config_root.as_ref()).ok()?;
    classify_config_relative_path(relative.to_string_lossy())
}

/// 将配置根下的相对路径归类到文件型配置域。
pub fn classify_config_relative_path(
    relative_path: impl AsRef<str>,
) -> Option<ConfigPathClassification> {
    let segments = normalize_relative_segments(relative_path.as_ref())?;
    let segment_refs = segments.iter().map(String::as_str).collect::<Vec<_>>();
    if should_ignore_path(&segment_refs) {
        return None;
    }

    let normalized_path = segment_refs.join("/");
    match segment_refs.as_slice() {
        ["settings.toml"] => Some(ConfigPathClassification::public(
            ConfigDomain::Settings,
            normalized_path,
        )),
        ["profiles", file_name] if is_toml_file(file_name) => Some(
            ConfigPathClassification::public(ConfigDomain::Profiles, normalized_path),
        ),
        ["hosts", "groups.toml"] => Some(ConfigPathClassification::public(
            ConfigDomain::Hosts,
            normalized_path,
        )),
        ["hosts", file_name] if is_toml_file(file_name) => Some(ConfigPathClassification::public(
            ConfigDomain::Hosts,
            normalized_path,
        )),
        ["snippets", file_name] if is_toml_file(file_name) => Some(
            ConfigPathClassification::public(ConfigDomain::Snippets, normalized_path),
        ),
        ["workflows", file_name] if is_toml_file(file_name) => Some(
            ConfigPathClassification::public(ConfigDomain::Workflows, normalized_path),
        ),
        _ => None,
    }
}

fn normalize_relative_segments(relative_path: &str) -> Option<Vec<String>> {
    let normalized = relative_path.replace('\\', "/");
    let segments = normalized
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if segments.is_empty() || segments.iter().any(|segment| *segment == "..") {
        return None;
    }
    Some(segments)
}

fn should_ignore_path(segments: &[&str]) -> bool {
    let Some(file_name) = segments.last().copied() else {
        return true;
    };
    matches!(
        segments.first().copied(),
        Some("agents" | "backups" | "data" | "workspace")
    ) || matches!(file_name, ".storage.lock" | "storage-manifest.toml")
        || file_name.ends_with(".log")
        || is_temporary_config_name(file_name)
}

fn is_toml_file(file_name: &str) -> bool {
    file_name.ends_with(".toml")
}

fn is_temporary_config_name(file_name: &str) -> bool {
    file_name.starts_with(".tmp-")
        || (file_name.starts_with('.') && file_name.contains(".tmp-"))
        || file_name.ends_with(".tmp")
}
