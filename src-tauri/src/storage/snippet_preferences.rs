//! 片段收藏与使用统计 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{error::AppResult, storage::CommandSqliteStore};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SnippetPreferenceOrigin {
    User,
    Builtin,
}

impl SnippetPreferenceOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Builtin => "builtin",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnippetUsageAction {
    Insert,
    Run,
    CopyRendered,
}

impl SnippetUsageAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Run => "run",
            Self::CopyRendered => "copyRendered",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetPreference {
    pub origin: SnippetPreferenceOrigin,
    pub snippet_id: String,
    pub favorite: bool,
    pub use_count: u64,
    pub last_action: Option<SnippetUsageAction>,
    pub last_used_at_unix_ms: Option<i64>,
}

impl CommandSqliteStore {
    pub fn list_snippet_preferences(&self) -> AppResult<Vec<SnippetPreference>> {
        self.with_connection(|conn| {
            let mut statement = conn.prepare(
                "SELECT origin, snippet_id, favorite, use_count, last_action, last_used_at_unix_ms
                 FROM snippet_preferences ORDER BY favorite DESC, last_used_at_unix_ms DESC",
            )?;
            let rows = statement.query_map([], |row| {
                let origin: String = row.get(0)?;
                Ok(SnippetPreference {
                    origin: if origin == "builtin" {
                        SnippetPreferenceOrigin::Builtin
                    } else {
                        SnippetPreferenceOrigin::User
                    },
                    snippet_id: row.get(1)?,
                    favorite: row.get(2)?,
                    use_count: row.get::<_, i64>(3)?.max(0) as u64,
                    last_action: row.get::<_, Option<String>>(4)?.and_then(parse_action),
                    last_used_at_unix_ms: row.get(5)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
        })
    }

    /// 收藏状态独立于使用统计，更新时不触碰 count 和 recent。
    pub fn set_snippet_favorite(
        &self,
        origin: SnippetPreferenceOrigin,
        snippet_id: &str,
        favorite: bool,
    ) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "INSERT INTO snippet_preferences (origin, snippet_id, favorite) VALUES (?1, ?2, ?3)
                 ON CONFLICT(origin, snippet_id) DO UPDATE SET favorite=excluded.favorite, updated_at=datetime('now')",
                params![origin.as_str(), snippet_id, favorite],
            )?;
            Ok(())
        })
    }

    /// receipt 首次出现时才累计一次；重复反馈或重试不会双计数。
    pub fn record_snippet_usage(
        &self,
        receipt_id: &str,
        origin: SnippetPreferenceOrigin,
        snippet_id: &str,
        action: SnippetUsageAction,
        occurred_at_unix_ms: i64,
    ) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO snippet_usage_receipts
                 (receipt_id, origin, snippet_id, action, created_at_unix_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![receipt_id, origin.as_str(), snippet_id, action.as_str(), occurred_at_unix_ms],
            )?;
            if inserted == 0 {
                tx.commit()?;
                return Ok(false);
            }
            tx.execute(
                "INSERT INTO snippet_preferences
                 (origin, snippet_id, use_count, last_action, last_used_at_unix_ms)
                 VALUES (?1, ?2, 1, ?3, ?4)
                 ON CONFLICT(origin, snippet_id) DO UPDATE SET
                   use_count=snippet_preferences.use_count + 1,
                   last_action=excluded.last_action,
                   last_used_at_unix_ms=excluded.last_used_at_unix_ms,
                   updated_at=datetime('now')",
                params![origin.as_str(), snippet_id, action.as_str(), occurred_at_unix_ms],
            )?;
            tx.commit()?;
            Ok(true)
        })
    }

    pub fn snippet_preference(
        &self,
        origin: SnippetPreferenceOrigin,
        snippet_id: &str,
    ) -> AppResult<Option<SnippetPreference>> {
        self.with_connection(|conn| {
            conn.query_row(
                "SELECT favorite, use_count, last_action, last_used_at_unix_ms
                 FROM snippet_preferences WHERE origin=?1 AND snippet_id=?2",
                params![origin.as_str(), snippet_id],
                |row| {
                    Ok(SnippetPreference {
                        origin,
                        snippet_id: snippet_id.to_owned(),
                        favorite: row.get(0)?,
                        use_count: row.get::<_, i64>(1)?.max(0) as u64,
                        last_action: row.get::<_, Option<String>>(2)?.and_then(parse_action),
                        last_used_at_unix_ms: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
        })
    }

    /// 清除最近和次数但保留收藏；无收藏的空记录可直接删除。
    pub fn clear_snippet_usage(&self) -> AppResult<usize> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM snippet_usage_receipts", [])?;
            let changed = tx.execute(
                "UPDATE snippet_preferences SET use_count=0, last_action=NULL, last_used_at_unix_ms=NULL, updated_at=datetime('now')",
                [],
            )?;
            tx.execute(
                "DELETE FROM snippet_preferences WHERE favorite=0 AND use_count=0 AND last_used_at_unix_ms IS NULL",
                [],
            )?;
            tx.commit()?;
            Ok(changed)
        })
    }
}

fn parse_action(value: String) -> Option<SnippetUsageAction> {
    match value.as_str() {
        "insert" => Some(SnippetUsageAction::Insert),
        "run" => Some(SnippetUsageAction::Run),
        "copyRendered" => Some(SnippetUsageAction::CopyRendered),
        _ => None,
    }
}
