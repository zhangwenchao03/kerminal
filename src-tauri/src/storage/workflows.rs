//! 命令工作流 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::workflow::{CommandWorkflow, CommandWorkflowStep, WorkflowScope},
    storage::SqliteStore,
};

/// 写入 command_workflows 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandWorkflowWrite {
    /// 稳定工作流 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    pub tags: Vec<String>,
    /// 默认适用范围。
    pub scope: WorkflowScope,
    /// 有序步骤。
    pub steps: Vec<CommandWorkflowStepWrite>,
    /// 排序字段。
    pub sort_order: i64,
}

/// 写入 command_workflow_steps 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandWorkflowStepWrite {
    /// 稳定步骤 id。
    pub id: String,
    /// 用户可见步骤标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 步骤命令内容。
    pub command: String,
    /// 步骤作用域；为空时继承工作流作用域。
    pub scope: Option<WorkflowScope>,
    /// 执行前是否需要 UI 侧显式确认。
    pub requires_confirmation: bool,
    /// 排序字段。
    pub sort_order: i64,
}

impl SqliteStore {
    /// 返回所有命令工作流。
    pub fn list_command_workflows(&self) -> AppResult<Vec<CommandWorkflow>> {
        self.with_connection(list_workflows)
    }

    /// 根据 id 读取命令工作流。
    pub fn command_workflow_by_id(&self, workflow_id: &str) -> AppResult<Option<CommandWorkflow>> {
        self.with_connection(|conn| query_workflow_by_id_optional(conn, workflow_id))
    }

    /// 返回下一个工作流排序值。
    pub fn next_workflow_sort_order(&self) -> AppResult<i64> {
        self.with_connection(|conn| {
            let sort_order: Option<i64> = conn
                .query_row("SELECT MAX(sort_order) FROM command_workflows", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();

            Ok(sort_order.unwrap_or(0) + 10)
        })
    }

    /// 插入命令工作流及其步骤。
    pub(crate) fn insert_command_workflow(
        &self,
        workflow: &CommandWorkflowWrite,
    ) -> AppResult<CommandWorkflow> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            let tags_json = serde_json::to_string(&workflow.tags)?;

            tx.execute(
                "
                INSERT INTO command_workflows (
                    id, title, description, tags_json, scope, sort_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ",
                params![
                    workflow.id.as_str(),
                    workflow.title.as_str(),
                    workflow.description.as_deref(),
                    tags_json,
                    workflow.scope.as_str(),
                    workflow.sort_order,
                ],
            )?;

            insert_steps(&tx, &workflow.id, &workflow.steps)?;
            tx.commit()?;

            query_workflow_by_id(conn, &workflow.id)
        })
    }

    /// 更新命令工作流并整体替换步骤。
    pub(crate) fn update_command_workflow(
        &self,
        workflow: &CommandWorkflowWrite,
    ) -> AppResult<CommandWorkflow> {
        self.with_connection_mut(|conn| {
            if query_workflow_by_id_optional(conn, &workflow.id)?.is_none() {
                return Err(AppError::NotFound(format!(
                    "命令工作流不存在: {}",
                    workflow.id
                )));
            }

            let tx = conn.transaction()?;
            let tags_json = serde_json::to_string(&workflow.tags)?;

            tx.execute(
                "
                UPDATE command_workflows
                SET title = ?2,
                    description = ?3,
                    tags_json = ?4,
                    scope = ?5,
                    sort_order = ?6,
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![
                    workflow.id.as_str(),
                    workflow.title.as_str(),
                    workflow.description.as_deref(),
                    tags_json,
                    workflow.scope.as_str(),
                    workflow.sort_order,
                ],
            )?;

            tx.execute(
                "DELETE FROM command_workflow_steps WHERE workflow_id = ?1",
                [workflow.id.as_str()],
            )?;
            insert_steps(&tx, &workflow.id, &workflow.steps)?;
            tx.commit()?;

            query_workflow_by_id(conn, &workflow.id)
        })
    }

    /// 删除命令工作流。
    pub fn delete_command_workflow(&self, workflow_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected =
                conn.execute("DELETE FROM command_workflows WHERE id = ?1", [workflow_id])?;
            Ok(affected > 0)
        })
    }
}

