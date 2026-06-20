//! 脚本片段 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// 脚本片段适用范围。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnippetScope {
    /// 通用于本地和 SSH 终端。
    #[default]
    Any,
    /// 仅建议用于本地终端。
    Local,
    /// 仅建议用于 SSH 远程终端。
    Ssh,
}

impl SnippetScope {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Any => "any",
            Self::Local => "local",
            Self::Ssh => "ssh",
        }
    }
}

impl TryFrom<&str> for SnippetScope {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "any" => Ok(Self::Any),
            "local" => Ok(Self::Local),
            "ssh" => Ok(Self::Ssh),
            _ => Err(format!("未知脚本片段作用域: {value}")),
        }
    }
}

/// 可复用命令或脚本片段。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSnippet {
    /// 稳定片段 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 片段命令内容；不会在创建后自动执行。
    pub command: String,
    /// 标签，用于搜索和分组。
    pub tags: Vec<String>,
    /// 适用范围。
    pub scope: SnippetScope,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 脚本片段列表过滤请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetListRequest {
    /// 搜索关键词，会匹配标题、说明、命令和标签。
    pub query: Option<String>,
    /// 可选作用域过滤。
    pub scope: Option<SnippetScope>,
    /// 可选标签过滤。
    pub tag: Option<String>,
}

/// 创建脚本片段请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetCreateRequest {
    /// 用户可见标题。
    pub title: String,
    /// 片段命令内容。
    pub command: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 适用范围，默认通用。
    #[serde(default)]
    pub scope: SnippetScope,
}

/// 更新脚本片段请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetUpdateRequest {
    /// 需要更新的片段 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 片段命令内容。
    pub command: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 适用范围。
    #[serde(default)]
    pub scope: SnippetScope,
    /// 列表排序字段。
    pub sort_order: i64,
}
