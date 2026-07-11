//! 命令建议性能基线与延迟门禁。
//!
//! 默认延迟门禁：
//! `cargo test --test command_suggestion_performance command_suggestion_mixed_provider_latency_gate -- --exact --nocapture`
//!
//! 完整手工基线：
//! `cargo test --test command_suggestion_performance -- --ignored --nocapture`
//!
//! @author kongweiguang

use std::{
    path::Path,
    time::{Duration, Instant},
};

use kerminal_lib::{
    models::{
        command_history::CommandHistoryTarget,
        command_suggestion::{
            CommandSuggestionCandidate, CommandSuggestionRequest, SuggestionProviderKind,
            SuggestionQueryMode,
        },
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind},
    },
    paths::KerminalPaths,
    services::command_suggestion_service::{GitRefEntry, GitRefKind},
    state::AppState,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use tempfile::tempdir;

const HISTORY_10K: usize = 10_000;
const HISTORY_100K: usize = 100_000;
const REMOTE_COMMAND_COUNT: usize = 5_000;
const REMOTE_PATH_COUNT: usize = 1_000;
const GIT_REF_COUNT: usize = 1_000;
const GATE_WARM_SAMPLES: usize = 20;
const MANUAL_WARM_SAMPLES: usize = 50;

#[derive(Clone, Copy)]
struct LatencyBudget {
    p95: Duration,
    max: Duration,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkReport {
    schema_version: u8,
    benchmark: &'static str,
    environment: BenchmarkEnvironment,
    data_scale: DataScale,
    seed_duration_ms: f64,
    sample_count: SampleCount,
    scenarios: Vec<ScenarioReport>,
    thresholds: ThresholdReport,
    pass: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkEnvironment {
    architecture: &'static str,
    crate_version: &'static str,
    operating_system: &'static str,
    rust_profile: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataScale {
    history_rows: usize,
    remote_commands: usize,
    remote_paths: usize,
    git_refs: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleCount {
    cold_per_scenario: usize,
    warm_per_scenario: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThresholdReport {
    warm_p95_ms: f64,
    warm_max_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioReport {
    name: &'static str,
    providers: Vec<&'static str>,
    candidate_count: usize,
    cold: LatencySummary,
    warm: LatencySummary,
    pass: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LatencySummary {
    sample_count: usize,
    p50_ms: f64,
    p95_ms: f64,
    p99_ms: f64,
    max_ms: f64,
}

struct Scenario {
    name: &'static str,
    input: &'static str,
    mode: SuggestionQueryMode,
    providers: Vec<SuggestionProviderKind>,
    provider_names: Vec<&'static str>,
}

#[test]
#[ignore = "manual performance benchmark"]
fn command_suggestion_mixed_provider_benchmark() {
    let report = run_provider_benchmark(
        "command-suggestion-providers-10k",
        HISTORY_10K,
        MANUAL_WARM_SAMPLES,
        LatencyBudget {
            p95: Duration::from_millis(35),
            max: Duration::from_millis(75),
        },
        provider_scenarios(),
    );
    print_and_assert_report(&report);
}

#[test]
fn command_suggestion_mixed_provider_latency_gate() {
    let report = run_provider_benchmark(
        "command-suggestion-latency-gate-10k",
        HISTORY_10K,
        GATE_WARM_SAMPLES,
        LatencyBudget {
            p95: Duration::from_millis(50),
            max: Duration::from_millis(150),
        },
        provider_scenarios(),
    );
    print_and_assert_report(&report);
}

#[test]
#[ignore = "manual performance benchmark"]
fn command_suggestion_100k_history_query_benchmark() {
    let report = run_provider_benchmark(
        "command-suggestion-history-100k",
        HISTORY_100K,
        MANUAL_WARM_SAMPLES,
        LatencyBudget {
            p95: Duration::from_millis(20),
            max: Duration::from_millis(30),
        },
        history_100k_scenarios(),
    );
    print_and_assert_report(&report);
}

fn run_provider_benchmark(
    benchmark: &'static str,
    history_rows: usize,
    warm_samples: usize,
    budget: LatencyBudget,
    scenarios: Vec<Scenario>,
) -> BenchmarkReport {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let seed_started = Instant::now();
    seed_history_rows(state.command_store().database_file(), history_rows)
        .expect("seed command history");
    seed_remote_provider_caches(&state);
    let seed_duration = seed_started.elapsed();

    let scenario_reports = scenarios
        .into_iter()
        .map(|scenario| measure_scenario(&state, scenario, warm_samples, budget))
        .collect::<Vec<_>>();
    let pass = scenario_reports.iter().all(|scenario| scenario.pass);

    BenchmarkReport {
        schema_version: 1,
        benchmark,
        environment: BenchmarkEnvironment {
            architecture: std::env::consts::ARCH,
            crate_version: env!("CARGO_PKG_VERSION"),
            operating_system: std::env::consts::OS,
            rust_profile: option_env!("PROFILE").unwrap_or("unknown"),
        },
        data_scale: DataScale {
            history_rows,
            remote_commands: REMOTE_COMMAND_COUNT,
            remote_paths: REMOTE_PATH_COUNT,
            git_refs: GIT_REF_COUNT,
        },
        seed_duration_ms: duration_ms(seed_duration),
        sample_count: SampleCount {
            cold_per_scenario: 1,
            warm_per_scenario: warm_samples,
        },
        scenarios: scenario_reports,
        thresholds: ThresholdReport {
            warm_p95_ms: duration_ms(budget.p95),
            warm_max_ms: duration_ms(budget.max),
        },
        pass,
    }
}

fn measure_scenario(
    state: &AppState,
    scenario: Scenario,
    warm_sample_count: usize,
    budget: LatencyBudget,
) -> ScenarioReport {
    let cold_started = Instant::now();
    let cold_candidates = list_suggestions(
        state,
        scenario.input,
        scenario.mode,
        scenario.providers.clone(),
    );
    let cold_elapsed = cold_started.elapsed();
    assert!(
        !cold_candidates.is_empty(),
        "{} cold query should produce candidates",
        scenario.name
    );

    let mut warm_durations = Vec::with_capacity(warm_sample_count);
    let mut candidate_count = cold_candidates.len();
    for _ in 0..warm_sample_count {
        let started = Instant::now();
        let candidates = list_suggestions(
            state,
            scenario.input,
            scenario.mode,
            scenario.providers.clone(),
        );
        warm_durations.push(started.elapsed());
        assert!(
            !candidates.is_empty(),
            "{} warm query should produce candidates",
            scenario.name
        );
        candidate_count = candidate_count.max(candidates.len());
    }

    let cold = summarize_durations(&[cold_elapsed]);
    let warm = summarize_durations(&warm_durations);
    let pass = warm.p95_ms <= duration_ms(budget.p95) && warm.max_ms <= duration_ms(budget.max);

    ScenarioReport {
        name: scenario.name,
        providers: scenario.provider_names,
        candidate_count,
        cold,
        warm,
        pass,
    }
}

fn provider_scenarios() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "history-spec",
            input: "kubectl get pods -n ns-0099",
            mode: SuggestionQueryMode::Inline,
            providers: vec![
                SuggestionProviderKind::History,
                SuggestionProviderKind::Spec,
            ],
            provider_names: vec!["history", "spec"],
        },
        Scenario {
            name: "remote-command",
            input: "tool-49",
            mode: SuggestionQueryMode::Inline,
            providers: vec![SuggestionProviderKind::RemoteCommand],
            provider_names: vec!["remoteCommand"],
        },
        Scenario {
            name: "remote-path",
            input: "cd config-9",
            mode: SuggestionQueryMode::Inline,
            providers: vec![SuggestionProviderKind::RemotePath],
            provider_names: vec!["remotePath"],
        },
        Scenario {
            name: "git-ref",
            input: "git checkout feature/branch-9",
            mode: SuggestionQueryMode::Inline,
            providers: vec![SuggestionProviderKind::Git],
            provider_names: vec!["git"],
        },
        Scenario {
            name: "all-providers",
            input: "tool-49",
            mode: SuggestionQueryMode::Inline,
            providers: vec![
                SuggestionProviderKind::History,
                SuggestionProviderKind::Spec,
                SuggestionProviderKind::RemoteCommand,
                SuggestionProviderKind::RemotePath,
                SuggestionProviderKind::Git,
            ],
            provider_names: vec!["history", "spec", "remoteCommand", "remotePath", "git"],
        },
    ]
}

fn history_100k_scenarios() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "history-recent",
            input: "kubectl get pods -n ns-09999",
            mode: SuggestionQueryMode::Inline,
            providers: vec![SuggestionProviderKind::History],
            provider_names: vec!["history"],
        },
        Scenario {
            name: "history-deep",
            input: "kubectl get pods -n ns-00000",
            mode: SuggestionQueryMode::Inline,
            providers: vec![SuggestionProviderKind::History],
            provider_names: vec!["history"],
        },
        Scenario {
            name: "history-menu-word",
            input: "ns-09999",
            mode: SuggestionQueryMode::Menu,
            providers: vec![SuggestionProviderKind::History],
            provider_names: vec!["history"],
        },
    ]
}

fn list_suggestions(
    state: &AppState,
    input: &str,
    mode: SuggestionQueryMode,
    providers: Vec<SuggestionProviderKind>,
) -> Vec<CommandSuggestionCandidate> {
    state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode,
                cursor: input.chars().count(),
                cwd: Some("/srv/app".to_owned()),
                input: input.to_owned(),
                limit: Some(8),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                providers: Some(providers),
                remote_host_id: Some("host-prod".to_owned()),
                session_id: Some("session-1".to_owned()),
                shell: Some("bash".to_owned()),
                target: CommandHistoryTarget::Ssh,
            },
        )
        .expect("list suggestions")
}

