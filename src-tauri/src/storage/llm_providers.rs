//! LLM Provider SQLite 访问层。
//!
//! @author kongweiguang

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::{
    error::{AppError, AppResult},
    models::llm_provider::{LlmContextStrategy, LlmProvider, LlmProviderKind, LlmReasoningEffort},
    storage::SqliteStore,
};

/// 写入 llm_providers 表的结构化数据。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LlmProviderWrite {
    /// 稳定 provider id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// Provider 类型。
    pub kind: LlmProviderKind,
    /// Provider API base URL。
    pub base_url: String,
    /// 默认模型名称。
    pub model: String,
    /// 可选模型列表 JSON 数据。
    pub model_list: Vec<String>,
    /// 默认 temperature。
    pub temperature: f64,
    /// AI 上下文读取策略。
    pub context_strategy: LlmContextStrategy,
    /// 上下文窗口 tokens。
    pub context_window_tokens: u32,
    /// 推理强度。
    pub reasoning_effort: LlmReasoningEffort,
    /// 最大重试次数。
    pub max_retries: u8,
    /// 自定义 User-Agent。
    pub user_agent: Option<String>,
    /// HTTP 代理地址。
    pub http_proxy: Option<String>,
    /// 是否启用。
    pub enabled: bool,
    /// 是否默认 provider。
    pub is_default: bool,
    /// API key 凭据引用。
    pub api_key_credential_ref: Option<String>,
}

impl SqliteStore {
    /// 返回全部 LLM Provider。
    pub fn list_llm_providers(&self) -> AppResult<Vec<LlmProvider>> {
        self.with_connection(list_providers)
    }

    /// 根据 id 读取 LLM Provider。
    pub fn llm_provider_by_id(&self, provider_id: &str) -> AppResult<Option<LlmProvider>> {
        self.with_connection(|conn| query_provider_by_id_optional(conn, provider_id))
    }

    /// 插入 LLM Provider。
    pub(crate) fn insert_llm_provider(
        &self,
        provider: &LlmProviderWrite,
    ) -> AppResult<LlmProvider> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            if provider.is_default {
                clear_default_provider(&tx)?;
            }

            tx.execute(
                "
                INSERT INTO llm_providers (
                    id, name, kind, base_url, model, temperature,
                    context_strategy, enabled, is_default, api_key_credential_ref,
                    model_list_json, context_window_tokens, reasoning_effort,
                    max_retries, user_agent, http_proxy
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                ",
                params![
                    provider.id.as_str(),
                    provider.name.as_str(),
                    provider.kind.as_db_str(),
                    provider.base_url.as_str(),
                    provider.model.as_str(),
                    provider.temperature,
                    provider.context_strategy.as_db_str(),
                    bool_to_i64(provider.enabled),
                    bool_to_i64(provider.is_default),
                    provider.api_key_credential_ref.as_deref(),
                    model_list_json(&provider.model_list)?,
                    provider.context_window_tokens,
                    provider.reasoning_effort.as_db_str(),
                    provider.max_retries,
                    provider.user_agent.as_deref(),
                    provider.http_proxy.as_deref(),
                ],
            )?;

            let provider = query_provider_by_id(&tx, &provider.id)?;
            tx.commit()?;
            Ok(provider)
        })
    }

    /// 更新 LLM Provider。
    pub(crate) fn update_llm_provider(
        &self,
        provider: &LlmProviderWrite,
    ) -> AppResult<LlmProvider> {
        self.with_connection_mut(|conn| {
            let tx = conn.transaction()?;
            if query_provider_by_id_optional(&tx, &provider.id)?.is_none() {
                return Err(AppError::NotFound(format!(
                    "LLM Provider 不存在: {}",
                    provider.id
                )));
            }
            if provider.is_default {
                clear_default_provider(&tx)?;
            }

            tx.execute(
                "
                UPDATE llm_providers
                SET name = ?2,
                    kind = ?3,
                    base_url = ?4,
                    model = ?5,
                    temperature = ?6,
                    context_strategy = ?7,
                    enabled = ?8,
                    is_default = ?9,
                    api_key_credential_ref = ?10,
                    model_list_json = ?11,
                    context_window_tokens = ?12,
                    reasoning_effort = ?13,
                    max_retries = ?14,
                    user_agent = ?15,
                    http_proxy = ?16,
                    updated_at = datetime('now')
                WHERE id = ?1
                ",
                params![
                    provider.id.as_str(),
                    provider.name.as_str(),
                    provider.kind.as_db_str(),
                    provider.base_url.as_str(),
                    provider.model.as_str(),
                    provider.temperature,
                    provider.context_strategy.as_db_str(),
                    bool_to_i64(provider.enabled),
                    bool_to_i64(provider.is_default),
                    provider.api_key_credential_ref.as_deref(),
                    model_list_json(&provider.model_list)?,
                    provider.context_window_tokens,
                    provider.reasoning_effort.as_db_str(),
                    provider.max_retries,
                    provider.user_agent.as_deref(),
                    provider.http_proxy.as_deref(),
                ],
            )?;

            let provider = query_provider_by_id(&tx, &provider.id)?;
            tx.commit()?;
            Ok(provider)
        })
    }

    /// 删除 LLM Provider。
    pub fn delete_llm_provider(&self, provider_id: &str) -> AppResult<bool> {
        self.with_connection_mut(|conn| {
            let affected =
                conn.execute("DELETE FROM llm_providers WHERE id = ?1", [provider_id])?;
            Ok(affected > 0)
        })
    }
}

