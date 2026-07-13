//! 命令历史 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::command_history::{CommandHistoryEntry, CommandHistorySource, CommandHistoryTarget},
    storage::CommandSqliteStore,
};

/// 写入 command_history 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandHistoryWrite {
    /// 稳定历史 id。
    pub id: String,
    /// 命令内容。
    pub command: String,
    /// 命令来源。
    pub source: CommandHistorySource,
    /// 命令目标。
    pub target: CommandHistoryTarget,
    /// 终端 session id。
    pub session_id: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 前端 tab id。
    pub tab_id: Option<String>,
    /// 本地 profile id。
    pub profile_id: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 工作目录。
    pub cwd: Option<String>,
    /// shell。
    pub shell: Option<String>,
}

/// command_history 列表过滤条件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandHistoryListFilter<'a> {
    /// 搜索关键词，小写后按 contains 语义匹配。
    pub query: Option<&'a str>,
    /// 来源过滤。
    pub source: Option<CommandHistorySource>,
    /// 目标过滤。
    pub target: Option<CommandHistoryTarget>,
    /// 前端 pane id 过滤。
    pub pane_id: Option<&'a str>,
    /// SSH 主机过滤。
    pub remote_host_id: Option<&'a str>,
    /// 终端 session 过滤。
    pub session_id: Option<&'a str>,
    /// 返回数量上限。
    pub limit: usize,
}

/// command_history 删除范围；字段全部为空时匹配全部历史。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandHistoryClearFilter<'a> {
    /// 目标类型过滤。
    pub target: Option<CommandHistoryTarget>,
    /// 前端 pane id 过滤。
    pub pane_id: Option<&'a str>,
    /// SSH 主机过滤。
    pub remote_host_id: Option<&'a str>,
    /// 终端 session 过滤。
    pub session_id: Option<&'a str>,
}

impl CommandSqliteStore {
    /// 返回全部命令历史，按最新优先排序。
    pub fn list_command_history(&self) -> AppResult<Vec<CommandHistoryEntry>> {
        self.with_connection(list_history)
    }

    /// 按条件返回命令历史，按最新优先排序。
    pub(crate) fn list_command_history_filtered(
        &self,
        filter: &CommandHistoryListFilter<'_>,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        self.with_connection(|conn| list_history_filtered(conn, filter))
    }

    /// 按命令前缀返回命令建议候选历史，按最新优先排序。
    pub(crate) fn list_command_history_by_command_prefix(
        &self,
        target: CommandHistoryTarget,
        remote_host_id: Option<&str>,
        command_prefix: &str,
        limit: usize,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        self.with_connection(|conn| {
            list_history_by_command_prefix(conn, target, remote_host_id, command_prefix, limit)
        })
    }

    /// 为候选菜单返回有界最近历史；调用方在内存中执行词级匹配。
    pub(crate) fn list_recent_command_history_for_suggestions(
        &self,
        target: CommandHistoryTarget,
        remote_host_id: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        self.with_connection(|conn| {
            list_recent_history_for_suggestions(conn, target, remote_host_id, limit)
        })
    }

    /// 根据 id 读取命令历史。
    pub fn command_history_by_id(&self, entry_id: &str) -> AppResult<Option<CommandHistoryEntry>> {
        self.with_connection(|conn| query_history_by_id_optional(conn, entry_id))
    }

    /// 插入命令历史。
    pub(crate) fn insert_command_history(
        &self,
        entry: &CommandHistoryWrite,
    ) -> AppResult<CommandHistoryEntry> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO command_history (
                    id, command, source, target, session_id, pane_id, tab_id,
                    profile_id, remote_host_id, cwd, shell
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                params![
                    entry.id.as_str(),
                    entry.command.as_str(),
                    entry.source.as_str(),
                    entry.target.as_str(),
                    entry.session_id.as_deref(),
                    entry.pane_id.as_deref(),
                    entry.tab_id.as_deref(),
                    entry.profile_id.as_deref(),
                    entry.remote_host_id.as_deref(),
                    entry.cwd.as_deref(),
                    entry.shell.as_deref(),
                ],
            )?;

