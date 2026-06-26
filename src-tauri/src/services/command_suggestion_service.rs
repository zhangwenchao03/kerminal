//! 命令建议业务服务。
//!
//! @author kongweiguang

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::command_suggestion_audit as command_suggestion_event_store;
use crate::{
    error::{AppError, AppResult},
    models::{
        command_history::{CommandHistoryEntry, CommandHistorySource, CommandHistoryTarget},
        command_suggestion::{
            CommandSuggestionAuditDecision, CommandSuggestionAuditEventKind,
            CommandSuggestionAuditRecordRequest, CommandSuggestionAuditRecordResult,
            CommandSuggestionCandidate, CommandSuggestionDiagnosticsCleanupRequest,
            CommandSuggestionDiagnosticsCleanupResult, CommandSuggestionFeedbackAction,
            CommandSuggestionFeedbackRecordRequest, CommandSuggestionFeedbackRecordResult,
            CommandSuggestionGitRefreshRequest, CommandSuggestionGitRefreshResult,
            CommandSuggestionProviderTelemetry, CommandSuggestionRemoteCommandRefreshRequest,
            CommandSuggestionRemoteCommandRefreshResult,
            CommandSuggestionRemoteHistoryRefreshRequest,
            CommandSuggestionRemoteHistoryRefreshResult, CommandSuggestionRemotePathRefreshRequest,
            CommandSuggestionRemotePathRefreshResult, CommandSuggestionReplacementRange,
            CommandSuggestionRequest, CommandSuggestionSensitivity,
            CommandSuggestionTelemetryExport, CommandSuggestionTelemetrySummary,
            SuggestionProviderKind,
        },
        settings::{
            TerminalInlineSuggestionProductionHostPolicy, TerminalInlineSuggestionSettings,
        },
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind, SftpListDirectoryRequest},
        ssh_command::SshCommandRequest,
    },
    paths::KerminalPaths,
    services::{
        command_history_service::CommandHistoryService, sftp_service::SftpService,
        ssh_command_service::SshCommandService,
    },
    storage::{
        command_suggestion_cache::CommandSuggestionProviderCacheWrite,
        command_suggestion_feedback::CommandSuggestionFeedbackWrite,
        command_suggestion_telemetry::{
            CommandSuggestionTelemetryRow, CommandSuggestionTelemetryUpdate,
        },
        config_file_store::ConfigFileStore,
        file_store::FileStoreError,
        CommandSqliteStore,
    },
};

mod api;
mod cache_utils;
pub mod classification;
pub mod discovery;
mod feedback;
mod git_candidates;
mod history_candidates;
mod model;
mod providers;
mod refresh;
mod shell_path;
mod spec_candidates;
mod telemetry_persistence;

pub use self::model::{GitRefEntry, GitRefKind};

use self::{
    cache_utils::*, classification::*, discovery::*, feedback::*, git_candidates::*,
    history_candidates::*, model::*, shell_path::*, spec_candidates::*, telemetry_persistence::*,
};

