//! 命令建议反馈 SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::params;

use crate::{
    error::AppResult,
    models::{
        command_history::CommandHistoryTarget,
        command_suggestion::{CommandSuggestionFeedbackAction, SuggestionProviderKind},
    },
    storage::SqliteStore,
};

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

impl SqliteStore {
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

    /// 读取某候选在相同目标上下文下的反馈聚合。
    pub(crate) fn command_suggestion_feedback_score(
        &self,
        provider: SuggestionProviderKind,
        target: CommandHistoryTarget,
        replacement_text: &str,
        remote_host_id: Option<&str>,
    ) -> AppResult<CommandSuggestionFeedbackScore> {
        self.with_connection(|conn| {
            let (accepted_count, dismissed_count): (i64, i64) = conn.query_row(
                "
                SELECT
                    COALESCE(SUM(CASE WHEN action = 'accepted' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN action = 'dismissed' THEN 1 ELSE 0 END), 0)
                FROM command_suggestion_feedback
                WHERE provider = ?1
                  AND target = ?2
                  AND replacement_text = ?3
                  AND (
                    (?4 IS NULL AND remote_host_id IS NULL)
                    OR (?4 IS NOT NULL AND (remote_host_id IS NULL OR remote_host_id = ?4))
                  )
                ",
                params![
                    provider.as_str(),
                    target.as_str(),
                    replacement_text,
                    remote_host_id,
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;

            Ok(CommandSuggestionFeedbackScore {
                accepted_count: accepted_count.max(0) as u32,
                dismissed_count: dismissed_count.max(0) as u32,
            })
        })
    }
}
