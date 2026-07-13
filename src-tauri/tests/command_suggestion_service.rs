//! 命令建议服务集成测试。
//!
//! @author kongweiguang

use std::{
    collections::BTreeMap,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use kerminal_lib::{
    models::{
        command_history::{
            CommandHistoryRecordRequest, CommandHistorySource, CommandHistoryTarget,
        },
        command_suggestion::{
            CommandSuggestionAuditDecision, CommandSuggestionAuditEventKind,
            CommandSuggestionAuditRecordRequest, CommandSuggestionDiagnosticsCleanupRequest,
            CommandSuggestionFeedbackAction, CommandSuggestionFeedbackRecordRequest,
            CommandSuggestionRequest, CommandSuggestionSensitivity, SuggestionProviderKind,
        },
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind},
    },
    paths::KerminalPaths,
    services::command_suggestion_service::{CommandSuggestionService, GitRefEntry, GitRefKind},
    state::AppState,
};
use rusqlite::{params, Connection};
use tempfile::{tempdir, TempDir};

#[path = "command_suggestion_service/contract.rs"]
mod contract;
#[path = "command_suggestion_service/diagnostics_cleanup.rs"]
mod diagnostics_cleanup;
#[path = "command_suggestion_service/history_feedback.rs"]
mod history_feedback;
#[path = "command_suggestion_service/remote_cache.rs"]
mod remote_cache;
#[path = "command_suggestion_service/rules.rs"]
mod rules;
#[path = "command_suggestion_service/snippet.rs"]
mod snippet;
#[path = "command_suggestion_service/spec.rs"]
mod spec;
#[path = "command_suggestion_service/telemetry.rs"]
mod telemetry;

fn record(
    state: &AppState,
    command: &str,
    target: CommandHistoryTarget,
    remote_host_id: Option<&str>,
    cwd: Option<&str>,
    session_id: Option<&str>,
) {
    state
        .command_history()
        .record_command(
            state.command_store(),
            CommandHistoryRecordRequest {
                command: command.to_owned(),
                source: CommandHistorySource::User,
                target,
                record: None,
                session_id: session_id.map(ToOwned::to_owned),
                pane_id: Some("pane-1".to_owned()),
                tab_id: None,
                profile_id: None,
                remote_host_id: remote_host_id.map(ToOwned::to_owned),
                cwd: cwd.map(ToOwned::to_owned),
                shell: None,
            },
        )
        .expect("record test command");
}

fn cache_commands(state: &AppState, commands: Vec<String>) {
    cache_commands_with_limit(state, commands, 100);
}

fn cache_commands_with_limit(state: &AppState, commands: Vec<String>, max_entries: usize) {
    state
        .command_suggestions()
        .cache_remote_commands(
            Some(state.command_store()),
            "host-prod".to_owned(),
            commands,
            300,
            max_entries,
        )
        .expect("cache remote commands");
}

fn cache_remote_history(state: &AppState, commands: Vec<String>) {
    state
        .command_suggestions()
        .cache_remote_history(
            Some(state.command_store()),
            "host-prod".to_owned(),
            commands,
            300,
            100,
        )
        .expect("cache remote history commands");
}

fn cache_git_refs(state: &AppState, entries: Vec<GitRefEntry>) {
    state
        .command_suggestions()
        .cache_git_refs(
            Some(state.command_store()),
            "host-prod".to_owned(),
            "/srv/app".to_owned(),
            Some("/srv/app".to_owned()),
            entries,
            60,
            100,
        )
        .expect("cache git refs");
}

fn git_ref(name: &str, kind: GitRefKind) -> GitRefEntry {
    GitRefEntry {
        kind,
        name: name.to_owned(),
    }
}

fn cache_listing(state: &AppState, path: &str, entries: Vec<SftpEntry>) {
    state
        .command_suggestions()
        .cache_remote_path_listing(
            Some(state.command_store()),
            SftpDirectoryListing {
                entries,
                host_id: "host-prod".to_owned(),
                parent_path: Some("/srv".to_owned()),
                path: path.to_owned(),
            },
            30,
            100,
        )
        .expect("cache remote path listing");
}

fn sftp_entry(path: &str, name: &str, kind: SftpEntryKind) -> SftpEntry {
    SftpEntry {
        kind,
        modified: None,
        name: name.to_owned(),
        path: path.to_owned(),
        permissions: None,
        raw: String::new(),
        size: None,
    }
}

fn telemetry_provider(
    summary: &kerminal_lib::models::command_suggestion::CommandSuggestionTelemetrySummary,
    provider: SuggestionProviderKind,
) -> &kerminal_lib::models::command_suggestion::CommandSuggestionProviderTelemetry {
    summary
        .providers
        .iter()
        .find(|telemetry| telemetry.provider == provider)
        .expect("provider telemetry")
}

fn millis_for_days(days: i64) -> i64 {
    days.saturating_mul(24 * 60 * 60 * 1_000)
}

fn unix_time_millis_i64(time: SystemTime) -> i64 {
    i64::try_from(
        time.duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