fn list_providers(conn: &Connection) -> AppResult<Vec<LlmProvider>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, kind, base_url, model, temperature, context_strategy,
               enabled, is_default, api_key_credential_ref, created_at, updated_at,
               model_list_json, context_window_tokens, reasoning_effort,
               max_retries, user_agent, http_proxy
        FROM llm_providers
        ORDER BY is_default DESC, enabled DESC, name ASC
        ",
    )?;

    let providers = stmt
        .query_map([], provider_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(providers)
}

fn query_provider_by_id(conn: &Connection, provider_id: &str) -> AppResult<LlmProvider> {
    query_provider_by_id_optional(conn, provider_id)?
        .ok_or_else(|| AppError::NotFound(format!("LLM Provider 不存在: {provider_id}")))
}

fn query_provider_by_id_optional(
    conn: &Connection,
    provider_id: &str,
) -> AppResult<Option<LlmProvider>> {
    Ok(conn
        .query_row(
            "
            SELECT id, name, kind, base_url, model, temperature, context_strategy,
                   enabled, is_default, api_key_credential_ref, created_at, updated_at,
                   model_list_json, context_window_tokens, reasoning_effort,
                   max_retries, user_agent, http_proxy
            FROM llm_providers
            WHERE id = ?1
            ",
            [provider_id],
            provider_from_row,
        )
        .optional()?)
}

fn clear_default_provider(conn: &Connection) -> AppResult<()> {
    conn.execute("UPDATE llm_providers SET is_default = 0", [])?;
    Ok(())
}

fn provider_from_row(row: &Row<'_>) -> rusqlite::Result<LlmProvider> {
    let kind_text: String = row.get(2)?;
    let context_strategy_text: String = row.get(6)?;
    let enabled: i64 = row.get(7)?;
    let is_default: i64 = row.get(8)?;
    let api_key_credential_ref: Option<String> = row.get(9)?;
    let model: String = row.get(4)?;
    let model_list_json: String = row.get(12)?;
    let reasoning_effort_text: String = row.get(14)?;
    let kind = LlmProviderKind::try_from(kind_text.as_str()).map_err(text_to_sqlite_error)?;
    let context_strategy = LlmContextStrategy::try_from(context_strategy_text.as_str())
        .map_err(text_to_sqlite_error)?;
    let reasoning_effort = LlmReasoningEffort::try_from(reasoning_effort_text.as_str())
        .map_err(text_to_sqlite_error)?;

    Ok(LlmProvider {
        id: row.get(0)?,
        name: row.get(1)?,
        kind,
        base_url: row.get(3)?,
        model: model.clone(),
        model_list: parse_model_list(&model_list_json, &model),
        temperature: row.get(5)?,
        context_strategy,
        context_window_tokens: row.get(13)?,
        reasoning_effort,
        max_retries: row.get(15)?,
        user_agent: row.get(16)?,
        http_proxy: row.get(17)?,
        enabled: enabled == 1,
        is_default: is_default == 1,
        api_key_configured: api_key_credential_ref.is_some(),
        api_key_credential_ref,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn model_list_json(model_list: &[String]) -> AppResult<String> {
    Ok(serde_json::to_string(model_list)?)
}

fn parse_model_list(model_list_json: &str, model: &str) -> Vec<String> {
    let mut values = serde_json::from_str::<Vec<String>>(model_list_json).unwrap_or_default();
    values.push(model.to_string());
    values = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    values.sort();
    values.dedup();
    values
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn text_to_sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
    )
}
