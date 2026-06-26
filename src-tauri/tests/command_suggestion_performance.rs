//! 命令建议性能基准式集成测试。
//!
//! 默认忽略，按需手动运行：
//! `cargo test --test command_suggestion_performance -- --ignored --nocapture`
//!
//! @author kongweiguang

use std::{
    path::Path,
    time::{Duration, Instant},
};

use kerminal_lib::{
    models::{
        command_history::{
            CommandHistoryRecordRequest, CommandHistorySource, CommandHistoryTarget,
        },
        command_suggestion::{CommandSuggestionRequest, SuggestionProviderKind},
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind},
    },
    paths::KerminalPaths,
    services::command_suggestion_service::{GitRefEntry, GitRefKind},
    state::AppState,
};
use rusqlite::{params, Connection};
use tempfile::tempdir;

#[test]
#[ignore = "manual performance benchmark"]
fn command_suggestion_mixed_provider_benchmark() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let seed_started = Instant::now();
    for index in 0..10_000 {
        state
            .command_history()
            .record_command(
                state.command_store(),
                CommandHistoryRecordRequest {
                    command: format!("kubectl get pods -n ns-{index}"),
                    cwd: Some("/srv/app".to_owned()),
                    pane_id: Some("pane-1".to_owned()),
                    profile_id: None,
                    record: None,
                    remote_host_id: Some("host-prod".to_owned()),
                    session_id: Some("session-1".to_owned()),
                    shell: Some("bash".to_owned()),
                    source: CommandHistorySource::User,
                    tab_id: None,
                    target: CommandHistoryTarget::Ssh,
                },
            )
            .expect("record history");
    }

    state
        .command_suggestions()
        .cache_remote_commands(
            Some(state.command_store()),
            "host-prod".to_owned(),
            (0..5_000).map(|index| format!("tool-{index}")).collect(),
            300,
            5_000,
        )
        .expect("cache remote commands");

    state
        .command_suggestions()
        .cache_remote_path_listing(
            Some(state.command_store()),
            SftpDirectoryListing {
                entries: (0..1_000)
                    .map(|index| SftpEntry {
                        kind: SftpEntryKind::Directory,
                        modified: None,
                        name: format!("config-{index}"),
                        path: format!("/srv/app/config-{index}"),
                        permissions: None,
                        raw: String::new(),
                        size: None,
                    })
                    .collect(),
                host_id: "host-prod".to_owned(),
                parent_path: Some("/srv".to_owned()),
                path: "/srv/app".to_owned(),
            },
            30,
            1_000,
        )
        .expect("cache remote paths");

    state
        .command_suggestions()
        .cache_git_refs(
            Some(state.command_store()),
            "host-prod".to_owned(),
            "/srv/app".to_owned(),
            Some("/srv/app".to_owned()),
            (0..1_000)
                .map(|index| GitRefEntry {
                    kind: GitRefKind::Branch,
                    name: format!("feature/branch-{index}"),
                })
                .collect(),
            60,
            1_000,
        )
        .expect("cache git refs");
    let seed_elapsed = seed_started.elapsed();

    let history_started = Instant::now();
    let history = list_suggestions(
        &state,
        "kubectl get po",
        Some(vec![
            SuggestionProviderKind::History,
            SuggestionProviderKind::Spec,
        ]),
    );
    let history_elapsed = history_started.elapsed();

    let remote_command_started = Instant::now();
    let remote_command = list_suggestions(
        &state,
        "tool-49",
        Some(vec![SuggestionProviderKind::RemoteCommand]),
    );
    let remote_command_elapsed = remote_command_started.elapsed();

    let remote_path_started = Instant::now();
    let remote_path = list_suggestions(
        &state,
        "cd config-9",
        Some(vec![SuggestionProviderKind::RemotePath]),
    );
    let remote_path_elapsed = remote_path_started.elapsed();

    let git_started = Instant::now();
    let git = list_suggestions(
        &state,
        "git checkout feature/branch-9",
        Some(vec![SuggestionProviderKind::Git]),
    );
    let git_elapsed = git_started.elapsed();

    assert!(!history.is_empty());
    assert!(!remote_command.is_empty());
    assert!(!remote_path.is_empty());
    assert!(!git.is_empty());

    println!(
        "command suggestion benchmark: seed={seed_elapsed:?}, history+spec={history_elapsed:?}, remoteCommand={remote_command_elapsed:?}, remotePath={remote_path_elapsed:?}, git={git_elapsed:?}"
    );
}

