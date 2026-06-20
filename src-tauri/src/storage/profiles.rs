//! 终端 Profile SQLite 访问层。
//!
//! @author kongweiguang

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::profile::TerminalProfile,
    storage::SqliteStore,
};

/// 写入 terminal_profiles 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalProfileWrite {
    /// 稳定 profile id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// shell 或可执行文件。
    pub shell: String,
    /// 默认启动参数。
    pub args: Vec<String>,
    /// 默认工作目录。
    pub cwd: Option<String>,
    /// 环境变量覆盖。
    pub env: HashMap<String, String>,
    /// 是否默认 profile。
    pub is_default: bool,
    /// 排序字段。
    pub sort_order: i64,
}

impl SqliteStore {
    /// 返回所有终端 Profile。
    pub fn list_terminal_profiles(&self) -> AppResult<Vec<TerminalProfile>> {
        self.with_connection(list_profiles)
    }

    /// 返回终端 Profile 数量。
    pub fn terminal_profile_count(&self) -> AppResult<usize> {
        self.with_connection(|conn| {
            let count: i64 =
                conn.query_row("SELECT COUNT(*) FROM terminal_profiles", [], |row| {
                    row.get(0)
                })?;
            Ok(count as usize)
        })
    }

    /// 根据 id 读取终端 Profile。
    pub fn terminal_profile_by_id(&self, profile_id: &str) -> AppResult<Option<TerminalProfile>> {
        self.with_connection(|conn| query_profile_by_id_optional(conn, profile_id))
    }

    /// 返回下一个排序值。
    pub fn next_profile_sort_order(&self) -> AppResult<i64> {
        self.with_connection(|conn| {
            let sort_order: Option<i64> = conn
                .query_row("SELECT MAX(sort_order) FROM terminal_profiles", [], |row| {
                    row.get(0)
                })
                .optional()?
                .flatten();

            Ok(sort_order.unwrap_or(0) + 10)
        })
    }

    /// 插入终端 Profile。
    pub(crate) fn insert_terminal_profile(
        &self,
        profile: &TerminalProfileWrite,
    ) -> AppResult<TerminalProfile> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            if profile.is_default {
                tx.execute("UPDATE terminal_profiles SET is_default = 0", [])?;
            }

            let args_json = serde_json::to_string(&profile.args)?;
            let env_json = serde_json::to_string(&profile.env)?;

            tx.execute(
                "
                INSERT INTO terminal_profiles (
                    id, name, shell, args_json, cwd, env_json, is_default, sort_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    profile.id.as_str(),
                    profile.name.as_str(),
                    profile.shell.as_str(),
                    args_json,
                    profile.cwd.as_deref(),
                    env_json,
                    bool_to_i64(profile.is_default),
                    profile.sort_order,
                ],
            )?;

            let stored = query_profile_by_id(&tx, &profile.id)?;
            tx.commit()?;
            Ok(stored)
        })
    }

    /// 更新终端 Profile。
    pub(crate) fn update_terminal_profile(
        &self,
        profile: &TerminalProfileWrite,
    ) -> AppResult<TerminalProfile> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            if query_profile_by_id_optional(&tx, &profile.id)?.is_none() {
                return Err(AppError::NotFound(format!(
                    "终端 Profile 不存在: {}",
                    profile.id
                )));
            }

            if profile.is_default {
                tx.execute("UPDATE terminal_profiles SET is_default = 0", [])?;
            }

            let args_json = serde_json::to_string(&profile.args)?;
            let env_json = serde_json::to_string(&profile.env)?;

            tx.execute(
                "
                UPDATE terminal_profiles
                SET name = ?2,
                    shell = ?3,
                    args_json = ?4,
                    cwd = ?5,
                    env_json = ?6,
                    is_default = ?7,
                    sort_order = ?8,
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![
                    profile.id.as_str(),
                    profile.name.as_str(),
                    profile.shell.as_str(),
                    args_json,
                    profile.cwd.as_deref(),
                    env_json,
                    bool_to_i64(profile.is_default),
                    profile.sort_order,
                ],
            )?;

            let stored = query_profile_by_id(&tx, &profile.id)?;
            tx.commit()?;
            Ok(stored)
        })
    }

    /// 删除终端 Profile。
    pub fn delete_terminal_profile(&self, profile_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            let was_default: Option<i64> = tx
                .query_row(
                    "SELECT is_default FROM terminal_profiles WHERE id = ?1",
                    [profile_id],
                    |row| row.get(0),
                )
                .optional()?;

            let Some(was_default) = was_default else {
                return Ok(false);
            };

            tx.execute("DELETE FROM terminal_profiles WHERE id = ?1", [profile_id])?;

            if was_default == 1 {
                let next_default_id: Option<String> = tx
                    .query_row(
                        "
                        SELECT id
                        FROM terminal_profiles
                        ORDER BY sort_order ASC, name ASC
                        LIMIT 1
                        ",
                        [],
                        |row| row.get(0),
                    )
                    .optional()?;

                if let Some(next_default_id) = next_default_id {
                    tx.execute(
                        "UPDATE terminal_profiles SET is_default = 1 WHERE id = ?1",
                        [next_default_id],
                    )?;
                }
            }

            tx.commit()?;
            Ok(true)
        })
    }
}

fn list_profiles(conn: &Connection) -> AppResult<Vec<TerminalProfile>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, shell, args_json, cwd, env_json, is_default, sort_order, created_at, updated_at
        FROM terminal_profiles
        ORDER BY sort_order ASC, name ASC
        ",
    )?;

    let profiles = stmt
        .query_map([], profile_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(profiles)
}

fn query_profile_by_id(conn: &Connection, profile_id: &str) -> AppResult<TerminalProfile> {
    query_profile_by_id_optional(conn, profile_id)?
        .ok_or_else(|| AppError::NotFound(format!("终端 Profile 不存在: {profile_id}")))
}

fn query_profile_by_id_optional(
    conn: &Connection,
    profile_id: &str,
) -> AppResult<Option<TerminalProfile>> {
    Ok(conn
        .query_row(
            "
            SELECT id, name, shell, args_json, cwd, env_json, is_default, sort_order, created_at, updated_at
            FROM terminal_profiles
            WHERE id = ?1
            ",
            [profile_id],
            profile_from_row,
        )
        .optional()?)
}

fn profile_from_row(row: &Row<'_>) -> rusqlite::Result<TerminalProfile> {
    let args_json: String = row.get(3)?;
    let env_json: String = row.get(5)?;

    let args = serde_json::from_str(&args_json).map_err(json_to_sqlite_error)?;
    let env = serde_json::from_str(&env_json).map_err(json_to_sqlite_error)?;
    let is_default: i64 = row.get(6)?;

    Ok(TerminalProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        shell: row.get(2)?,
        args,
        cwd: row.get(4)?,
        env,
        is_default: is_default == 1,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn json_to_sqlite_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
