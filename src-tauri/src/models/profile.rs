//! 终端 Profile IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 本地终端 Profile。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    /// 稳定 profile id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// 启动的 shell 或可执行文件。
    pub shell: String,
    /// 传给 shell 的默认参数。
    pub args: Vec<String>,
    /// 默认工作目录；为空时继承应用当前目录。
    pub cwd: Option<String>,
    /// profile 级环境变量覆盖。
    pub env: HashMap<String, String>,
    /// 是否为默认本地终端 profile。
    pub is_default: bool,
    /// 如果该 profile 被固定到左侧主机树，记录所属分组。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidebar_group_id: Option<String>,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间，SQLite `datetime('now')` 文本。
    pub created_at: String,
    /// 更新时间，SQLite `datetime('now')` 文本。
    pub updated_at: String,
}

/// 创建终端 Profile 的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCreateRequest {
    /// 用户可见名称。
    pub name: String,
    /// 启动的 shell 或可执行文件。
    pub shell: String,
    /// 传给 shell 的默认参数。
    #[serde(default)]
    pub args: Vec<String>,
    /// 默认工作目录。
    pub cwd: Option<String>,
    /// profile 级环境变量覆盖。
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 创建后是否设为默认 profile。
    #[serde(default)]
    pub set_default: bool,
    /// 创建后固定到左侧主机树时使用的分组 id。
    #[serde(default)]
    pub sidebar_group_id: Option<String>,
}

/// 更新终端 Profile 的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileUpdateRequest {
    /// 需要更新的 profile id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// 启动的 shell 或可执行文件。
    pub shell: String,
    /// 传给 shell 的默认参数。
    #[serde(default)]
    pub args: Vec<String>,
    /// 默认工作目录。
    pub cwd: Option<String>,
    /// profile 级环境变量覆盖。
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 是否设为默认 profile。
    #[serde(default)]
    pub set_default: bool,
    /// 固定到左侧主机树时使用的分组 id；传空字符串表示取消固定。
    #[serde(default)]
    pub sidebar_group_id: Option<String>,
    /// 列表排序字段。
    pub sort_order: i64,
}

/// shell 候选来源。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShellCandidateSource {
    /// 来自当前环境变量。
    Environment,
    /// 来自 PATH 搜索。
    Path,
    /// 来自平台常见安装路径。
    CommonPath,
    /// 来自兜底默认值。
    Fallback,
}

/// 默认 shell 探测候选。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellCandidate {
    /// 稳定候选 id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// shell 或可执行文件路径。
    pub shell: String,
    /// 默认启动参数。
    pub args: Vec<String>,
    /// 候选来源。
    pub source: ShellCandidateSource,
    /// 当前主机上是否探测可用。
    pub is_available: bool,
    /// 是否建议作为默认 profile。
    pub is_default: bool,
}
