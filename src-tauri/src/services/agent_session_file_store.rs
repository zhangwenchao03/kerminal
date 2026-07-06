//! Agent session file-backed store.
//!
//! @author kongweiguang

use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::de::DeserializeOwned;

use crate::{
    error::{AppError, AppResult},
    models::agent_session::{
        AgentMcpCallLogEntry, AgentMcpEndpointContext, AgentProviderSession, AgentSession,
        AgentSessionContextPaths, AgentSessionDiagnostic, AgentSessionId, AgentSessionList,
        AgentSessionPaths, AgentSessionRecord, AgentTargetBindingContext,
        AgentTerminalSnapshotContext, AgentWorkspaceSnapshotContext, AGENT_SESSION_SCHEMA_VERSION,
    },
    storage::file_store::{
        FileStore, FileStoreError, FileStoreResult, TomlDocument, TomlParseError,
    },
};

const SESSIONS_RELATIVE_DIR: &str = "agents/sessions";
const SESSION_TOML_FILE: &str = "session.toml";
const PROVIDER_TOML_FILE: &str = "provider.toml";
const CONTEXT_RELATIVE_DIR: &str = "context";
const TARGET_BINDING_JSON_FILE: &str = "target-binding.json";
const MCP_ENDPOINT_JSON_FILE: &str = "mcp-endpoint.json";
const TERMINAL_SNAPSHOT_JSON_FILE: &str = "terminal-snapshot.json";
const WORKSPACE_SNAPSHOT_JSON_FILE: &str = "workspace-snapshot.json";
const LOGS_RELATIVE_DIR: &str = "logs";
const MCP_CALLS_JSONL_FILE: &str = "mcp-calls.jsonl";
const AGENT_SESSION_JSONL_ROTATE_BYTES: u64 = 1024 * 1024;
const MCP_CALL_LOG_FIELD_MAX_CHARS: usize = 4096;

/// Agent session 文件存储。
#[derive(Debug, Clone)]
pub struct AgentSessionFileStore {
    files: FileStore,
}

