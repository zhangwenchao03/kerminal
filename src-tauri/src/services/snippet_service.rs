//! 脚本片段业务服务。
//!
//! @author kongweiguang

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::snippet::{
        validate_snippet_metadata_contract, CommandSnippet, SnippetCreateRequest,
        SnippetImportCandidate, SnippetListRequest, SnippetUpdateRequest,
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

const MAX_TITLE_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 500;
const MAX_COMMAND_CHARS: usize = 8_000;
const MAX_TAG_CHARS: usize = 32;
const MAX_TAGS: usize = 12;
const MAX_IMPORT_ITEMS: usize = 500;
const CATALOG_CACHE_TTL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone)]
struct CachedSnippetDocuments {
    loaded_at: Instant,
    documents: crate::storage::config_file_store::SnippetDocumentList,
}

/// 脚本片段业务入口。
#[derive(Debug, Clone)]
pub struct SnippetService {
    config: ConfigFileStore,
    catalog_cache: Arc<Mutex<Option<CachedSnippetDocuments>>>,
}

impl SnippetService {
    /// 创建脚本片段服务。
    pub fn new(config: ConfigFileStore) -> Self {
        Self {
            config,
            catalog_cache: Arc::new(Mutex::new(None)),
        }
    }

    /// 搜索和列出脚本片段。
    pub fn list_snippets(&self, request: SnippetListRequest) -> AppResult<Vec<CommandSnippet>> {
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

        let snippets = self.config.list_snippets().map_err(config_file_error)?;
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

    /// 读取有效用户片段并保留坏文件 warning，供 V2 catalog 做部分成功展示。
    pub fn list_snippet_documents(
        &self,
    ) -> AppResult<crate::storage::config_file_store::SnippetDocumentList> {
        if let Ok(cache) = self.catalog_cache.lock() {
            if let Some(cached) = cache
                .as_ref()
                .filter(|cached| cached.loaded_at.elapsed() <= CATALOG_CACHE_TTL)
            {
                return Ok(cached.documents.clone());
            }
        }
        let documents = self
            .config
            .list_snippet_documents()
            .map_err(config_file_error)?;
        // 缓存只是性能增强；锁中毒时继续返回真实文件结果，不拖垮目录和终端建议。
        if let Ok(mut cache) = self.catalog_cache.lock() {
            *cache = Some(CachedSnippetDocuments {
                loaded_at: Instant::now(),
                documents: documents.clone(),
            });
        }
        Ok(documents)
    }

    /// 创建脚本片段。
    pub fn create_snippet(&self, request: SnippetCreateRequest) -> AppResult<CommandSnippet> {
        let timestamp = timestamp_now();
        let snippet = CommandSnippet {
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
            sort_order: self
                .config
                .next_snippet_sort_order()
                .map_err(config_file_error)?,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            category: None,
            risk: None,
            default_action: None,
            variables: Vec::new(),
            context_bindings: Vec::new(),
            derived_from: None,
        };

        self.config
            .apply_snippet_change_set(std::slice::from_ref(&snippet), &[])
            .map_err(config_file_error)?;
        self.invalidate_catalog_cache();
        Ok(snippet)
    }

    /// 在单个可恢复 change set 中导入整批片段；任一项无效时不会写入部分结果。
    pub fn import_snippets(
        &self,
        candidates: Vec<SnippetImportCandidate>,
    ) -> AppResult<Vec<CommandSnippet>> {
        if candidates.is_empty() || candidates.len() > MAX_IMPORT_ITEMS {
            return Err(AppError::InvalidInput(format!(
                "单次导入数量必须为 1 至 {MAX_IMPORT_ITEMS}"
            )));
        }
        let base_order = self
            .list_snippet_documents()?
            .snippets
            .into_iter()
            .map(|snippet| snippet.sort_order)
            .max()
            .unwrap_or(0);
        let timestamp = timestamp_now();
        let mut snippets = Vec::with_capacity(candidates.len());
        for (index, candidate) in candidates.into_iter().enumerate() {
            validate_snippet_metadata_contract(
                candidate.risk.as_deref(),
                candidate.default_action.as_deref(),
                &candidate.variables,
                &candidate.context_bindings,
            )
            .map_err(AppError::InvalidInput)?;
            snippets.push(CommandSnippet {
                id: Uuid::new_v4().to_string(),
                title: normalize_required_text("片段标题", candidate.title, MAX_TITLE_CHARS)?,
                description: normalize_optional_text(
                    "片段说明",
                    candidate.description,
                    MAX_DESCRIPTION_CHARS,
                )?,
                command: normalize_required_text("片段命令", candidate.command, MAX_COMMAND_CHARS)?,
                tags: normalize_tags(candidate.tags)?,
                scope: candidate.scope,
                sort_order: base_order + ((index as i64 + 1) * 10),
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                category: normalize_optional_text("片段分类", candidate.category, MAX_TITLE_CHARS)?,
                risk: candidate.risk,
                default_action: candidate.default_action,
                variables: candidate.variables,
                context_bindings: candidate.context_bindings,
                derived_from: normalize_optional_text("片段来源", candidate.derived_from, 120)?,
            });
        }
        self.config
            .apply_snippet_change_set(&snippets, &[])
            .map_err(config_file_error)?;
        self.invalidate_catalog_cache();
        Ok(snippets)
    }

    /// 更新脚本片段。
    pub fn update_snippet(&self, request: SnippetUpdateRequest) -> AppResult<CommandSnippet> {
        let id = normalize_required_text("片段 ID", request.id, 120)?;
        let existing = self
            .config
            .snippet_by_id(&id)
            .map_err(config_file_error)?
            .ok_or_else(|| AppError::NotFound(format!("脚本片段不存在: {id}")))?;
        let snippet = CommandSnippet {
            id,
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
            created_at: existing.created_at,
            updated_at: timestamp_now(),
            category: existing.category,
            risk: existing.risk,
            default_action: existing.default_action,
            variables: existing.variables,
            context_bindings: existing.context_bindings,
            derived_from: existing.derived_from,
        };

        self.config
            .apply_snippet_change_set(std::slice::from_ref(&snippet), &[])
            .map_err(config_file_error)?;
        self.invalidate_catalog_cache();
        Ok(snippet)
    }

    /// 删除脚本片段。
    pub fn delete_snippet(&self, snippet_id: &str) -> AppResult<bool> {
        let snippet_id = normalize_required_text("片段 ID", snippet_id.to_owned(), 120)?;
        if self
            .config
            .snippet_by_id(&snippet_id)
            .map_err(config_file_error)?
            .is_none()
        {
            return Ok(false);
        }
        self.config
            .apply_snippet_change_set(&[], &[snippet_id])
            .map_err(config_file_error)?;
        self.invalidate_catalog_cache();
        Ok(true)
    }

    pub fn config(&self) -> &ConfigFileStore {
        &self.config
    }

    /// 应用内写入后立即丢弃只读目录缓存；外部文件写入由短 TTL 兜底。
    pub fn invalidate_catalog_cache(&self) {
        if let Ok(mut cache) = self.catalog_cache.lock() {
            *cache = None;
        }
    }

    pub fn delete_snippet_with_receipt(
        &self,
        snippet_id: &str,
    ) -> AppResult<crate::storage::config_file_store::SnippetDeleteReceipt> {
        let id = normalize_required_text("片段 ID", snippet_id.to_owned(), 120)?;
        self.config
            .snippet_by_id(&id)
            .map_err(config_file_error)?
            .ok_or_else(|| AppError::NotFound(format!("脚本片段不存在: {id}")))?;
        let receipt = self
            .config
            .delete_snippet_with_receipt(&id)
            .map_err(config_file_error)?;
        self.invalidate_catalog_cache();
        Ok(receipt)
    }

    pub fn restore_deleted_snippet(
        &self,
        receipt: &crate::storage::config_file_store::SnippetDeleteReceipt,
    ) -> AppResult<CommandSnippet> {
        let snippet = self
            .config
            .restore_deleted_snippet(receipt)
            .map_err(config_file_error)?;
        self.invalidate_catalog_cache();
        Ok(snippet)
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

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
