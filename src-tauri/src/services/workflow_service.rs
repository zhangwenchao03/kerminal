//! 命令工作流业务服务。
//!
//! @author kongweiguang

use std::collections::HashSet;

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::workflow::{
        CommandWorkflow, WorkflowCreateRequest, WorkflowListRequest, WorkflowStepInput,
        WorkflowUpdateRequest,
    },
    storage::{
        workflows::{CommandWorkflowStepWrite, CommandWorkflowWrite},
        SqliteStore,
    },
};

const MAX_TITLE_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 500;
const MAX_COMMAND_CHARS: usize = 8_000;
const MAX_TAG_CHARS: usize = 32;
const MAX_TAGS: usize = 12;
const MAX_STEPS: usize = 40;

/// 命令工作流业务入口。
#[derive(Debug, Default)]
pub struct WorkflowService;

impl WorkflowService {
    /// 创建命令工作流服务。
    pub fn new() -> Self {
        Self
    }

    /// 搜索和列出命令工作流。
    pub fn list_workflows(
        &self,
        storage: &SqliteStore,
        request: WorkflowListRequest,
    ) -> AppResult<Vec<CommandWorkflow>> {
        let query = request
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_lowercase());
        let tag = request
            .tag
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_lowercase());

        Ok(storage
            .list_command_workflows()?
            .into_iter()
            .filter(|workflow| request.scope.is_none_or(|scope| workflow.scope == scope))
            .filter(|workflow| {
                tag.as_ref().is_none_or(|tag| {
                    workflow
                        .tags
                        .iter()
                        .any(|workflow_tag| workflow_tag.to_lowercase() == *tag)
                })
            })
            .filter(|workflow| {
                query
                    .as_ref()
                    .is_none_or(|query| workflow_matches_query(workflow, query))
            })
            .collect())
    }

    /// 创建命令工作流。
    pub fn create_workflow(
        &self,
        storage: &SqliteStore,
        request: WorkflowCreateRequest,
    ) -> AppResult<CommandWorkflow> {
        let workflow = CommandWorkflowWrite {
            id: Uuid::new_v4().to_string(),
            title: normalize_required_text("工作流标题", request.title, MAX_TITLE_CHARS)?,
            description: normalize_optional_text(
                "工作流说明",
                request.description,
                MAX_DESCRIPTION_CHARS,
            )?,
            tags: normalize_tags(request.tags)?,
            scope: request.scope,
            steps: normalize_steps(request.steps)?,
            sort_order: storage.next_workflow_sort_order()?,
        };

        storage.insert_command_workflow(&workflow)
    }

    /// 更新命令工作流。
    pub fn update_workflow(
        &self,
        storage: &SqliteStore,
        request: WorkflowUpdateRequest,
    ) -> AppResult<CommandWorkflow> {
        let workflow = CommandWorkflowWrite {
            id: normalize_required_text("工作流 ID", request.id, 120)?,
            title: normalize_required_text("工作流标题", request.title, MAX_TITLE_CHARS)?,
            description: normalize_optional_text(
                "工作流说明",
                request.description,
                MAX_DESCRIPTION_CHARS,
            )?,
            tags: normalize_tags(request.tags)?,
            scope: request.scope,
            steps: normalize_steps(request.steps)?,
            sort_order: request.sort_order,
        };

        storage.update_command_workflow(&workflow)
    }

    /// 删除命令工作流。
    pub fn delete_workflow(&self, storage: &SqliteStore, workflow_id: &str) -> AppResult<bool> {
        let workflow_id = normalize_required_text("工作流 ID", workflow_id.to_owned(), 120)?;
        storage.delete_command_workflow(&workflow_id)
    }
}

fn workflow_matches_query(workflow: &CommandWorkflow, query: &str) -> bool {
    workflow.title.to_lowercase().contains(query)
        || workflow
            .description
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .contains(query)
        || workflow
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(query))
        || workflow.steps.iter().any(|step| {
            step.title.to_lowercase().contains(query)
                || step.command.to_lowercase().contains(query)
                || step
                    .description
                    .as_deref()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(query)
        })
}

fn normalize_steps(steps: Vec<WorkflowStepInput>) -> AppResult<Vec<CommandWorkflowStepWrite>> {
    if steps.is_empty() {
        return Err(AppError::InvalidInput(
            "工作流至少需要一个命令步骤".to_owned(),
        ));
    }
    if steps.len() > MAX_STEPS {
        return Err(AppError::InvalidInput(format!(
            "工作流步骤最多 {MAX_STEPS} 个"
        )));
    }

    steps
        .into_iter()
        .enumerate()
        .map(|(index, step)| {
            Ok(CommandWorkflowStepWrite {
                id: normalize_optional_text("步骤 ID", step.id, 120)?
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                title: normalize_required_text("步骤标题", step.title, MAX_TITLE_CHARS)?,
                description: normalize_optional_text(
                    "步骤说明",
                    step.description,
                    MAX_DESCRIPTION_CHARS,
                )?,
                command: normalize_required_text("步骤命令", step.command, MAX_COMMAND_CHARS)?,
                scope: step.scope,
                requires_confirmation: step.requires_confirmation,
                sort_order: ((index + 1) as i64) * 10,
            })
        })
        .collect()
}

fn normalize_required_text(field: &str, value: String, max_chars: usize) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(value)
}

fn normalize_optional_text(
    field: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Ok(None);
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(Some(value))
}

fn normalize_tags(tags: Vec<String>) -> AppResult<Vec<String>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for tag in tags {
        let tag = tag.trim().to_owned();
        if tag.is_empty() {
            continue;
        }
        ensure_max_chars("工作流标签", &tag, MAX_TAG_CHARS)?;
        if seen.insert(tag.to_lowercase()) {
            normalized.push(tag);
        }
        if normalized.len() > MAX_TAGS {
            return Err(AppError::InvalidInput(format!(
                "工作流标签最多 {MAX_TAGS} 个"
            )));
        }
    }

    Ok(normalized)
}

fn ensure_max_chars(field: &str, value: &str, max_chars: usize) -> AppResult<()> {
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{field}不能超过 {max_chars} 个字符"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::workflow::WorkflowScope;

    #[test]
    fn normalize_steps_assigns_sort_order_and_generates_ids() {
        let steps = normalize_steps(vec![WorkflowStepInput {
            id: None,
            title: " 检查 ".to_owned(),
            command: " npm run check ".to_owned(),
            description: None,
            scope: Some(WorkflowScope::Local),
            requires_confirmation: true,
        }])
        .expect("normalize steps");

        assert_eq!(steps[0].title, "检查");
        assert_eq!(steps[0].command, "npm run check");
        assert_eq!(steps[0].scope, Some(WorkflowScope::Local));
        assert_eq!(steps[0].sort_order, 10);
        assert!(!steps[0].id.is_empty());
    }

    #[test]
    fn normalize_steps_rejects_empty_workflow() {
        let error = normalize_steps(Vec::new()).expect_err("reject empty workflow");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