impl AgentSessionFileStore {
    /// 创建 Agent session 文件存储，root 应为 `~/.kerminal`。
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self {
            files: FileStore::new(workspace_root),
        }
    }

    /// 返回 Kerminal 文件优先 workspace 根目录。
    pub fn workspace_root(&self) -> &Path {
        self.files.root()
    }

    /// 返回指定 session 的路径集合。
    pub fn paths_for(&self, agent_session_id: &AgentSessionId) -> AppResult<AgentSessionPaths> {
        let session_root = self.session_root(agent_session_id)?;
        Ok(AgentSessionPaths {
            workspace_root: path_to_string(self.workspace_root()),
            session_root: path_to_string(&session_root),
            session_toml: path_to_string(&session_root.join(SESSION_TOML_FILE)),
            provider_toml: path_to_string(&session_root.join(PROVIDER_TOML_FILE)),
            context: AgentSessionContextPaths {
                target_binding_json: path_to_string(
                    &session_root
                        .join(CONTEXT_RELATIVE_DIR)
                        .join(TARGET_BINDING_JSON_FILE),
                ),
                mcp_endpoint_json: path_to_string(
                    &session_root
                        .join(CONTEXT_RELATIVE_DIR)
                        .join(MCP_ENDPOINT_JSON_FILE),
                ),
                terminal_snapshot_json: path_to_string(
                    &session_root
                        .join(CONTEXT_RELATIVE_DIR)
                        .join(TERMINAL_SNAPSHOT_JSON_FILE),
                ),
                workspace_snapshot_json: path_to_string(
                    &session_root
                        .join(CONTEXT_RELATIVE_DIR)
                        .join(WORKSPACE_SNAPSHOT_JSON_FILE),
                ),
            },
        })
    }

    /// 返回指定 session 的目录。
    pub fn session_root(&self, agent_session_id: &AgentSessionId) -> AppResult<PathBuf> {
        self.files
            .path_for(session_relative_dir(agent_session_id))
            .map_err(file_store_error)
    }

    /// 写入 `session.toml`。
    pub fn write_session(&self, session: &AgentSession) -> AppResult<AgentSessionPaths> {
        session.validate()?;
        self.files
            .write_toml(
                session_toml_relative_path(&session.agent_session_id),
                session,
            )
            .map_err(file_store_error)?;
        self.paths_for(&session.agent_session_id)
    }

    /// 读取 `session.toml`。
    pub fn read_session(&self, agent_session_id: &AgentSessionId) -> AppResult<AgentSession> {
        let session = self
            .files
            .read_toml::<AgentSession>(session_toml_relative_path(agent_session_id))
            .map_err(file_store_error)?;
        if session.agent_session_id != *agent_session_id {
            return Err(AppError::InvalidInput(format!(
                "Agent session id mismatch: expected {}, found {}",
                agent_session_id, session.agent_session_id
            )));
        }
        session.validate()?;
        Ok(session)
    }

    /// 写入 `provider.toml`。
    pub fn write_provider(
        &self,
        agent_session_id: &AgentSessionId,
        provider: &AgentProviderSession,
    ) -> AppResult<()> {
        provider.validate()?;
        self.files
            .write_toml(provider_toml_relative_path(agent_session_id), provider)
            .map(|_| ())
            .map_err(file_store_error)
    }

    /// 读取 `provider.toml`。
    pub fn read_provider(
        &self,
        agent_session_id: &AgentSessionId,
    ) -> AppResult<AgentProviderSession> {
        let provider = self
            .files
            .read_toml::<AgentProviderSession>(provider_toml_relative_path(agent_session_id))
            .map_err(file_store_error)?;
        provider.validate()?;
        Ok(provider)
    }

    /// 写入 `context/target-binding.json`。
    pub fn write_target_binding_context(
        &self,
        context: &AgentTargetBindingContext,
    ) -> AppResult<()> {
        context.validate()?;
        self.write_json(
            target_binding_relative_path(&context.agent_session_id),
            context,
        )
    }

    /// 读取 `context/target-binding.json`。
    pub fn read_target_binding_context(
        &self,
        agent_session_id: &AgentSessionId,
    ) -> AppResult<AgentTargetBindingContext> {
        let context: AgentTargetBindingContext =
            self.read_json(target_binding_relative_path(agent_session_id))?;
        context.validate()?;
        Ok(context)
    }

    /// 写入 `context/mcp-endpoint.json`。
    pub fn write_mcp_endpoint_context(&self, context: &AgentMcpEndpointContext) -> AppResult<()> {
        context.validate()?;
        self.write_json(
            mcp_endpoint_relative_path(&context.agent_session_id),
            context,
        )
    }

    /// 读取 `context/mcp-endpoint.json`。
    pub fn read_mcp_endpoint_context(
        &self,
        agent_session_id: &AgentSessionId,
    ) -> AppResult<AgentMcpEndpointContext> {
        let context: AgentMcpEndpointContext =
            self.read_json(mcp_endpoint_relative_path(agent_session_id))?;
        context.validate()?;
        Ok(context)
    }

    /// 写入 `context/terminal-snapshot.json`。
    pub fn write_terminal_snapshot_context(
        &self,
        context: &AgentTerminalSnapshotContext,
    ) -> AppResult<()> {
        context.validate()?;
        self.write_json(
            terminal_snapshot_relative_path(&context.agent_session_id),
            context,
        )
    }

    /// 写入 `context/workspace-snapshot.json`。
    pub fn write_workspace_snapshot_context(
        &self,
        context: &AgentWorkspaceSnapshotContext,
    ) -> AppResult<()> {
        context.validate()?;
        self.write_json(
            workspace_snapshot_relative_path(&context.agent_session_id),
            context,
        )
    }

    /// 追加 `logs/mcp-calls.jsonl`，超过阈值时先按时间滚动旧日志。
    pub fn append_mcp_call_log(&self, entry: &AgentMcpCallLogEntry) -> AppResult<()> {
        let entry = bounded_mcp_call_log_entry(entry);
        entry.validate()?;
        self.append_rotating_jsonl(mcp_calls_log_relative_path(&entry.agent_session_id), &entry)
    }

    /// 读取单个 session 聚合视图。
    pub fn read_record(&self, agent_session_id: &AgentSessionId) -> AppResult<AgentSessionRecord> {
        let session = self.read_session(agent_session_id)?;
        Ok(self.record_for_session(session).0)
    }

    /// 列出所有 session。坏文件不会让列表失败，会进入 diagnostics。
    pub fn list_sessions(&self) -> AppResult<AgentSessionList> {
        let sessions_dir = self
            .files
            .path_for(SESSIONS_RELATIVE_DIR)
            .map_err(file_store_error)?;
        let entries = match fs::read_dir(&sessions_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok(AgentSessionList {
                    sessions: Vec::new(),
                    diagnostics: Vec::new(),
                });
            }
            Err(error) => return Err(AppError::Io(error)),
        };

        let mut sessions = Vec::new();
        let mut diagnostics = Vec::new();

        for entry in entries {
            let entry = entry.map_err(AppError::Io)?;
            if !entry.file_type().map_err(AppError::Io)?.is_dir() {
                continue;
            }
            let Some(raw_id) = entry.file_name().to_str().map(str::to_owned) else {
                diagnostics.push(AgentSessionDiagnostic {
                    path: Some(path_to_string(&entry.path())),
                    code: "invalidSessionDirectoryName".to_owned(),
                    message: "Agent session 目录名不是合法 UTF-8".to_owned(),
                    line: None,
                    column: None,
                });
                continue;
            };
            let agent_session_id = match AgentSessionId::new(raw_id.clone()) {
                Ok(agent_session_id) => agent_session_id,
                Err(error) => {
                    diagnostics.push(AgentSessionDiagnostic {
                        path: Some(path_to_string(&entry.path())),
                        code: "invalidSessionId".to_owned(),
                        message: error.to_string(),
                        line: None,
                        column: None,
                    });
                    continue;
                }
            };

            match self.read_session_for_list(&agent_session_id) {
                Ok(session) => {
                    let (record, mut record_diagnostics) = self.record_for_session(session);
                    diagnostics.append(&mut record_diagnostics);
                    sessions.push(record);
                }
                Err(error) => diagnostics.extend(error),
            }
        }

        sort_session_records(&mut sessions);
        Ok(AgentSessionList {
            sessions,
            diagnostics,
        })
    }

    fn write_json<T: serde::Serialize>(
        &self,
        relative_path: impl AsRef<Path>,
        value: &T,
    ) -> AppResult<()> {
        let mut contents = serde_json::to_vec_pretty(value)?;
        contents.push(b'\n');
        self.files
            .atomic_write(relative_path, &contents)
            .map(|_| ())
            .map_err(file_store_error)
    }

    fn read_json<T: DeserializeOwned>(&self, relative_path: impl AsRef<Path>) -> AppResult<T> {
        let relative_path = relative_path.as_ref();
        let absolute_path = self
            .files
            .path_for(relative_path)
            .map_err(file_store_error)?;
        let contents = fs::read_to_string(&absolute_path)?;
        serde_json::from_str(&contents).map_err(AppError::Json)
    }

    fn append_rotating_jsonl<T: serde::Serialize>(
        &self,
        relative_path: impl AsRef<Path>,
        value: &T,
    ) -> AppResult<()> {
        let relative_path = relative_path.as_ref();
        let absolute_path = self
            .files
            .path_for(relative_path)
            .map_err(file_store_error)?;
        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent)?;
        }
        rotate_jsonl_if_needed(&absolute_path)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&absolute_path)?;
        let line = serde_json::to_string(value)?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        Ok(())
    }

    fn read_session_for_list(
        &self,
        agent_session_id: &AgentSessionId,
    ) -> Result<AgentSession, Vec<AgentSessionDiagnostic>> {
        let relative_path = session_toml_relative_path(agent_session_id);
        match self.files.read_toml::<AgentSession>(&relative_path) {
            Ok(session) => {
                let mut diagnostics = Vec::new();
                if session.agent_session_id != *agent_session_id {
                    diagnostics.push(AgentSessionDiagnostic {
                        path: Some(relative_path_string(&relative_path)),
                        code: "sessionIdMismatch".to_owned(),
                        message: format!(
                            "Agent session id mismatch: expected {}, found {}",
                            agent_session_id, session.agent_session_id
                        ),
                        line: None,
                        column: None,
                    });
                    return Err(diagnostics);
                }
                if let Err(error) = session.validate() {
                    diagnostics.push(AgentSessionDiagnostic {
                        path: Some(relative_path_string(&relative_path)),
                        code: "invalidSession".to_owned(),
                        message: error.to_string(),
                        line: None,
                        column: None,
                    });
                    return Err(diagnostics);
                }
                Ok(session)
            }
            Err(error) => Err(diagnostics_from_file_store_error(&relative_path, &error)),
        }
    }

    fn record_for_session(
        &self,
        session: AgentSession,
    ) -> (AgentSessionRecord, Vec<AgentSessionDiagnostic>) {
        let mut diagnostics = Vec::new();
        let agent_session_id = session.agent_session_id.clone();
        let provider = self.read_optional_provider(&agent_session_id, &mut diagnostics);
        let target_binding = self.read_optional_target_binding(&agent_session_id, &mut diagnostics);
        let mcp_endpoint = self.read_optional_mcp_endpoint(&agent_session_id, &mut diagnostics);
        let paths = self
            .paths_for(&agent_session_id)
            .unwrap_or_else(|_| fallback_paths(self.workspace_root(), &agent_session_id));
        let record_diagnostics = diagnostics.clone();
        (
            AgentSessionRecord {
                session,
                provider,
                target_binding,
                mcp_endpoint,
                paths,
                diagnostics: record_diagnostics,
            },
            diagnostics,
        )
    }

    fn read_optional_provider(
        &self,
        agent_session_id: &AgentSessionId,
        diagnostics: &mut Vec<AgentSessionDiagnostic>,
    ) -> Option<AgentProviderSession> {
        let relative_path = provider_toml_relative_path(agent_session_id);
        match self.files.read_toml::<AgentProviderSession>(&relative_path) {
            Ok(provider) => match provider.validate() {
                Ok(()) => Some(provider),
                Err(error) => {
                    diagnostics.push(AgentSessionDiagnostic {
                        path: Some(relative_path_string(&relative_path)),
                        code: "invalidProvider".to_owned(),
                        message: error.to_string(),
                        line: None,
                        column: None,
                    });
                    None
                }
            },
            Err(FileStoreError::Io(error)) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                diagnostics.extend(diagnostics_from_file_store_error(&relative_path, &error));
                None
            }
        }
    }

    fn read_optional_target_binding(
        &self,
        agent_session_id: &AgentSessionId,
        diagnostics: &mut Vec<AgentSessionDiagnostic>,
    ) -> Option<AgentTargetBindingContext> {
        let relative_path = target_binding_relative_path(agent_session_id);
        match self.read_json::<AgentTargetBindingContext>(&relative_path) {
            Ok(context) => match context.validate() {
                Ok(()) => Some(context),
                Err(error) => {
                    diagnostics.push(AgentSessionDiagnostic {
                        path: Some(relative_path_string(&relative_path)),
                        code: "invalidTargetBinding".to_owned(),
                        message: error.to_string(),
                        line: None,
                        column: None,
                    });
                    None
                }
            },
            Err(AppError::Io(error)) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                diagnostics.push(AgentSessionDiagnostic {
                    path: Some(relative_path_string(&relative_path)),
                    code: "invalidTargetBinding".to_owned(),
                    message: error.to_string(),
                    line: None,
                    column: None,
                });
                None
            }
        }
    }

    fn read_optional_mcp_endpoint(
        &self,
        agent_session_id: &AgentSessionId,
        diagnostics: &mut Vec<AgentSessionDiagnostic>,
    ) -> Option<AgentMcpEndpointContext> {
        let relative_path = mcp_endpoint_relative_path(agent_session_id);
        match self.read_json::<AgentMcpEndpointContext>(&relative_path) {
            Ok(context) => match context.validate() {
                Ok(()) => Some(context),
                Err(error) => {
                    diagnostics.push(AgentSessionDiagnostic {
                        path: Some(relative_path_string(&relative_path)),
                        code: "invalidMcpEndpoint".to_owned(),
                        message: error.to_string(),
                        line: None,
                        column: None,
                    });
                    None
                }
            },
            Err(AppError::Io(error)) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => {
                diagnostics.push(AgentSessionDiagnostic {
                    path: Some(relative_path_string(&relative_path)),
                    code: "invalidMcpEndpoint".to_owned(),
                    message: error.to_string(),
                    line: None,
                    column: None,
                });
                None
            }
        }
    }
}

