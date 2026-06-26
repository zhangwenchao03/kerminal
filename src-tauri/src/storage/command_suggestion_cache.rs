//! 命令建议 provider cache SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, OptionalExtension, Row};

use crate::{
    error::AppResult, models::command_suggestion::SuggestionProviderKind,
    storage::CommandSqliteStore,
};

/// 写入 command_suggestion_provider_cache 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSuggestionProviderCacheWrite {
    /// provider 类型。
    pub provider: SuggestionProviderKind,
    /// SSH 主机 id。
    pub host_id: String,
    /// provider 内部 scope，例如目录、cwd 或空字符串。
    pub scope_key: String,
    /// Git 仓库根目录，非 Git provider 为空。
    pub repo_root: Option<String>,
    /// provider payload JSON。
    pub payload_json: String,
    /// 缓存写入时间，Unix 毫秒。
    pub cached_at_unix_ms: i64,
    /// 缓存过期时间，Unix 毫秒。
    pub expires_at_unix_ms: i64,
    /// 缓存 TTL 秒数。
    pub ttl_seconds: u64,
}

/// command_suggestion_provider_cache 查询结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSuggestionProviderCacheRow {
    /// provider 类型。
    pub provider: SuggestionProviderKind,
    /// SSH 主机 id。
    pub host_id: String,
    /// provider 内部 scope，例如目录、cwd 或空字符串。
    pub scope_key: String,
    /// Git 仓库根目录，非 Git provider 为空。
    pub repo_root: Option<String>,
    /// provider payload JSON。
    pub payload_json: String,
    /// 缓存写入时间，Unix 毫秒。
    pub cached_at_unix_ms: i64,
    /// 缓存过期时间，Unix 毫秒。
    pub expires_at_unix_ms: i64,
    /// 缓存 TTL 秒数。
    pub ttl_seconds: u64,
}

impl CommandSqliteStore {
    /// 写入或覆盖一条命令建议 provider cache。
    pub(crate) fn upsert_command_suggestion_provider_cache(
        &self,
        entry: &CommandSuggestionProviderCacheWrite,
    ) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO command_suggestion_provider_cache (
                    provider, host_id, scope_key, repo_root, payload_json,
                    cached_at_unix_ms, expires_at_unix_ms, ttl_seconds, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
                ON CONFLICT(provider, host_id, scope_key) DO UPDATE SET
                    repo_root = excluded.repo_root,
                    payload_json = excluded.payload_json,
                    cached_at_unix_ms = excluded.cached_at_unix_ms,
                    expires_at_unix_ms = excluded.expires_at_unix_ms,
                    ttl_seconds = excluded.ttl_seconds,
                    updated_at = excluded.updated_at
                ",
                params![
                    entry.provider.as_str(),
                    entry.host_id.as_str(),
                    entry.scope_key.as_str(),
                    entry.repo_root.as_deref(),
                    entry.payload_json.as_str(),
                    entry.cached_at_unix_ms,
                    entry.expires_at_unix_ms,
                    i64::try_from(entry.ttl_seconds).unwrap_or(i64::MAX),
                ],
            )?;

            Ok(())
        })
    }

    /// 读取未过期的命令建议 provider cache；过期记录不会返回。
    pub(crate) fn command_suggestion_provider_cache_entry(
        &self,
        provider: SuggestionProviderKind,
        host_id: &str,
        scope_key: &str,
        now_unix_ms: i64,
    ) -> AppResult<Option<CommandSuggestionProviderCacheRow>> {
        self.with_connection(|conn| {
            Ok(conn
                .query_row(
                    "
                    SELECT provider, host_id, scope_key, repo_root, payload_json,
                           cached_at_unix_ms, expires_at_unix_ms, ttl_seconds
                    FROM command_suggestion_provider_cache
                    WHERE provider = ?1
                      AND host_id = ?2
                      AND scope_key = ?3
                      AND expires_at_unix_ms > ?4
                    ",
                    params![provider.as_str(), host_id, scope_key, now_unix_ms],
                    provider_cache_from_row,
                )
                .optional()?)
        })
    }
}

fn provider_cache_from_row(row: &Row<'_>) -> rusqlite::Result<CommandSuggestionProviderCacheRow> {
    let provider_text: String = row.get(0)?;
    let provider = SuggestionProviderKind::try_from(provider_text.as_str()).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(crate::error::AppError::InvalidInput(error)),
        )
    })?;
    let ttl_seconds: i64 = row.get(7)?;

    Ok(CommandSuggestionProviderCacheRow {
        provider,
        host_id: row.get(1)?,
        scope_key: row.get(2)?,
        repo_root: row.get(3)?,
        payload_json: row.get(4)?,
        cached_at_unix_ms: row.get(5)?,
        expires_at_unix_ms: row.get(6)?,
        ttl_seconds: ttl_seconds.max(1) as u64,
    })
}