const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 50;
const HISTORY_SCAN_LIMIT: usize = 500;
const MAX_INPUT_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 1_000;
const MAX_AUDIT_EVENTS_EXPORT: usize = 100;
const DEFAULT_AUDIT_RETENTION_DAYS: u32 = 30;
const DEFAULT_FEEDBACK_RETENTION_DAYS: u32 = 365;
const MAX_DIAGNOSTIC_RETENTION_DAYS: u32 = 3_650;
const MAX_AUDIT_METADATA_ENTRIES: usize = 16;
const MAX_AUDIT_METADATA_KEY_CHARS: usize = 64;
const MAX_AUDIT_METADATA_VALUE_CHARS: usize = 256;
const FEEDBACK_ACCEPTED_SCORE_BONUS: f64 = 0.025;
const FEEDBACK_DISMISSED_SCORE_PENALTY: f64 = 0.12;
const FEEDBACK_SCORE_COUNT_CAP: u32 = 20;
const DEFAULT_REMOTE_PATH_TTL_SECS: u64 = 30;
const MAX_REMOTE_PATH_TTL_SECS: u64 = 300;
const DEFAULT_REMOTE_PATH_MAX_ENTRIES: usize = 250;
const MAX_REMOTE_PATH_MAX_ENTRIES: usize = 1_000;
const MAX_REMOTE_PATH_CACHE_DIRECTORIES: usize = 256;
const REMOTE_COMMAND_CACHE_SCOPE_KEY: &str = "";
const DEFAULT_REMOTE_COMMAND_TTL_SECS: u64 = 300;
const MAX_REMOTE_COMMAND_TTL_SECS: u64 = 3_600;
const DEFAULT_REMOTE_COMMAND_MAX_ENTRIES: usize = 1_500;
const MAX_REMOTE_COMMAND_MAX_ENTRIES: usize = 5_000;
const REMOTE_COMMAND_DISCOVERY_TIMEOUT_SECS: u64 = 2;
const REMOTE_COMMAND_DISCOVERY_OUTPUT_BYTES: usize = 64 * 1024;
const REMOTE_HISTORY_CACHE_SCOPE_KEY: &str = "remoteHistory";
const DEFAULT_REMOTE_HISTORY_TTL_SECS: u64 = 900;
const MAX_REMOTE_HISTORY_TTL_SECS: u64 = 86_400;
const DEFAULT_REMOTE_HISTORY_MAX_ENTRIES: usize = 1_000;
const MAX_REMOTE_HISTORY_MAX_ENTRIES: usize = 5_000;
const REMOTE_HISTORY_DISCOVERY_TIMEOUT_SECS: u64 = 2;
const REMOTE_HISTORY_DISCOVERY_OUTPUT_BYTES: usize = 256 * 1024;
const REMOTE_HISTORY_DISCOVERY_SCRIPT: &str = r#"
HISTORY_LINE_LIMIT=3000
HOME_DIR=${HOME:-}
[ -n "$HOME_DIR" ] || exit 0
for file in \
  "$HOME_DIR/.history" \
  "$HOME_DIR/.sh_history" \
  "$HOME_DIR/.ash_history" \
  "$HOME_DIR/.zsh_history" \
  "$HOME_DIR/.bash_history"
do
  [ -r "$file" ] || continue
  tail -n "$HISTORY_LINE_LIMIT" "$file" 2>/dev/null || cat "$file" 2>/dev/null