impl TomlDocument for AgentSession {
    fn encode_toml(&self) -> FileStoreResult<String> {
        toml::to_string_pretty(self).map_err(|error| FileStoreError::TomlEncode(error.to_string()))
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        let session: AgentSession = toml::from_str(source)
            .map_err(|error| TomlParseError::single(1, 1, error.to_string()))?;
        if session.schema_version != AGENT_SESSION_SCHEMA_VERSION {
            return Err(TomlParseError::single(
                1,
                1,
                format!(
                    "unsupported agent session schema_version: {}, expected {}",
                    session.schema_version, AGENT_SESSION_SCHEMA_VERSION
                ),
            ));
        }
        Ok(session)
    }
}

impl TomlDocument for AgentProviderSession {
    fn encode_toml(&self) -> FileStoreResult<String> {
        toml::to_string_pretty(self).map_err(|error| FileStoreError::TomlEncode(error.to_string()))
    }

    fn decode_toml(source: &str) -> Result<Self, TomlParseError> {
        let provider: AgentProviderSession = toml::from_str(source)
            .map_err(|error| TomlParseError::single(1, 1, error.to_string()))?;
        if provider.schema_version != AGENT_SESSION_SCHEMA_VERSION {
            return Err(TomlParseError::single(
                1,
                1,
                format!(
                    "unsupported agent provider schema_version: {}, expected {}",
                    provider.schema_version, AGENT_SESSION_SCHEMA_VERSION
                ),
            ));
        }
        Ok(provider)
    }
}

