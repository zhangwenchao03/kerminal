//! 命令工作流 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// 命令工作流适用范围。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkflowScope {
    /// 通用于本地和 SSH 终端。
    #[default]
    Any,
    /// 仅建议用于本地终端。
    Local,
    /// 仅建议用于 SSH 远程终端。
    Ssh,
}

impl WorkflowScope {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Any => "any",
            Self::Local => "local",
            Self::Ssh => "ssh",
        }
    }
}

impl TryFrom<&str> for WorkflowScope {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "any" => Ok(Self::Any),
            "local" => Ok(Self::Local),
            "ssh" => Ok(Self::Ssh),
            _ => Err(format!("未知工作流作用域: {value}")),
        }
    }
}

/// 多步命令工作流。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandWorkflow {
    /// 稳定工作流 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签，用于搜索和分组。
    pub tags: Vec<String>,
    /// 默认适用范围。
    pub scope: WorkflowScope,
    /// 有序步骤。
    pub steps: Vec<CommandWorkflowStep>,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 命令工作流中的一个步骤。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandWorkflowStep {
    /// 稳定步骤 id。
    pub id: String,
    /// 用户可见步骤标题。
    pub title: String,
    /// 步骤命令内容。
    pub command: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 步骤作用域；为空时继承工作流作用域。
    pub scope: Option<WorkflowScope>,
    /// 执行前是否需要 UI 侧显式确认。
    pub requires_confirmation: bool,
    /// 步骤排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 工作流列表过滤请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowListRequest {
    /// 搜索关键词，会匹配标题、说明、命令和标签。
    pub query: Option<String>,
    /// 可选作用域过滤。
    pub scope: Option<WorkflowScope>,
    /// 可选标签过滤。
    pub tag: Option<String>,
}

/// 创建或更新工作流步骤请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepInput {
    /// 更新时可传入既有步骤 id；创建时为空。
    pub id: Option<String>,
    /// 用户可见步骤标题。
    pub title: String,
    /// 步骤命令内容。
    pub command: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 步骤作用域；为空时继承工作流作用域。
    pub scope: Option<WorkflowScope>,
    /// 执行前是否需要 UI 侧显式确认。
    #[serde(default)]
    pub requires_confirmation: bool,
}

/// 创建命令工作流请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCreateRequest {
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 默认适用范围。
    #[serde(default)]
    pub scope: WorkflowScope,
    /// 有序步骤。
    #[serde(default)]
    pub steps: Vec<WorkflowStepInput>,
}

/// 更新命令工作流请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowUpdateRequest {
    /// 需要更新的工作流 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 默认适用范围。
    #[serde(default)]
    pub scope: WorkflowScope,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 有序步骤。
    #[serde(default)]
    pub steps: Vec<WorkflowStepInput>,
}
