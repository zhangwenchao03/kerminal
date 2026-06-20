//! 命令建议诊断数据清理访问层。
//!
//! @author kongweiguang

use rusqlite::params;

use crate::{error::AppResult, storage::SqliteStore};

impl SqliteStore {
    /// 删除指定时间之前的命令建议审计事件。
    pub(crate) fn delete_command_suggestion_audit_events_before(
        &self,
        cutoff_unix_ms: i64,
    ) -> AppResult<u64> {
        self.with_connection_mut(|conn| {
            let deleted = conn.execute(
                "
                DELETE FROM command_suggestion_audit_events
                WHERE created_at_unix_ms < ?1
                ",
                params![cutoff_unix_ms],
            )?;
            Ok(deleted as u64)
        })
    }

    /// 删除指定时间之前的命令建议反馈。
    pub(crate) fn delete_command_suggestion_feedback_before(
        &self,
        cutoff_unix_ms: i64,
    ) -> AppResult<u64> {
        self.with_connection_mut(|conn| {
            let deleted = conn.execute(
                "
                DELETE FROM command_suggestion_feedback
                WHERE created_at_unix_ms < ?1
                ",
                params![cutoff_unix_ms],
            )?;
            Ok(deleted as u64)
        })
    }

    /// 删除已经过期的 provider cache。
    pub(crate) fn delete_expired_command_suggestion_provider_cache(
        &self,
        now_unix_ms: i64,
    ) -> AppResult<u64> {
        self.with_connection_mut(|conn| {
            let deleted = conn.execute(
                "
                DELETE FROM command_suggestion_provider_cache
                WHERE expires_at_unix_ms <= ?1
                ",
                params![now_unix_ms],
            )?;
            Ok(deleted as u64)
        })
    }

    /// 清空持久化命令建议 telemetry 聚合。
    pub(crate) fn clear_command_suggestion_telemetry(&self) -> AppResult<u64> {
        self.with_connection_mut(|conn| {
            let deleted = conn.execute("DELETE FROM command_suggestion_telemetry", [])?;
            Ok(deleted as u64)
        })
    }
}
