use super::*;
use crate::models::command_suggestion::SuggestionQueryMode;

#[derive(Debug, Clone)]
pub(super) struct NormalizedSuggestionRequest {
    pub(super) context_key: Option<String>,
    pub(super) cursor: usize,
    pub(super) cwd: Option<String>,
    pub(super) limit: usize,
    /// 候选展示模式，provider 和排序策略据此区分高精度 inline 与可发现 menu。
    pub(super) mode: SuggestionQueryMode,
    pub(super) prefix: String,
    pub(super) providers: Option<Vec<SuggestionProviderKind>>,
    pub(super) remote_host_id: Option<String>,
    pub(super) session_id: Option<String>,
    pub(super) shell: Option<String>,
    pub(super) target: CommandHistoryTarget,
}

impl NormalizedSuggestionRequest {
    pub(super) fn provider_enabled(&self, provider: SuggestionProviderKind) -> bool {
        self.providers
            .as_ref()
            .is_none_or(|providers| providers.contains(&provider))
    }
}

impl TryFrom<CommandSuggestionRequest> for NormalizedSuggestionRequest {
    type Error = AppError;

    fn try_from(request: CommandSuggestionRequest) -> Result<Self, Self::Error> {
        ensure_max_chars("命令输入", &request.input, MAX_INPUT_CHARS)?;
        let cursor = request.cursor.min(request.input.chars().count());
        let prefix = request.input.chars().take(cursor).collect::<String>();
        let providers = request.providers.map(|providers| {
            providers
                .into_iter()
                .collect::<HashSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
        });

        Ok(Self {
            context_key: normalize_optional_text(
                "建议上下文键",
                request.context_key,
                MAX_CONTEXT_CHARS,
            )?,
            cursor,
            cwd: normalize_optional_text("工作目录", request.cwd, MAX_CONTEXT_CHARS)?,
            limit: request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
            mode: request.mode,
            prefix,
            providers,
            remote_host_id: normalize_optional_text(
                "SSH 主机 id",
                request.remote_host_id,
                MAX_CONTEXT_CHARS,
            )?,
            session_id: normalize_optional_text(
                "session id",
                request.session_id,
                MAX_CONTEXT_CHARS,
            )?,
            shell: normalize_optional_text("Shell", request.shell, MAX_CONTEXT_CHARS)?,
            target: request.target,
        })
    }
}

#[derive(Debug, Clone)]
pub(super) struct NormalizedRemotePathRefreshRequest {
    pub(super) host_id: String,
    pub(super) max_entries: usize,
    pub(super) path: String,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone)]
pub(super) struct NormalizedRemoteCommandRefreshRequest {
    pub(super) host_id: String,
    pub(super) max_entries: usize,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone)]
pub(super) struct NormalizedRemoteHistoryRefreshRequest {
    pub(super) host_id: String,
    pub(super) max_entries: usize,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone)]
pub(super) struct NormalizedGitRefreshRequest {
    pub(super) cwd: String,
    pub(super) host_id: String,
    pub(super) max_entries: usize,
    pub(super) ttl_seconds: u64,
}

impl TryFrom<CommandSuggestionRemotePathRefreshRequest> for NormalizedRemotePathRefreshRequest {
    type Error = AppError;

    fn try_from(request: CommandSuggestionRemotePathRefreshRequest) -> Result<Self, Self::Error> {
        Ok(Self {
            host_id: normalize_required_text("SSH 主机 id", request.host_id, MAX_CONTEXT_CHARS)?,
            max_entries: request
                .max_entries
                .unwrap_or(DEFAULT_REMOTE_PATH_MAX_ENTRIES)
                .clamp(1, MAX_REMOTE_PATH_MAX_ENTRIES),
            path: normalize_required_text("远程目录", request.path, MAX_CONTEXT_CHARS)?,
            ttl_seconds: request
                .ttl_seconds
                .unwrap_or(DEFAULT_REMOTE_PATH_TTL_SECS)
                .clamp(1, MAX_REMOTE_PATH_TTL_SECS),
        })
    }
}

impl TryFrom<CommandSuggestionRemoteCommandRefreshRequest>
    for NormalizedRemoteCommandRefreshRequest
{
    type Error = AppError;

    fn try_from(
        request: CommandSuggestionRemoteCommandRefreshRequest,
    ) -> Result<Self, Self::Error> {
        Ok(Self {
            host_id: normalize_required_text("SSH 主机 id", request.host_id, MAX_CONTEXT_CHARS)?,
            max_entries: request
                .max_entries
                .unwrap_or(DEFAULT_REMOTE_COMMAND_MAX_ENTRIES)
                .clamp(1, MAX_REMOTE_COMMAND_MAX_ENTRIES),
            ttl_seconds: request
                .ttl_seconds
                .unwrap_or(DEFAULT_REMOTE_COMMAND_TTL_SECS)
                .clamp(1, MAX_REMOTE_COMMAND_TTL_SECS),
        })
    }
}

impl TryFrom<CommandSuggestionRemoteHistoryRefreshRequest>
    for NormalizedRemoteHistoryRefreshRequest
{
    type Error = AppError;

    fn try_from(
        request: CommandSuggestionRemoteHistoryRefreshRequest,
    ) -> Result<Self, Self::Error> {
        Ok(Self {
            host_id: normalize_required_text("SSH 主机 id", request.host_id, MAX_CONTEXT_CHARS)?,
            max_entries: request
                .max_entries
                .unwrap_or(DEFAULT_REMOTE_HISTORY_MAX_ENTRIES)
                .clamp(1, MAX_REMOTE_HISTORY_MAX_ENTRIES),
            ttl_seconds: request
                .ttl_seconds
                .unwrap_or(DEFAULT_REMOTE_HISTORY_TTL_SECS)
                .clamp(1, MAX_REMOTE_HISTORY_TTL_SECS),
        })
    }
}

