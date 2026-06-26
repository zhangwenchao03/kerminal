//! 命令建议 telemetry SQLite 聚合访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Row};

use crate::{
    error::AppResult, models::command_suggestion::SuggestionProviderKind,
    storage::CommandSqliteStore,
};

/// 命令建议 telemetry 的增量写入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSuggestionTelemetryUpdate {
    /// provider 类型。
    pub provider: SuggestionProviderKind,
    /// provider 查询增量。
    pub query_count_delta: u64,
    /// provider 候选数增量。
    pub candidate_count_delta: u64,
    /// provider 查询耗时增量，毫秒。
    pub total_elapsed_ms_delta: u64,
    /// 缓存命中增量。
    pub cache_hit_count_delta: u64,
    /// 缓存未命中增量。
    pub cache_miss_count_delta: u64,
    /// 后台刷新成功增量。
    pub refresh_success_count_delta: u64,
    /// 后台刷新失败增量。
    pub refresh_failure_count_delta: u64,
    /// 接受反馈增量。
    pub feedback_accepted_count_delta: u64,
    /// 忽略反馈增量。
    pub feedback_dismissed_count_delta: u64,
    /// 跳过反馈增量。
    pub feedback_skipped_count_delta: u64,
    /// 事件时间，Unix 毫秒。
    pub event_unix_ms: i64,
    /// 最近错误；为空时默认保留已有错误。
    pub last_error: Option<String>,
    /// 是否清空最近错误。
    pub clear_last_error: bool,
}

impl CommandSuggestionTelemetryUpdate {
    /// 创建一个针对指定 provider 的空增量。
    pub(crate) fn new(provider: SuggestionProviderKind) -> Self {
        Self {
            provider,
            query_count_delta: 0,
            candidate_count_delta: 0,
            total_elapsed_ms_delta: 0,
            cache_hit_count_delta: 0,
            cache_miss_count_delta: 0,
            refresh_success_count_delta: 0,
            refresh_failure_count_delta: 0,
            feedback_accepted_count_delta: 0,
            feedback_dismissed_count_delta: 0,
            feedback_skipped_count_delta: 0,
            event_unix_ms: 0,
            last_error: None,
            clear_last_error: false,
        }
    }
}

/// 命令建议 telemetry 聚合行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSuggestionTelemetryRow {
    /// provider 类型。
    pub provider: SuggestionProviderKind,
    /// provider 被查询的次数。
    pub query_count: u64,
    /// provider 查询产生的候选总数。
    pub candidate_count: u64,
    /// provider 查询累计耗时，毫秒。
    pub total_elapsed_ms: u64,
    /// 远端 provider 缓存命中次数。
    pub cache_hit_count: u64,
    /// 远端 provider 缓存未命中次数。
    pub cache_miss_count: u64,
    /// 后台刷新成功次数。
    pub refresh_success_count: u64,
    /// 后台刷新失败次数。
    pub refresh_failure_count: u64,
    /// 已接受反馈次数。
    pub feedback_accepted_count: u64,
    /// 已忽略反馈次数。
    pub feedback_dismissed_count: u64,
    /// 因安全或输入原因跳过的反馈次数。
    pub feedback_skipped_count: u64,
    /// 首次事件时间，Unix 毫秒。
    pub first_event_unix_ms: i64,
    /// 最近一次事件时间，Unix 毫秒。
    pub last_event_unix_ms: i64,
    /// 最近一次错误文本。
    pub last_error: Option<String>,
}