#[test]
fn command_suggestion_mixed_provider_latency_gate() {
    const SAMPLES: usize = 5;
    const MEDIAN_BUDGET: Duration = Duration::from_millis(50);
    const MAX_BUDGET: Duration = Duration::from_millis(150);

    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    seed_history_rows(state.command_store().database_file(), 10_000).expect("seed command history");
    seed_remote_provider_caches(&state);

    let scenarios: [(&str, &str, &[SuggestionProviderKind]); 4] = [
        (
            "history+spec",
            "kubectl get pods -n ns-0099",
            &[
                SuggestionProviderKind::History,
                SuggestionProviderKind::Spec,
            ],
        ),
        (
            "remoteCommand",
            "tool-49",
            &[SuggestionProviderKind::RemoteCommand],
        ),
        (
            "remotePath",
            "cd config-9",
            &[SuggestionProviderKind::RemotePath],
        ),
        (
            "git",
            "git checkout feature/branch-9",
            &[SuggestionProviderKind::Git],
        ),
    ];

    for (name, input, providers) in scenarios {
        let warmup = list_suggestions(&state, input, Some(providers.to_vec()));
        assert!(
            !warmup.is_empty(),
            "warmup for {name} should produce candidates"
        );

        let mut samples = Vec::with_capacity(SAMPLES);
        for _ in 0..SAMPLES {
            let started = Instant::now();
            let candidates = list_suggestions(&state, input, Some(providers.to_vec()));
            let elapsed = started.elapsed();
            assert!(
                !candidates.is_empty(),
                "{name} should produce candidates within latency gate"
            );
            samples.push(elapsed);
        }
        samples.sort_unstable();
        let median = samples[SAMPLES / 2];
        let max = samples[SAMPLES - 1];

        assert!(
            median <= MEDIAN_BUDGET,
            "{name} median exceeded {MEDIAN_BUDGET:?}: {median:?}; samples={samples:?}"
        );
        assert!(
            max <= MAX_BUDGET,
            "{name} max exceeded {MAX_BUDGET:?}: {max:?}; samples={samples:?}"
        );
    }
}

#[test]
#[ignore = "manual performance benchmark"]
fn command_suggestion_100k_history_query_benchmark() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let seed_started = Instant::now();
    seed_history_rows(state.command_store().database_file(), 100_000)
        .expect("seed command history");
    let seed_elapsed = seed_started.elapsed();

    let recent = measure_suggestions(&state, "kubectl get pods -n ns-09999");
    let deep = measure_suggestions(&state, "kubectl get pods -n ns-00000");

    assert!(!recent.candidates.is_empty());
    assert!(!deep.candidates.is_empty());
    assert!(
        recent.elapsed.as_millis() < 30,
        "100k recent history query exceeded 30ms budget: {:?}",
        recent.elapsed
    );
    assert!(
        deep.elapsed.as_millis() < 30,
        "100k deep history query exceeded 30ms budget: {:?}",
        deep.elapsed
    );

    println!(
        "command suggestion 100k history benchmark: seed={seed_elapsed:?}, recent={:?}, deep={:?}",
        recent.elapsed, deep.elapsed
    );
}

fn list_suggestions(
    state: &AppState,
    input: &str,
    providers: Option<Vec<SuggestionProviderKind>>,
) -> Vec<kerminal_lib::models::command_suggestion::CommandSuggestionCandidate> {
    state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                cursor: input.chars().count(),
                cwd: Some("/srv/app".to_owned()),
                input: input.to_owned(),
                limit: Some(8),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                providers,
                remote_host_id: Some("host-prod".to_owned()),
                session_id: Some("session-1".to_owned()),
                shell: Some("bash".to_owned()),
                target: CommandHistoryTarget::Ssh,
            },
        )
        .expect("list suggestions")
}

struct MeasuredSuggestions {
    candidates: Vec<kerminal_lib::models::command_suggestion::CommandSuggestionCandidate>,
    elapsed: Duration,
}

fn measure_suggestions(state: &AppState, input: &str) -> MeasuredSuggestions {
    let started = Instant::now();
    let candidates = list_suggestions(state, input, Some(vec![SuggestionProviderKind::History]));
    MeasuredSuggestions {
        candidates,
        elapsed: started.elapsed(),
    }
}

fn seed_remote_provider_caches(state: &AppState) {
    state
        .command_suggestions()
        .cache_remote_commands(
            Some(state.command_store()),
            "host-prod".to_owned(),
            (0..5_000).map(|index| format!("tool-{index}")).collect(),
            300,
            5_000,
        )
        .expect("cache remote commands");

    state
        .command_suggestions()
        .cache_remote_path_listing(
            Some(state.command_store()),
            SftpDirectoryListing {
                entries: (0..1_000)
                    .map(|index| SftpEntry {
                        kind: SftpEntryKind::Directory,
                        modified: None,
                        name: format!("config-{index}"),
                        path: format!("/srv/app/config-{index}"),
                        permissions: None,
                        raw: String::new(),
                        size: None,
                    })
                    .collect(),
                host_id: "host-prod".to_owned(),
                parent_path: Some("/srv".to_owned()),
                path: "/srv/app".to_owned(),
            },
            30,
            1_000,
        )
        .expect("cache remote paths");

    state
        .command_suggestions()
        .cache_git_refs(
            Some(state.command_store()),
            "host-prod".to_owned(),
            "/srv/app".to_owned(),
            Some("/srv/app".to_owned()),
            (0..1_000)
                .map(|index| GitRefEntry {
                    kind: GitRefKind::Branch,
                    name: format!("feature/branch-{index}"),
                })
                .collect(),
            60,
            1_000,
        )
        .expect("cache git refs");
}

fn seed_history_rows(database_file: &Path, count: usize) -> rusqlite::Result<()> {
    let mut conn = Connection::open(database_file)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "
            INSERT INTO command_history (
                id, command, source, target, session_id, pane_id, tab_id,
                profile_id, remote_host_id, cwd, shell
            )
            VALUES (?1, ?2, 'user', 'ssh', 'session-1', 'pane-1', NULL,
                    NULL, 'host-prod', '/srv/app', 'bash')
            ",
        )?;
        for index in 0..count {
            stmt.execute(params![
                format!("perf-history-{index}"),
                format!("kubectl get pods -n ns-{index:06}"),
            ])?;
        }
    }
    tx.commit()
}
