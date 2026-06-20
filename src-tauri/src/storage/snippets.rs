//! 脚本片段 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::snippet::{CommandSnippet, SnippetScope},
    storage::SqliteStore,
};

/// 写入 command_snippets 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSnippetWrite {
    /// 稳定片段 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 命令内容。
    pub command: String,
    /// 标签。
    pub tags: Vec<String>,
    /// 适用范围。
    pub scope: SnippetScope,
    /// 排序字段。
    pub sort_order: i64,
}

impl SqliteStore {
    /// 返回所有脚本片段。
    pub fn list_command_snippets(&self) -> AppResult<Vec<CommandSnippet>> {
        self.with_connection(list_snippets)
    }

    /// 根据 id 读取脚本片段。
    pub fn command_snippet_by_id(&self, snippet_id: &str) -> AppResult<Option<CommandSnippet>> {
        self.with_connection(|conn| query_snippet_by_id_optional(conn, snippet_id))
    }

    /// 返回下一个片段排序值。
    pub fn next_snippet_sort_order(&self) -> AppResult<i64> {
        self.with_connection(|conn| {
            let sort_order: Option<i64> = conn
                .query_row("SELECT MAX(sort_order) FROM command_snippets", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();

            Ok(sort_order.unwrap_or(0) + 10)
        })
    }

    /// 插入脚本片段。
    pub(crate) fn insert_command_snippet(
        &self,
        snippet: &CommandSnippetWrite,
    ) -> AppResult<CommandSnippet> {
        self.with_connection_mut(|conn| {
            let tags_json = serde_json::to_string(&snippet.tags)?;
            conn.execute(
                "
                INSERT INTO command_snippets (
                    id, title, description, command, tags_json, scope, sort_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    snippet.id.as_str(),
                    snippet.title.as_str(),
                    snippet.description.as_deref(),
                    snippet.command.as_str(),
                    tags_json,
                    snippet.scope.as_str(),
                    snippet.sort_order,
                ],
            )?;

            query_snippet_by_id(conn, &snippet.id)
        })
    }

    /// 更新脚本片段。
    pub(crate) fn update_command_snippet(
        &self,
        snippet: &CommandSnippetWrite,
    ) -> AppResult<CommandSnippet> {
        self.with_connection_mut(|conn| {
            if query_snippet_by_id_optional(conn, &snippet.id)?.is_none() {
                return Err(AppError::NotFound(format!(
                    "脚本片段不存在: {}",
                    snippet.id
                )));
            }

            let tags_json = serde_json::to_string(&snippet.tags)?;
            conn.execute(
                "
                UPDATE command_snippets
                SET title = ?2,
                    description = ?3,
                    command = ?4,
                    tags_json = ?5,
                    scope = ?6,
                    sort_order = ?7,
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![
                    snippet.id.as_str(),
                    snippet.title.as_str(),
                    snippet.description.as_deref(),
                    snippet.command.as_str(),
                    tags_json,
                    snippet.scope.as_str(),
                    snippet.sort_order,
                ],
            )?;

            query_snippet_by_id(conn, &snippet.id)
        })
    }

    /// 删除脚本片段。
    pub fn delete_command_snippet(&self, snippet_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected =
                conn.execute("DELETE FROM command_snippets WHERE id = ?1", [snippet_id])?;
            Ok(affected > 0)
        })
    }
}

fn list_snippets(conn: &Connection) -> AppResult<Vec<CommandSnippet>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, title, description, command, tags_json, scope, sort_order, created_at, updated_at
        FROM command_snippets
        ORDER BY sort_order ASC, title ASC
        ",
    )?;

    let snippets = stmt
        .query_map([], snippet_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(snippets)
}

fn query_snippet_by_id(conn: &Connection, snippet_id: &str) -> AppResult<CommandSnippet> {
    query_snippet_by_id_optional(conn, snippet_id)?
        .ok_or_else(|| AppError::NotFound(format!("脚本片段不存在: {snippet_id}")))
}

fn query_snippet_by_id_optional(
    conn: &Connection,
    snippet_id: &str,
) -> AppResult<Option<CommandSnippet>> {
    Ok(conn
        .query_row(
            "
            SELECT id, title, description, command, tags_json, scope, sort_order, created_at, updated_at
            FROM command_snippets
            WHERE id = ?1
            ",
            [snippet_id],
            snippet_from_row,
        )
        .optional()?)
}

fn snippet_from_row(row: &Row<'_>) -> rusqlite::Result<CommandSnippet> {
    let tags_json: String = row.get(4)?;
    let scope: String = row.get(5)?;
    let tags = serde_json::from_str(&tags_json).map_err(json_to_sqlite_error)?;
    let scope = SnippetScope::try_from(scope.as_str()).map_err(string_to_sqlite_error)?;

    Ok(CommandSnippet {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        command: row.get(3)?,
        tags,
        scope,
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