done
"#;
const DEFAULT_GIT_TTL_SECS: u64 = 60;
const MAX_GIT_TTL_SECS: u64 = 600;
const DEFAULT_GIT_MAX_ENTRIES: usize = 500;
const MAX_GIT_MAX_ENTRIES: usize = 5_000;
const MAX_GIT_CACHE_REPOSITORIES: usize = 128;
const GIT_DISCOVERY_TIMEOUT_SECS: u64 = 2;
const GIT_DISCOVERY_OUTPUT_BYTES: usize = 64 * 1024;
const POSIX_SHELL_BUILTINS: &[&str] = &[
    "alias", "bg", "break", "cd", "command", "continue", "echo", "eval", "exec", "exit", "export",
    "false", "fg", "jobs", "kill", "printf", "pwd", "read", "return", "set", "shift", "test",
    "times", "trap", "true", "type", "ulimit", "umask", "unalias", "unset", "wait",
];
const SPEC_COMMANDS: &[&str] = &[
    "cargo",
    "docker",
    "git",
    "kubectl",
    "npm",
    "ssh",
    "systemctl",
];
const TELEMETRY_PROVIDER_ORDER: &[SuggestionProviderKind] = &[
    SuggestionProviderKind::History,
    SuggestionProviderKind::RemotePath,
    SuggestionProviderKind::RemoteCommand,
    SuggestionProviderKind::Git,
    SuggestionProviderKind::Spec,
];
const SPEC_GIT_SUBCOMMANDS: &[&str] = &[
    "add",
    "branch",
    "checkout",
    "cherry-pick",
    "clone",
    "commit",
    "diff",
    "fetch",
    "log",
    "merge",
    "pull",
    "push",
    "rebase",
    "remote",
    "restore",
    "show",
    "stash",
    "status",
    "switch",
    "tag",
];
const SPEC_GIT_OPTIONS: &[&str] = &[
    "--all",
    "--amend",
    "--cached",
    "--force-with-lease",
    "--global",
    "--hard",
    "--message",
    "--oneline",
    "--patch",
    "--quiet",
    "--rebase",
    "--set-upstream",
];
const SPEC_DOCKER_SUBCOMMANDS: &[&str] = &[
    "build", "compose", "exec", "images", "inspect", "logs", "network", "ps", "pull", "push",
    "run", "stop", "volume",
];
const SPEC_DOCKER_COMPOSE_SUBCOMMANDS: &[&str] = &[
    "build", "config", "down", "exec", "logs", "ps", "pull", "restart", "run", "stop", "up",
];
const SPEC_DOCKER_OPTIONS: &[&str] = &[
    "--build",
    "--detach",
    "--file",
    "--follow",
    "--force-recreate",
    "--name",
    "--no-cache",
    "--platform",
    "--pull",
    "--rm",
    "--tag",
    "--volumes",
];
const SPEC_KUBECTL_SUBCOMMANDS: &[&str] = &[
    "apply",
    "config",
    "create",
    "delete",
    "describe",
    "exec",
    "get",
    "logs",
    "port-forward",
    "rollout",
    "scale",
    "top",
];
const SPEC_KUBECTL_RESOURCES: &[&str] = &[
    "configmaps",
    "cronjobs",
    "deployments",
    "events",
    "ingress",
    "jobs",
    "namespaces",
    "nodes",
    "pods",
    "replicasets",
    "secrets",
    "services",
    "statefulsets",
];
const SPEC_KUBECTL_OPTIONS: &[&str] = &[
    "--all-namespaces",
    "--container",
    "--context",
    "--dry-run",
    "--filename",
    "--follow",
    "--namespace",
    "--output",
    "--selector",
    "--watch",
];
const SPEC_NPM_SUBCOMMANDS: &[&str] = &[
    "ci", "install", "link", "login", "outdated", "publish", "run", "test", "update", "version",
];
const SPEC_NPM_OPTIONS: &[&str] = &[
    "--dry-run",
    "--global",
    "--if-present",
    "--legacy-peer-deps",
    "--omit",
    "--prefix",
    "--save-dev",
    "--workspace",
];
const SPEC_CARGO_SUBCOMMANDS: &[&str] = &[
    "add", "build", "check", "clean", "clippy", "doc", "fmt", "install", "run", "test", "update",
];
const SPEC_CARGO_OPTIONS: &[&str] = &[
    "--all-features",
    "--bin",
    "--features",
    "--locked",
    "--manifest-path",
    "--package",
    "--release",
    "--target",
    "--workspace",
];
const SPEC_SSH_OPTIONS: &[&str] = &[
    "-A", "-F", "-i", "-J", "-L", "-N", "-o", "-p", "-R", "-T", "-v",
];
const SPEC_SYSTEMCTL_SUBCOMMANDS: &[&str] = &[
    "daemon-reload",
    "disable",
    "enable",
    "is-active",
    "restart",
    "start",
    "status",
    "stop",
];
const SPEC_SYSTEMCTL_OPTIONS: &[&str] = &["--failed", "--global", "--no-pager", "--now", "--user"];

/// 命令建议业务入口。
#[derive(Debug, Default)]
pub struct CommandSuggestionService {
    git_ref_cache: Mutex<HashMap<GitCacheKey, GitCacheEntry>>,
    pending_telemetry_updates:
        Mutex<HashMap<SuggestionProviderKind, CommandSuggestionTelemetryUpdate>>,
    remote_command_cache: Mutex<HashMap<String, RemoteCommandCacheEntry>>,
    remote_history_cache: Mutex<HashMap<String, RemoteHistoryCacheEntry>>,
    remote_path_cache: Mutex<HashMap<RemotePathCacheKey, RemotePathCacheEntry>>,
    telemetry: Mutex<CommandSuggestionTelemetryState>,
}

#[derive(Debug)]
struct RemoteProbePolicySkip {
    production_host: bool,
    production_host_policy: TerminalInlineSuggestionProductionHostPolicy,
    remote_probe_enabled: bool,
    reason: &'static str,
}
