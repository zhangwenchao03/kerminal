//! 脚本片段业务服务。
//!
//! @author kongweiguang

use std::collections::HashSet;

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::snippet::{
        CommandSnippet, SnippetCreateRequest, SnippetListRequest, SnippetUpdateRequest,
    },
    storage::{snippets::CommandSnippetWrite, SqliteStore},
};

const MAX_TITLE_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 500;
const MAX_COMMAND_CHARS: usize = 8_000;
const MAX_TAG_CHARS: usize = 32;
const MAX_TAGS: usize = 12;

/// 脚本片段业务入口。
#[derive(Debug, Default)]
pub struct SnippetService;

impl SnippetService {
    /// 创建脚本片段服务。
    pub fn new() -> Self {
        Self
    }

    /// 搜索和列出脚本片段。
    pub fn list_snippets(
        &self,
        storage: &SqliteStore,
        request: SnippetListRequest,
    ) -> AppResult<Vec<CommandSnippet>> {
        let query = request
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_lowercase());
        let tag = request
            .tag
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_lowercase());

        let snippets = storage.list_command_snippets()?;
        Ok(snippets
            .into_iter()
            .filter(|snippet| request.scope.is_none_or(|scope| snippet.scope == scope))
            .filter(|snippet| {
                tag.as_ref().is_none_or(|tag| {
                    snippet
                        .tags
                        .iter()
                        .any(|snippet_tag| snippet_tag.to_lowercase() == *tag)
                })
            })
            .filter(|snippet| {
                query
                    .as_ref()
                    .is_none_or(|query| snippet_matches_query(snippet, query))
            })
            .collect())
    }

    /// 创建脚本片段。
    pub fn create_snippet(
        &self,
        storage: &SqliteStore,
        request: SnippetCreateRequest,
    ) -> AppResult<CommandSnippet> {
        let snippet = CommandSnippetWrite {
            id: Uuid::new_v4().to_string(),
            title: normalize_required_text("片段标题", request.title, MAX_TITLE_CHARS)?,
            description: normalize_optional_text(
                "片段说明",
                request.description,
                MAX_DESCRIPTION_CHARS,
            )?,
            command: normalize_required_text("片段命令", request.command, MAX_COMMAND_CHARS)?,
            tags: normalize_tags(request.tags)?,
            scope: request.scope,
            sort_order: storage.next_snippet_sort_order()?,
        };

        storage.insert_command_snippet(&snippet)
    }

    /// 更新脚本片段。
    pub fn update_snippet(
        &self,
        storage: &SqliteStore,
        request: SnippetUpdateRequest,
    ) -> AppResult<CommandSnippet> {
        let snippet = CommandSnippetWrite {
            id: normalize_required_text("片段 ID", request.id, 120)?,
            title: normalize_required_text("片段标题", request.title, MAX_TITLE_CHARS)?,
            description: normalize_optional_text(
                "片段说明",
                request.description,
                MAX_DESCRIPTION_CHARS,
            )?,
            command: normalize_required_text("片段命令", request.command, MAX_COMMAND_CHARS)?,
            tags: normalize_tags(request.tags)?,
            scope: request.scope,
            sort_order: request.sort_order,
        };

        storage.update_command_snippet(&snippet)
    }

    /// 删除脚本片段。
    pub fn delete_snippet(&self, storage: &SqliteStore, snippet_id: &str) -> AppResult<bool> {
        let snippet_id = normalize_required_text("片段 ID", snippet_id.to_owned(), 120)?;
        storage.delete_command_snippet(&snippet_id)
    }
}

fn snippet_matches_query(snippet: &CommandSnippet, query: &str) -> bool {
    snippet.title.to_lowercase().contains(query)
        || snippet.command.to_lowercase().contains(query)
        || snippet
            .description
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .contains(query)
        || snippet
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(query))
}

fn normalize_required_text(field: &str, value: String, max_chars: usize) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(value)
}

fn normalize_optional_text(
    field: &str,
    value: Option<String>,
    max_chars: usize,
) -> AppResult<Option<String>> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Ok(None);
    }
    ensure_max_chars(field, &value, max_chars)?;
    Ok(Some(value))
}

fn normalize_tags(tags: Vec<String>) -> AppResult<Vec<String>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for tag in tags {
        let tag = tag.trim().to_owned();
        if tag.is_empty() {
            continue;
        }
        ensure_max_chars("片段标签", &tag, MAX_TAG_CHARS)?;
        if seen.insert(tag.to_lowercase()) {
            normalized.push(tag);
        }
        if normalized.len() > MAX_TAGS {
            return Err(AppError::InvalidInput(format!(
                "片段标签最多 {MAX_TAGS} 个"
            )));
        }
    }

    Ok(normalized)
}

fn ensure_max_chars(field: &str, value: &str, max_chars: usize) -> AppResult<()> {
    if value.chars().count() > max_chars {
        return Err(AppError::InvalidInput(format!(
            "{field}不能超过 {max_chars} 个字符"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_tags_trims_and_deduplicates_case_insensitively() {
        let tags = normalize_tags(vec![
            " git ".to_owned(),
            "GIT".to_owned(),
            "".to_owned(),
            "deploy".to_owned(),
        ])
        .expect("normalize tags");

        assert_eq!(tags, vec!["git", "deploy"]);
    }

    #[test]
    fn normalize_required_text_rejects_empty_command() {
        let error =
            normalize_required_text("片段命令", "  ".to_owned(), 10).expect_err("reject empty");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