fn sort_session_records(records: &mut [AgentSessionRecord]) {
    records.sort_by(|left, right| {
        timestamp_sort_key(&right.session.updated_at)
            .cmp(&timestamp_sort_key(&left.session.updated_at))
            .then_with(|| {
                timestamp_sort_key(&right.session.created_at)
                    .cmp(&timestamp_sort_key(&left.session.created_at))
            })
            .then_with(|| {
                left.session
                    .agent_session_id
                    .as_str()
                    .cmp(right.session.agent_session_id.as_str())
            })
    });
}

fn timestamp_sort_key(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or_default()
}

fn session_relative_dir(agent_session_id: &AgentSessionId) -> PathBuf {
    PathBuf::from(SESSIONS_RELATIVE_DIR).join(agent_session_id.as_str())
}

fn session_toml_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id).join(SESSION_TOML_FILE)
}

fn provider_toml_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id).join(PROVIDER_TOML_FILE)
}

fn target_binding_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id)
        .join(CONTEXT_RELATIVE_DIR)
        .join(TARGET_BINDING_JSON_FILE)
}

fn mcp_endpoint_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id)
        .join(CONTEXT_RELATIVE_DIR)
        .join(MCP_ENDPOINT_JSON_FILE)
}

fn terminal_snapshot_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id)
        .join(CONTEXT_RELATIVE_DIR)
        .join(TERMINAL_SNAPSHOT_JSON_FILE)
}