            query_history_by_id(conn, &entry.id)
        })
    }

    /// 删除一条命令历史。
    pub fn delete_command_history(&self, entry_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected = conn.execute("DELETE FROM command_history WHERE id = ?1", [entry_id])?;
            Ok(affected > 0)
        })
    }

    /// 清空命令历史。
    pub fn clear_command_history(&self) -> AppResult<usize> {
        self.with_connection_mut(|conn| Ok(conn.execute("DELETE FROM command_history", [])?))
    }

    /// 按 pane/目标/主机/session 范围删除命令历史。
    pub(crate) fn clear_command_history_filtered(
        &self,
        filter: &CommandHistoryClearFilter<'_>,
    ) -> AppResult<usize> {
        self.with_connection_mut(|conn| {
            Ok(conn.execute(
                "
                DELETE FROM command_history
                WHERE (?1 IS NULL OR target = ?1)
                  AND (?2 IS NULL OR pane_id = ?2)
                  AND (?3 IS NULL OR remote_host_id = ?3)
                  AND (?4 IS NULL OR session_id = ?4)
                ",
                params![
                    filter.target.map(CommandHistoryTarget::as_str),
                    filter.pane_id,
                    filter.remote_host_id,
                    filter.session_id,
                ],
            )?)
        })
    }
}