fn summarize_durations(samples: &[Duration]) -> LatencySummary {
    assert!(!samples.is_empty(), "latency samples should not be empty");
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    LatencySummary {
        sample_count: sorted.len(),
        p50_ms: duration_ms(percentile(&sorted, 50)),
        p95_ms: duration_ms(percentile(&sorted, 95)),
        p99_ms: duration_ms(percentile(&sorted, 99)),
        max_ms: duration_ms(*sorted.last().expect("non-empty latency samples")),
    }
}

fn percentile(sorted: &[Duration], percentile: usize) -> Duration {
    let index = ((sorted.len() * percentile).div_ceil(100)).saturating_sub(1);
    sorted[index.min(sorted.len() - 1)]
}

fn duration_ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1_000_000.0).round() / 1_000.0
}

fn print_and_assert_report(report: &BenchmarkReport) {
    let json = serde_json::to_string_pretty(report).expect("serialize benchmark report");
    assert!(
        !json.contains("kubectl get")
            && !json.contains("tool-49")
            && !json.contains("feature/branch-9"),
        "benchmark report must not contain raw command input"
    );
    println!("{json}");
    assert!(report.pass, "benchmark thresholds exceeded");
}

fn seed_remote_provider_caches(state: &AppState) {
    state
        .command_suggestions()
        .cache_remote_commands(
            Some(state.command_store()),
            "host-prod".to_owned(),
            (0..REMOTE_COMMAND_COUNT)
                .map(|index| format!("tool-{index}"))
                .collect(),
            300,
            REMOTE_COMMAND_COUNT,
        )
        .expect("cache remote commands");

    state
        .command_suggestions()
        .cache_remote_path_listing(
            Some(state.command_store()),
            SftpDirectoryListing {
                entries: (0..REMOTE_PATH_COUNT)
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
            REMOTE_PATH_COUNT,
        )
        .expect("cache remote paths");

    state
        .command_suggestions()
        .cache_git_refs(
            Some(state.command_store()),
            "host-prod".to_owned(),
            "/srv/app".to_owned(),
            Some("/srv/app".to_owned()),
            (0..GIT_REF_COUNT)
                .map(|index| GitRefEntry {
                    kind: GitRefKind::Branch,
                    name: format!("feature/branch-{index}"),
                })
                .collect(),
            60,
            GIT_REF_COUNT,
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