fn workspace_snapshot_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id)
        .join(CONTEXT_RELATIVE_DIR)
        .join(WORKSPACE_SNAPSHOT_JSON_FILE)
}

fn mcp_calls_log_relative_path(agent_session_id: &AgentSessionId) -> PathBuf {
    session_relative_dir(agent_session_id)
        .join(LOGS_RELATIVE_DIR)
        .join(MCP_CALLS_JSONL_FILE)
}

fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}

fn relative_path_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn rotate_jsonl_if_needed(path: &Path) -> AppResult<()> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(());
    };
    if !metadata.is_file() || metadata.len() < AGENT_SESSION_JSONL_ROTATE_BYTES {
        return Ok(());
    }

    let parent = path.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("missing log parent for {}", path.display()))
    })?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("agent-session");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("jsonl");
    let mut rotated_path =
        parent.join(format!("{stem}.{}.{}", current_unix_timestamp(), extension));
    if rotated_path.exists() {
        rotated_path = parent.join(format!(
            "{stem}.{}.{}.{}",
            current_unix_timestamp(),
            std::process::id(),
            extension
        ));
    }
    fs::rename(path, rotated_path)?;
    Ok(())
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn fallback_paths(workspace_root: &Path, agent_session_id: &AgentSessionId) -> AgentSessionPaths {
    let session_root = workspace_root
        .join(SESSIONS_RELATIVE_DIR)
        .join(agent_session_id.as_str());
    AgentSessionPaths {
        workspace_root: path_to_string(workspace_root),
        session_root: path_to_string(&session_root),
        session_toml: path_to_string(&session_root.join(SESSION_TOML_FILE)),
        provider_toml: path_to_string(&session_root.join(PROVIDER_TOML_FILE)),
        context: AgentSessionContextPaths {
            target_binding_json: path_to_string(
                &session_root
                    .join(CONTEXT_RELATIVE_DIR)
                    .join(TARGET_BINDING_JSON_FILE),
            ),
            mcp_endpoint_json: path_to_string(
                &session_root
                    .join(CONTEXT_RELATIVE_DIR)
                    .join(MCP_ENDPOINT_JSON_FILE),
            ),
            terminal_snapshot_json: path_to_string(
                &session_root
                    .join(CONTEXT_RELATIVE_DIR)
                    .join(TERMINAL_SNAPSHOT_JSON_FILE),
            ),
            workspace_snapshot_json: path_to_string(
                &session_root
                    .join(CONTEXT_RELATIVE_DIR)
                    .join(WORKSPACE_SNAPSHOT_JSON_FILE),
            ),
        },
    }
}