impl TryFrom<CommandSuggestionGitRefreshRequest> for NormalizedGitRefreshRequest {
    type Error = AppError;

    fn try_from(request: CommandSuggestionGitRefreshRequest) -> Result<Self, Self::Error> {
        let cwd = normalize_required_text("远程工作目录", request.cwd, MAX_CONTEXT_CHARS)?;
        if contains_control_character(&cwd) {
            return Err(AppError::InvalidInput(
                "远程工作目录不能包含控制字符".to_owned(),
            ));
        }
        Ok(Self {
            cwd: normalize_remote_cache_path(&cwd),
            host_id: normalize_required_text("SSH 主机 id", request.host_id, MAX_CONTEXT_CHARS)?,
            max_entries: request
                .max_entries
                .unwrap_or(DEFAULT_GIT_MAX_ENTRIES)
                .clamp(1, MAX_GIT_MAX_ENTRIES),
            ttl_seconds: request
                .ttl_seconds
                .unwrap_or(DEFAULT_GIT_TTL_SECS)
                .clamp(1, MAX_GIT_TTL_SECS),
        })
    }
}

#[derive(Debug, Clone)]
pub(super) struct RemoteCommandCacheEntry {
    pub(super) cached_at: SystemTime,
    pub(super) commands: Vec<String>,
    pub(super) expires_at: SystemTime,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone)]
pub(super) struct RemoteHistoryCacheEntry {
    pub(super) cached_at: SystemTime,
    pub(super) commands: Vec<String>,
    pub(super) expires_at: SystemTime,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RemoteCommandToken {
    pub(super) name: String,
    pub(super) start: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct GitCacheKey {
    pub(super) cwd: String,
    pub(super) host_id: String,
}

#[derive(Debug, Clone)]
pub(super) struct GitCacheEntry {
    pub(super) cached_at: SystemTime,
    pub(super) cwd: String,
    pub(super) entries: Vec<GitRefEntry>,
    pub(super) expires_at: SystemTime,
    pub(super) repo_root: Option<String>,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct GitRefEntry {
    pub kind: GitRefKind,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum GitRefKind {
    Branch,
    Remote,
    RemoteBranch,
    Tag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GitSuggestionKind {
    BranchOrRef,
    Remote,
    Ref,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GitSuggestionToken {
    pub(super) kind: GitSuggestionKind,
    pub(super) name: String,
    pub(super) start: usize,
    pub(super) subcommand: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SpecSuggestionToken {
    pub(super) completed_words: Vec<String>,
    pub(super) name: String,
    pub(super) start: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ShellWord {
    pub(super) start: usize,
    pub(super) text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GitDiscoveryOutput {
    pub(super) entries: Vec<GitRefEntry>,
    pub(super) repo_root: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct RemotePathCacheKey {
    pub(super) directory: String,
    pub(super) host_id: String,
}

#[derive(Debug, Clone)]
pub(super) struct RemotePathCacheEntry {
    pub(super) cached_at: SystemTime,
    pub(super) entries: Vec<SftpEntry>,
    pub(super) expires_at: SystemTime,
    pub(super) ttl_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RemotePathToken {
    pub(super) base_name: String,
    pub(super) lookup_directory: String,
    pub(super) quote: ShellQuote,
    pub(super) raw_token_prefix: String,
    pub(super) start: usize,
}

#[derive(Debug)]
pub(super) struct CommandSuggestionTelemetryState {
    pub(super) providers: HashMap<SuggestionProviderKind, CommandSuggestionProviderTelemetryState>,
    pub(super) started_at: SystemTime,
}

impl CommandSuggestionTelemetryState {
    pub(super) fn provider_mut(
        &mut self,
        provider: SuggestionProviderKind,
    ) -> &mut CommandSuggestionProviderTelemetryState {
        self.providers.entry(provider).or_default()
    }
}

impl Default for CommandSuggestionTelemetryState {
    fn default() -> Self {
        Self {
            providers: HashMap::new(),
            started_at: SystemTime::now(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct CommandSuggestionProviderTelemetryState {
    pub(super) cache_hit_count: u64,
    pub(super) cache_miss_count: u64,
    pub(super) candidate_count: u64,
    pub(super) feedback_accepted_count: u64,
    pub(super) feedback_dismissed_count: u64,
    pub(super) feedback_skipped_count: u64,
    pub(super) last_error: Option<String>,
    pub(super) last_event_unix_ms: Option<u128>,
    pub(super) query_count: u64,
    pub(super) refresh_failure_count: u64,
    pub(super) refresh_success_count: u64,
    pub(super) total_elapsed_ms: u64,
}

impl CommandSuggestionProviderTelemetryState {
    pub(super) fn mark_event_at(&mut self, time: SystemTime) {
        self.last_event_unix_ms = Some(unix_time_millis(time));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ShellQuote {
    None,
    Single,
    Double,
}

impl ShellQuote {
    pub(super) fn opening(self) -> &'static str {
        match self {
            Self::None => "",
            Self::Single => "'",
            Self::Double => "\"",
        }
    }

    pub(super) fn closing_char(self) -> Option<char> {
        match self {
            Self::None => None,
            Self::Single => Some('\''),
            Self::Double => Some('"'),
        }
    }
}
