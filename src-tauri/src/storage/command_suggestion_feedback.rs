//! 命令建议反馈 SQLite 访问层。
//!
//! @author kongweiguang

use std::collections::{HashMap, HashSet};

use rusqlite::{params, params_from_iter, types::Value};

use crate::{
    error::AppResult,
    models::{
        command_history::CommandHistoryTarget,
        command_suggestion::{CommandSuggestionFeedbackAction, SuggestionProviderKind},
    },
    storage::CommandSqliteStore,
};

const MAX_FEEDBACK_BATCH_KEYS: usize = 400;

/// 写入 command_suggestion_feedback 表的结构化数据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandSuggestionFeedbackWrite {
    /// 反馈 id。
    pub id: String,
    /// 反馈动作。
    pub action: CommandSuggestionFeedbackAction,
    /// provider 类型。
    pub provider: SuggestionProviderKind,
    /// 目标类型。
    pub target: CommandHistoryTarget,
    /// 接受建议会写入的完整替换文本。
    pub replacement_text: String,
    /// 触发反馈时的输入文本。
    pub input: String,
    /// 上游记录 id。
    pub source_id: Option<String>,
    /// 当前终端 session id。
    pub session_id: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 本地 profile id。
    pub profile_id: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 当前工作目录。
    pub cwd: Option<String>,
    /// shell 标识。
    pub shell: Option<String>,
    /// 创建时间，Unix 毫秒。
    pub created_at_unix_ms: i64,
}

/// 候选对应的反馈聚合分数。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CommandSuggestionFeedbackScore {
    /// 接受次数。
    pub accepted_count: u32,
    /// 忽略次数。
    pub dismissed_count: u32,
}

/// 批量反馈聚合的稳定查询键。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct CommandSuggestionFeedbackKey {
    /// provider 类型。
    pub provider: SuggestionProviderKind,
    /// 候选完整替换文本。
    pub replacement_text: String,
}

impl CommandSqliteStore {
    /// 写入一条命令建议反馈。
    pub(crate) fn insert_command_suggestion_feedback(
        &self,
        entry: &CommandSuggestionFeedbackWrite,
    ) -> AppResult<()> {
        self.with_connection_mut(|conn| {
            conn.execute(
                "
                INSERT INTO command_suggestion_feedback (
                    id, action, provider, target, replacement_text, input,
                    source_id, session_id, pane_id, profile_id, remote_host_id,
                    cwd, shell, created_at_unix_ms, created_at
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, datetime('now')
                )
                ",
                params![
                    entry.id.as_str(),
                    entry.action.as_str(),
                    entry.provider.as_str(),
                    entry.target.as_str(),
                    entry.replacement_text.as_str(),
                    entry.input.as_str(),
                    entry.source_id.as_deref(),
                    entry.session_id.as_deref(),
                    entry.pane_id.as_deref(),
                    entry.profile_id.as_deref(),
                    entry.remote_host_id.as_deref(),
                    entry.cwd.as_deref(),
                    entry.shell.as_deref(),
                    entry.created_at_unix_ms,
                ],
            )?;

            Ok(())
        })
    }

    /// 一次性读取一组候选在相同目标上下文下的反馈聚合。
    ///
    /// 查询先用有界 `VALUES` CTE 建立候选键，再通过 replacement 索引关联反馈表，
    /// 因此候选数量变化只增加参数和索引探测，不增加 SQLite round trip。
    pub(crate) fn command_suggestion_feedback_scores(
        &self,
        target: CommandHistoryTarget,
        remote_host_id: Option<&str>,
        keys: &[CommandSuggestionFeedbackKey],
    ) -> AppResult<HashMap<CommandSuggestionFeedbackKey, CommandSuggestionFeedbackScore>> {
        let mut seen = HashSet::new();
        let keys = keys
            .iter()
            .filter(|key| seen.insert((*key).clone()))
            .take(MAX_FEEDBACK_BATCH_KEYS)
            .collect::<Vec<_>>();
        if keys.is_empty() {
            return Ok(HashMap::new());
        }

        self.with_connection(|conn| {
            let values = std::iter::repeat_n("(?, ?)", keys.len())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "
                WITH requested(provider, replacement_text) AS (
                    VALUES {values}
                )
                SELECT
                    requested.provider,
                    requested.replacement_text,
                    COALESCE(SUM(CASE WHEN feedback.action = 'accepted' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN feedback.action = 'dismissed' THEN 1 ELSE 0 END), 0)
                FROM requested
                LEFT JOIN command_suggestion_feedback AS feedback
                    INDEXED BY idx_command_suggestion_feedback_replacement
                  ON feedback.provider = requested.provider
                 AND feedback.replacement_text = requested.replacement_text
                 AND feedback.target = ?
                 AND (
                    (? IS NULL AND feedback.remote_host_id IS NULL)
                    OR (
                        ? IS NOT NULL
                        AND (
                            feedback.remote_host_id IS NULL
                            OR feedback.remote_host_id = ?
                        )
                    )
                 )
                GROUP BY requested.provider, requested.replacement_text
                "
            );
            let mut parameters = Vec::with_capacity(keys.len() * 2 + 4);
            for key in &keys {
                parameters.push(Value::Text(key.provider.as_str().to_owned()));
                parameters.push(Value::Text(key.replacement_text.clone()));
            }
            parameters.push(Value::Text(target.as_str().to_owned()));
            for _ in 0..3 {
                parameters.push(
                    remote_host_id
                        .map(|value| Value::Text(value.to_owned()))
                        .unwrap_or(Value::Null),
                );
            }

            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(parameters), |row| {
                let provider: String = row.get(0)?;
                let provider = SuggestionProviderKind::try_from(provider.as_str())
                    .map_err(string_to_sqlite_error)?;
                let accepted_count: i64 = row.get(2)?;
                let dismissed_count: i64 = row.get(3)?;
                Ok((
                    CommandSuggestionFeedbackKey {
                        provider,
                        replacement_text: row.get(1)?,
                    },
                    CommandSuggestionFeedbackScore {
                        accepted_count: accepted_count.max(0) as u32,
                        dismissed_count: dismissed_count.max(0) as u32,
                    },
                ))
            })?;

            rows.collect::<Result<HashMap<_, _>, _>>()
                .map_err(Into::into)
        })
    }
}

fn string_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(crate::error::AppError::InvalidInput(error)),
    )
}