fn bounded_mcp_call_log_entry(entry: &AgentMcpCallLogEntry) -> AgentMcpCallLogEntry {
    AgentMcpCallLogEntry {
        schema_version: entry.schema_version,
        agent_session_id: entry.agent_session_id.clone(),
        tool_id: entry.tool_id.clone(),
        status: entry.status.clone(),
        summary: truncate_optional_log_field(entry.summary.as_deref()),
        error: truncate_optional_log_field(entry.error.as_deref()),
        runtime_audit: truncate_optional_log_field(entry.runtime_audit.as_deref()),
        generated_at: entry.generated_at.clone(),
    }
}

fn truncate_optional_log_field(value: Option<&str>) -> Option<String> {
    value.map(|value| truncate_log_field(value, MCP_CALL_LOG_FIELD_MAX_CHARS))
}

fn truncate_log_field(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn diagnostics_from_file_store_error(
    relative_path: &Path,
    error: &FileStoreError,
) -> Vec<AgentSessionDiagnostic> {
    match error {
        FileStoreError::TomlParse(parse_error) => parse_error
            .diagnostics()
            .iter()
            .map(|diagnostic| AgentSessionDiagnostic {
                path: diagnostic
                    .path
                    .as_deref()
                    .map(relative_path_string)
                    .or_else(|| Some(relative_path_string(relative_path))),
                code: "invalidToml".to_owned(),
                message: diagnostic.message.clone(),
                line: Some(diagnostic.line),
                column: Some(diagnostic.column),
            })
            .collect(),
        other => vec![AgentSessionDiagnostic {
            path: Some(relative_path_string(relative_path)),
            code: "fileReadFailed".to_owned(),
            message: other.to_string(),
            line: None,
            column: None,
        }],
    }
}

fn file_store_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}