fn list_workflows(conn: &Connection) -> AppResult<Vec<CommandWorkflow>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, title, description, tags_json, scope, sort_order, created_at, updated_at
        FROM command_workflows
        ORDER BY sort_order ASC, title ASC
        ",
    )?;

    let rows = stmt
        .query_map([], workflow_header_from_row)?
        .collect::<Result<Vec<_>, _>>()?;

    rows.into_iter()
        .map(|header| attach_steps(conn, header))
        .collect()
}

fn query_workflow_by_id(conn: &Connection, workflow_id: &str) -> AppResult<CommandWorkflow> {
    query_workflow_by_id_optional(conn, workflow_id)?
        .ok_or_else(|| AppError::NotFound(format!("命令工作流不存在: {workflow_id}")))
}

fn query_workflow_by_id_optional(
    conn: &Connection,
    workflow_id: &str,
) -> AppResult<Option<CommandWorkflow>> {
    let header = conn
        .query_row(
            "
            SELECT id, title, description, tags_json, scope, sort_order, created_at, updated_at
            FROM command_workflows
            WHERE id = ?1
            ",
            [workflow_id],
            workflow_header_from_row,
        )
        .optional()?;

    header.map(|header| attach_steps(conn, header)).transpose()
}

fn attach_steps(conn: &Connection, mut workflow: CommandWorkflow) -> AppResult<CommandWorkflow> {
    workflow.steps = list_steps_for_workflow(conn, &workflow.id)?;
    Ok(workflow)
}

fn list_steps_for_workflow(
    conn: &Connection,
    workflow_id: &str,
) -> AppResult<Vec<CommandWorkflowStep>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, title, description, command, scope, requires_confirmation,
               sort_order, created_at, updated_at
        FROM command_workflow_steps
        WHERE workflow_id = ?1
        ORDER BY sort_order ASC, title ASC
        ",
    )?;

    let steps = stmt
        .query_map([workflow_id], workflow_step_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(steps)
}

fn insert_steps(
    conn: &Connection,
    workflow_id: &str,
    steps: &[CommandWorkflowStepWrite],
) -> AppResult<()> {
    for step in steps {
        conn.execute(
            "
            INSERT INTO command_workflow_steps (
                id, workflow_id, title, description, command, scope,
                requires_confirmation, sort_order
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ",
            params![
                step.id.as_str(),
                workflow_id,
                step.title.as_str(),
                step.description.as_deref(),
                step.command.as_str(),
                step.scope.map(WorkflowScope::as_str),
                if step.requires_confirmation {
                    1_i64
                } else {
                    0_i64
                },
                step.sort_order,
            ],
        )?;
    }

    Ok(())
}

fn workflow_header_from_row(row: &Row<'_>) -> rusqlite::Result<CommandWorkflow> {
    let tags_json: String = row.get(3)?;
    let scope: String = row.get(4)?;
    let tags = serde_json::from_str(&tags_json).map_err(json_to_sqlite_error)?;
    let scope = WorkflowScope::try_from(scope.as_str()).map_err(string_to_sqlite_error)?;

    Ok(CommandWorkflow {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        tags,
        scope,
        steps: Vec::new(),
        sort_order: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn workflow_step_from_row(row: &Row<'_>) -> rusqlite::Result<CommandWorkflowStep> {
    let scope: Option<String> = row.get(4)?;
    let scope = scope
        .as_deref()
        .map(WorkflowScope::try_from)
        .transpose()
        .map_err(string_to_sqlite_error)?;
    let requires_confirmation: i64 = row.get(5)?;

    Ok(CommandWorkflowStep {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        command: row.get(3)?,
        scope,
        requires_confirmation: requires_confirmation == 1,
        sort_order: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn json_to_sqlite_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn string_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(AppError::InvalidInput(error)),
    )
}