impl CommandSqliteStore {
    /// 按 provider 聚合写入命令建议 telemetry 增量。
    pub(crate) fn add_command_suggestion_telemetry(
        &self,
        update: &CommandSuggestionTelemetryUpdate,
    ) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO command_suggestion_telemetry (
                    provider, query_count, candidate_count, total_elapsed_ms,
                    cache_hit_count, cache_miss_count, refresh_success_count,
                    refresh_failure_count, feedback_accepted_count,
                    feedback_dismissed_count, feedback_skipped_count,
                    first_event_unix_ms, last_event_unix_ms, last_error, updated_at
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, datetime('now')
                )
                ON CONFLICT(provider) DO UPDATE SET
                    query_count = command_suggestion_telemetry.query_count + excluded.query_count,
                    candidate_count = command_suggestion_telemetry.candidate_count + excluded.candidate_count,
                    total_elapsed_ms = command_suggestion_telemetry.total_elapsed_ms + excluded.total_elapsed_ms,
                    cache_hit_count = command_suggestion_telemetry.cache_hit_count + excluded.cache_hit_count,
                    cache_miss_count = command_suggestion_telemetry.cache_miss_count + excluded.cache_miss_count,
                    refresh_success_count = command_suggestion_telemetry.refresh_success_count + excluded.refresh_success_count,
                    refresh_failure_count = command_suggestion_telemetry.refresh_failure_count + excluded.refresh_failure_count,
                    feedback_accepted_count = command_suggestion_telemetry.feedback_accepted_count + excluded.feedback_accepted_count,
                    feedback_dismissed_count = command_suggestion_telemetry.feedback_dismissed_count + excluded.feedback_dismissed_count,
                    feedback_skipped_count = command_suggestion_telemetry.feedback_skipped_count + excluded.feedback_skipped_count,
                    first_event_unix_ms = MIN(command_suggestion_telemetry.first_event_unix_ms, excluded.first_event_unix_ms),
                    last_event_unix_ms = MAX(command_suggestion_telemetry.last_event_unix_ms, excluded.last_event_unix_ms),
                    last_error = CASE
                        WHEN ?15 = 1 THEN NULL
                        WHEN excluded.last_error IS NOT NULL THEN excluded.last_error
                        ELSE command_suggestion_telemetry.last_error
                    END,
                    updated_at = datetime('now')
                ",
                params![
                    update.provider.as_str(),
                    u64_to_i64(update.query_count_delta),
                    u64_to_i64(update.candidate_count_delta),
                    u64_to_i64(update.total_elapsed_ms_delta),
                    u64_to_i64(update.cache_hit_count_delta),
                    u64_to_i64(update.cache_miss_count_delta),
                    u64_to_i64(update.refresh_success_count_delta),
                    u64_to_i64(update.refresh_failure_count_delta),
                    u64_to_i64(update.feedback_accepted_count_delta),
                    u64_to_i64(update.feedback_dismissed_count_delta),
                    u64_to_i64(update.feedback_skipped_count_delta),
                    update.event_unix_ms,
                    update.event_unix_ms,
                    update.last_error.as_deref(),
                    update.clear_last_error,
                ],
            )?;

            Ok(())
        })
    }

    /// 读取持久化命令建议 telemetry 聚合。
    pub(crate) fn command_suggestion_telemetry_rows(
        &self,
    ) -> AppResult<Vec<CommandSuggestionTelemetryRow>> {
        self.with_connection(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT provider, query_count, candidate_count, total_elapsed_ms,
                       cache_hit_count, cache_miss_count, refresh_success_count,
                       refresh_failure_count, feedback_accepted_count,
                       feedback_dismissed_count, feedback_skipped_count,
                       first_event_unix_ms, last_event_unix_ms, last_error
                FROM command_suggestion_telemetry
                ORDER BY provider
                ",
            )?;
            let rows = stmt
                .query_map([], telemetry_from_row)?
                .collect::<Result<Vec<_>, _>>()?;

            Ok(rows)
        })
    }
}

fn telemetry_from_row(row: &Row<'_>) -> rusqlite::Result<CommandSuggestionTelemetryRow> {
    let provider_text: String = row.get(0)?;
    let provider = SuggestionProviderKind::try_from(provider_text.as_str()).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(crate::error::AppError::InvalidInput(error)),
        )
    })?;

    Ok(CommandSuggestionTelemetryRow {
        provider,
        query_count: non_negative_i64(row.get(1)?),
        candidate_count: non_negative_i64(row.get(2)?),
        total_elapsed_ms: non_negative_i64(row.get(3)?),
        cache_hit_count: non_negative_i64(row.get(4)?),
        cache_miss_count: non_negative_i64(row.get(5)?),
        refresh_success_count: non_negative_i64(row.get(6)?),
        refresh_failure_count: non_negative_i64(row.get(7)?),
        feedback_accepted_count: non_negative_i64(row.get(8)?),
        feedback_dismissed_count: non_negative_i64(row.get(9)?),
        feedback_skipped_count: non_negative_i64(row.get(10)?),
        first_event_unix_ms: row.get(11)?,
        last_event_unix_ms: row.get(12)?,
        last_error: row.get(13)?,
    })
}

fn non_negative_i64(value: i64) -> u64 {
    value.max(0) as u64
}

fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}