fn list_history(conn: &Connection) -> AppResult<Vec<CommandHistoryEntry>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, command, source, target, session_id, pane_id, tab_id,
               profile_id, remote_host_id, cwd, shell, created_at
        FROM command_history
        ORDER BY created_at DESC, rowid DESC
        ",
    )?;

    let entries = stmt
        .query_map([], history_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

fn list_history_filtered(
    conn: &Connection,
    filter: &CommandHistoryListFilter<'_>,
) -> AppResult<Vec<CommandHistoryEntry>> {
    let source = filter.source.map(CommandHistorySource::as_str);
    let target = filter.target.map(CommandHistoryTarget::as_str);
    let query_like = filter.query.map(like_contains_pattern);
    let limit = i64::try_from(filter.limit).unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "
        SELECT id, command, source, target, session_id, pane_id, tab_id,
               profile_id, remote_host_id, cwd, shell, created_at
        FROM command_history
        WHERE (?1 IS NULL OR source = ?1)
          AND (?2 IS NULL OR target = ?2)
          AND (?3 IS NULL OR pane_id = ?3)
          AND (?4 IS NULL OR remote_host_id = ?4)
          AND (?5 IS NULL OR session_id = ?5)
          AND (
              ?6 IS NULL
              OR lower(command) LIKE ?6 ESCAPE '\\'
              OR lower(coalesce(cwd, '')) LIKE ?6 ESCAPE '\\'
              OR lower(coalesce(shell, '')) LIKE ?6 ESCAPE '\\'
              OR lower(coalesce(remote_host_id, '')) LIKE ?6 ESCAPE '\\'
              OR lower(coalesce(pane_id, '')) LIKE ?6 ESCAPE '\\'
          )
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?7
        ",
    )?;

    let entries = stmt
        .query_map(
            params![
                source,
                target,
                filter.pane_id,
                filter.remote_host_id,
                filter.session_id,
                query_like,
                limit,
            ],
            history_from_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

fn list_history_by_command_prefix(
    conn: &Connection,
    target: CommandHistoryTarget,
    remote_host_id: Option<&str>,
    command_prefix: &str,
    limit: usize,
) -> AppResult<Vec<CommandHistoryEntry>> {
    let limit = limit.max(1);
    let mut entries =
        list_recent_history_by_command_prefix(conn, target, remote_host_id, command_prefix, limit)?;
    if entries.len() >= limit {
        return Ok(entries);
    }

    for entry in
        list_history_by_command_prefix_range(conn, target, remote_host_id, command_prefix, limit)?
    {
        if entries.len() >= limit {
            break;
        }
        if !entries.iter().any(|existing| existing.id == entry.id) {
            entries.push(entry);
        }
    }

    Ok(entries)
}

fn list_recent_history_for_suggestions(
    conn: &Connection,
    target: CommandHistoryTarget,
    remote_host_id: Option<&str>,
    limit: usize,
) -> AppResult<Vec<CommandHistoryEntry>> {
    let limit = i64::try_from(limit.max(1)).unwrap_or(i64::MAX);
    let entries = if let Some(remote_host_id) = remote_host_id {
        let mut stmt = conn.prepare(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history NOT INDEXED
            WHERE target = ?1
              AND remote_host_id = ?2
            ORDER BY rowid DESC
            LIMIT ?3
            ",
        )?;
        let rows = stmt
            .query_map(
                params![target.as_str(), remote_host_id, limit],
                history_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let mut stmt = conn.prepare(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history NOT INDEXED
            WHERE target = ?1
            ORDER BY rowid DESC
            LIMIT ?2
            ",
        )?;
        let rows = stmt
            .query_map(params![target.as_str(), limit], history_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(entries)
}

fn list_recent_history_by_command_prefix(
    conn: &Connection,
    target: CommandHistoryTarget,
    remote_host_id: Option<&str>,
    command_prefix: &str,
    limit: usize,
) -> AppResult<Vec<CommandHistoryEntry>> {
    let scan_limit = i64::try_from(limit.saturating_mul(2).max(16)).unwrap_or(i64::MAX);
    let mut entries = if let Some(remote_host_id) = remote_host_id {
        let mut stmt = conn.prepare(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history NOT INDEXED
            WHERE target = ?1
              AND remote_host_id = ?2
            ORDER BY rowid DESC
            LIMIT ?3
            ",
        )?;
        let rows = stmt
            .query_map(
                params![target.as_str(), remote_host_id, scan_limit],
                history_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let mut stmt = conn.prepare(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history NOT INDEXED
            WHERE target = ?1
            ORDER BY rowid DESC
            LIMIT ?2
            ",
        )?;
        let rows = stmt
            .query_map(params![target.as_str(), scan_limit], history_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    entries.retain(|entry| entry.command.starts_with(command_prefix));
    entries.truncate(limit);
    Ok(entries)
}

fn list_history_by_command_prefix_range(
    conn: &Connection,
    target: CommandHistoryTarget,
    remote_host_id: Option<&str>,
    command_prefix: &str,
    limit: usize,
) -> AppResult<Vec<CommandHistoryEntry>> {
    let upper_bound = command_prefix_upper_bound(command_prefix);
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let entries = if let Some(remote_host_id) = remote_host_id {
        let mut stmt = conn.prepare(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history
            WHERE target = ?1
              AND remote_host_id = ?2
              AND command >= ?3
              AND command < ?4
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?5
            ",
        )?;
        let rows = stmt
            .query_map(
                params![
                    target.as_str(),
                    remote_host_id,
                    command_prefix,
                    upper_bound,
                    limit,
                ],
                history_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let mut stmt = conn.prepare(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history
            WHERE target = ?1
              AND command >= ?2
              AND command < ?3
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?4
            ",
        )?;
        let rows = stmt
            .query_map(
                params![target.as_str(), command_prefix, upper_bound, limit],
                history_from_row,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(entries)
}

fn command_prefix_upper_bound(command_prefix: &str) -> String {
    format!("{command_prefix}\u{10FFFF}")
}

fn query_history_by_id(conn: &Connection, entry_id: &str) -> AppResult<CommandHistoryEntry> {
    query_history_by_id_optional(conn, entry_id)?
        .ok_or_else(|| AppError::NotFound(format!("命令历史不存在: {entry_id}")))
}

fn query_history_by_id_optional(
    conn: &Connection,
    entry_id: &str,
) -> AppResult<Option<CommandHistoryEntry>> {
    Ok(conn
        .query_row(
            "
            SELECT id, command, source, target, session_id, pane_id, tab_id,
                   profile_id, remote_host_id, cwd, shell, created_at
            FROM command_history
            WHERE id = ?1
            ",
            [entry_id],
            history_from_row,
        )
        .optional()?)
}

fn history_from_row(row: &Row<'_>) -> rusqlite::Result<CommandHistoryEntry> {
    let source: String = row.get(2)?;
    let target: String = row.get(3)?;
    let source = CommandHistorySource::try_from(source.as_str()).map_err(string_to_sqlite_error)?;
    let target = CommandHistoryTarget::try_from(target.as_str()).map_err(string_to_sqlite_error)?;

    Ok(CommandHistoryEntry {
        id: row.get(0)?,
        command: row.get(1)?,
        source,
        target,
        session_id: row.get(4)?,
        pane_id: row.get(5)?,
        tab_id: row.get(6)?,
        profile_id: row.get(7)?,
        remote_host_id: row.get(8)?,
        cwd: row.get(9)?,
        shell: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn like_contains_pattern(query: &str) -> String {
    let mut pattern = String::with_capacity(query.len() + 2);
    pattern.push('%');
    for character in query.chars() {
        if matches!(character, '\\' | '%' | '_') {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    pattern.push('%');
    pattern
}

fn string_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(AppError::InvalidInput(error)),
    )
}
