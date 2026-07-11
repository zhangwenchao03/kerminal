use super::*;

#[path = "../../src/services/command_suggestion_service/remote_cache_policy.rs"]
mod remote_cache_policy;
#[path = "../../src/services/command_suggestion_service/remote_refresh.rs"]
mod remote_refresh;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use remote_cache_policy::{RemoteCacheLookup, RemoteCachePolicy};
use remote_refresh::{RemoteRefreshOutcome, RemoteRefreshRuntime};
use tokio::sync::{Notify, Semaphore};
use tokio::time::timeout;

fn refresh_policy(capacity: usize) -> RemoteCachePolicy {
    RemoteCachePolicy::new(
        capacity,
        Duration::from_secs(10),
        Duration::from_secs(60),
        Duration::from_secs(2),
        Duration::from_secs(30),
    )
    .expect("valid remote cache policy")
}

#[tokio::test]
async fn remote_refresh_coalesces_same_key_and_generation() {
    let runtime = Arc::new(
        RemoteRefreshRuntime::<String, String>::new(refresh_policy(8), 4)
            .expect("create refresh runtime"),
    );
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let work_calls = Arc::new(AtomicUsize::new(0));
    let now = std::time::Instant::now();

    let tasks = (0..8)
        .map(|_| {
            let runtime = Arc::clone(&runtime);
            let started = Arc::clone(&started);
            let release = Arc::clone(&release);
            let work_calls = Arc::clone(&work_calls);
            tokio::spawn(async move {
                runtime
                    .refresh("host:commands".to_owned(), 7, now, move |_| async move {
                        work_calls.fetch_add(1, Ordering::SeqCst);
                        started.notify_one();
                        release.notified().await;
                        Ok::<_, &'static str>("git".to_owned())
                    })
                    .await
            })
        })
        .collect::<Vec<_>>();

    timeout(Duration::from_secs(2), started.notified())
        .await
        .expect("leader refresh should start");
    assert_eq!(work_calls.load(Ordering::SeqCst), 1);
    release.notify_waiters();

    let mut refreshed = 0;
    let mut coalesced = 0;
    for task in tasks {
        match task.await.expect("join coalesced refresh") {
            RemoteRefreshOutcome::Refreshed(value) => {
                refreshed += 1;
                assert_eq!(value.as_str(), "git");
            }
            RemoteRefreshOutcome::Coalesced(value) => {
                coalesced += 1;
                assert_eq!(value.as_str(), "git");
            }
            outcome => panic!("unexpected coalesced outcome: {outcome:?}"),
        }
    }
    assert_eq!(refreshed, 1);
    assert_eq!(coalesced, 7);
}

#[tokio::test]
async fn expired_cache_remains_visible_during_stale_while_refresh_window() {
    let runtime = RemoteRefreshRuntime::<String, String>::new(refresh_policy(4), 1)
        .expect("create refresh runtime");
    let started_at = std::time::Instant::now();
    let refreshed = runtime
        .refresh("host:path".to_owned(), 1, started_at, |_| async {
            Ok::<_, &'static str>("/srv/app".to_owned())
        })
        .await;
    assert!(matches!(refreshed, RemoteRefreshOutcome::Refreshed(_)));

    match runtime.cached(
        &"host:path".to_owned(),
        started_at + Duration::from_secs(11),
    ) {
        RemoteCacheLookup::Stale(value) => assert_eq!(value.as_str(), "/srv/app"),
        lookup => panic!("expired value should stay available as stale: {lookup:?}"),
    }
}

#[tokio::test]
async fn failed_refresh_keeps_last_known_good_and_enforces_backoff() {
    let short_policy = RemoteCachePolicy::new(
        4,
        Duration::from_millis(1),
        Duration::from_secs(60),
        Duration::from_secs(2),
        Duration::from_secs(30),
    )
    .expect("valid short remote cache policy");
    let runtime = RemoteRefreshRuntime::<String, String>::new(short_policy, 1)
        .expect("create refresh runtime");
    let key = "host:history".to_owned();
    let started_at = std::time::Instant::now();
    runtime
        .refresh(key.clone(), 1, started_at, |_| async {
            Ok::<_, &'static str>("deploy --dry-run".to_owned())
        })
        .await;

    timeout(Duration::from_secs(1), async {
        loop {
            if matches!(
                runtime.cached(&key, std::time::Instant::now()),
                RemoteCacheLookup::Stale(_)
            ) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("fresh value should enter stale window");

    let failed = runtime
        .refresh(key.clone(), 2, std::time::Instant::now(), |_| async {
            Err::<String, _>("offline")
        })
        .await;
    match failed {
        RemoteRefreshOutcome::Failed {
            error,
            stale: Some(stale),
            retry_after,
        } => {
            assert_eq!(error.as_ref(), "offline");
            assert_eq!(stale.as_str(), "deploy --dry-run");
            assert_eq!(retry_after, Duration::from_secs(2));
        }
        outcome => panic!("failure must preserve LKG: {outcome:?}"),
    }

    let blocked_work_calls = Arc::new(AtomicUsize::new(0));
    let calls = Arc::clone(&blocked_work_calls);
    let blocked = runtime
        .refresh(key, 3, std::time::Instant::now(), move |_| async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok::<_, &'static str>("must-not-run".to_owned())
        })
        .await;
    assert!(matches!(
        blocked,
        RemoteRefreshOutcome::Backoff { stale: Some(_), .. }
    ));
    assert_eq!(blocked_work_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn remote_cache_evicts_least_recently_used_key_at_capacity() {
    let runtime = RemoteRefreshRuntime::<String, String>::new(refresh_policy(2), 1)
        .expect("create refresh runtime");
    let now = std::time::Instant::now();
    for (generation, key) in [(1, "a"), (2, "b")] {
        runtime
            .refresh(key.to_owned(), generation, now, |_| async move {
                Ok::<_, &'static str>(key.to_owned())
            })
            .await;
    }
    assert!(matches!(
        runtime.cached(&"a".to_owned(), now),
        RemoteCacheLookup::Fresh(_)
    ));
    runtime
        .refresh("c".to_owned(), 3, now, |_| async {
            Ok::<_, &'static str>("c".to_owned())
        })
        .await;

    assert_eq!(runtime.cache_len(), 2);
    assert!(matches!(
        runtime.cached(&"a".to_owned(), now),
        RemoteCacheLookup::Fresh(_)
    ));
    assert!(matches!(
        runtime.cached(&"b".to_owned(), now),
        RemoteCacheLookup::Miss
    ));
    assert!(matches!(
        runtime.cached(&"c".to_owned(), now),
        RemoteCacheLookup::Fresh(_)
    ));
}

#[tokio::test]
async fn cancelled_or_old_generation_cannot_pollute_newer_cache_value() {
    let runtime = Arc::new(
        RemoteRefreshRuntime::<String, String>::new(refresh_policy(4), 2)
            .expect("create refresh runtime"),
    );
    let old_started = Arc::new(Notify::new());
    let release_old = Arc::new(Notify::new());
    let key = "host:git:/srv/app".to_owned();
    let now = std::time::Instant::now();

    let old_task = {
        let runtime = Arc::clone(&runtime);
        let old_started = Arc::clone(&old_started);
        let release_old = Arc::clone(&release_old);
        let key = key.clone();
        tokio::spawn(async move {
            runtime
                .refresh(key, 10, now, move |_| async move {
                    old_started.notify_one();
                    release_old.notified().await;
                    Ok::<_, &'static str>("old-ref".to_owned())
                })
                .await
        })
    };
    timeout(Duration::from_secs(2), old_started.notified())
        .await
        .expect("old generation should start");
    assert!(runtime.cancel(&key, 10, std::time::Instant::now()));

    let newer = runtime
        .refresh(key.clone(), 11, now, |_| async {
            Ok::<_, &'static str>("new-ref".to_owned())
        })
        .await;
    assert!(matches!(newer, RemoteRefreshOutcome::Refreshed(_)));
    release_old.notify_waiters();
    assert!(matches!(
        old_task.await.expect("join old generation"),
        RemoteRefreshOutcome::Cancelled { .. } | RemoteRefreshOutcome::Superseded { .. }
    ));

    match runtime.cached(&key, std::time::Instant::now()) {
        RemoteCacheLookup::Fresh(value) => assert_eq!(value.as_str(), "new-ref"),
        lookup => panic!("new generation value must remain authoritative: {lookup:?}"),
    }
}

#[tokio::test]
async fn remote_refresh_runtime_enforces_global_concurrency_limit() {
    let runtime = Arc::new(
        RemoteRefreshRuntime::<String, String>::new(refresh_policy(8), 2)
            .expect("create refresh runtime"),
    );
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let started = Arc::new(Notify::new());
    let release = Arc::new(Semaphore::new(0));
    let now = std::time::Instant::now();
    let tasks = (0..5)
        .map(|index| {
            let runtime = Arc::clone(&runtime);
            let active = Arc::clone(&active);
            let peak = Arc::clone(&peak);
            let started = Arc::clone(&started);
            let release = Arc::clone(&release);
            tokio::spawn(async move {
                runtime
                    .refresh(format!("key-{index}"), 1, now, move |_| async move {
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(current, Ordering::SeqCst);
                        started.notify_one();
                        let permit = release.acquire().await.expect("release semaphore open");
                        permit.forget();
                        active.fetch_sub(1, Ordering::SeqCst);
                        Ok::<_, &'static str>(format!("value-{index}"))
                    })
                    .await
            })
        })
        .collect::<Vec<_>>();

    timeout(Duration::from_secs(2), async {
        while active.load(Ordering::SeqCst) < 2 {
            started.notified().await;
        }
    })
    .await
    .expect("two refreshes should acquire permits");
    assert_eq!(peak.load(Ordering::SeqCst), 2);
    release.add_permits(5);
    for task in tasks {
        assert!(matches!(
            task.await.expect("join limited refresh"),
            RemoteRefreshOutcome::Refreshed(_)
        ));
    }
    assert_eq!(peak.load(Ordering::SeqCst), 2);
}

#[test]
fn remote_path_suggestions_use_cached_sftp_listing() {
    let (_home, state) = test_state();
    cache_listing(
        &state,
        "/srv/app",
        vec![
            sftp_entry("/srv/app/config", "config", SftpEntryKind::Directory),
            sftp_entry("/srv/app/app.log", "app.log", SftpEntryKind::File),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "cd co".to_owned(),
                cursor: "cd co".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: Some("session-1".to_owned()),
                pane_id: Some("pane-1".to_owned()),
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemotePath]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::RemotePath);
    assert_eq!(suggestions[0].replacement_text, "cd config/");
    assert_eq!(suggestions[0].suffix, "nfig/");
    assert_eq!(suggestions[0].replacement_range.start, 3);
    assert_eq!(suggestions[0].replacement_range.end, 5);
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("entryKind"))
            .map(String::as_str),
        Some("directory")
    );
}

#[test]
fn remote_path_suggestions_escape_unquoted_names_with_spaces() {
    let (_home, state) = test_state();
    cache_listing(
        &state,
        "/srv/app",
        vec![sftp_entry(
            "/srv/app/My Folder",
            "My Folder",
            SftpEntryKind::Directory,
        )],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "cd My".to_owned(),
                cursor: "cd My".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemotePath]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].replacement_text, "cd My\\ Folder/");
    assert_eq!(suggestions[0].suffix, "\\ Folder/");
}

#[test]
fn remote_command_suggestions_use_cached_path_commands() {
    let (_home, state) = test_state();
    cache_commands(
        &state,
        vec![
            "git".to_owned(),
            "grep".to_owned(),
            "bad name".to_owned(),
            "/bin/sh".to_owned(),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "gi".to_owned(),
                cursor: "gi".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(
        suggestions[0].provider,
        SuggestionProviderKind::RemoteCommand
    );
    assert_eq!(suggestions[0].replacement_text, "git");
    assert_eq!(suggestions[0].suffix, "t");
}

#[test]
fn remote_command_suggestions_include_posix_builtins_without_path_commands() {
    let (_home, state) = test_state();
    cache_commands(&state, Vec::new());

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "c".to_owned(),
                cursor: "c".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("sh".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(10),
            },
        )
        .expect("list builtin suggestions");

    let cd = suggestions
        .iter()
        .find(|suggestion| suggestion.replacement_text == "cd")
        .expect("cd builtin suggestion");
    assert_eq!(cd.provider, SuggestionProviderKind::RemoteCommand);
    assert_eq!(cd.suffix, "d");
    assert_eq!(
        cd.metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .map(String::as_str),
        Some("posixBuiltin")
    );
    assert_eq!(
        cd.description.as_deref(),
        Some("远端 shell 内建命令，来自 POSIX sh 默认集合")
    );
}

#[test]
fn remote_command_builtins_survive_noisy_capped_path_cache() {
    let (_home, state) = test_state();
    let noisy_path_commands = (0..240)
        .map(|index| format!("c{index:04}"))
        .chain((0..240).map(|index| format!("aaa{index:04}")))
        .collect::<Vec<_>>();
    cache_commands_with_limit(&state, noisy_path_commands, 40);

    let cd_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "c".to_owned(),
                cursor: "c".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("sh".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(8),
            },
        )
        .expect("list capped cd builtin suggestions");
    assert!(
        cd_suggestions
            .iter()
            .any(|suggestion| suggestion.replacement_text == "cd"
                && suggestion
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("source"))
                    .is_some_and(|source| source == "posixBuiltin")),
        "cd builtin should outrank noisy PATH commands: {cd_suggestions:?}"
    );

    let umask_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "umas".to_owned(),
                cursor: "umas".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("sh".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(8),
            },
        )
        .expect("list capped umask builtin suggestions");
    assert!(
        umask_suggestions
            .iter()
            .any(|suggestion| suggestion.replacement_text == "umask"
                && suggestion
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("source"))
                    .is_some_and(|source| source == "posixBuiltin")),
        "umask builtin should survive remote command cache cap: {umask_suggestions:?}"
    );
}

#[test]
fn remote_history_suggestions_restore_from_persistent_cache() {
    let (_home, state) = test_state();
    cache_remote_history(
        &state,
        vec![
            "kubectl get pods -n prod".to_owned(),
            "kubectl rollout status deployment/api -n prod".to_owned(),
            "export API_TOKEN=secret-value".to_owned(),
        ],
    );

    let cache_only_suggestions = CommandSuggestionService::new();
    let suggestions = cache_only_suggestions
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "kubectl ".to_owned(),
                cursor: "kubectl ".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::History]),
                limit: Some(5),
            },
        )
        .expect("list remote history suggestions from persistent cache");

    assert_eq!(suggestions.len(), 2);
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::History);
    assert_eq!(suggestions[0].replacement_text, "kubectl get pods -n prod");
    assert_eq!(suggestions[0].suffix, "get pods -n prod");
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("source"))
            .map(String::as_str),
        Some("remoteShellHistory")
    );
    assert!(!suggestions
        .iter()
        .any(|suggestion| suggestion.replacement_text.contains("API_TOKEN")));
}

#[test]
fn remote_command_suggestions_do_not_apply_to_argument_position() {
    let (_home, state) = test_state();
    cache_commands(&state, vec!["checkout".to_owned()]);

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git ch".to_owned(),
                cursor: "git ch".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert!(suggestions.is_empty());
}

#[test]
fn git_suggestions_use_cached_refs_for_checkout() {
    let (_home, state) = test_state();
    cache_git_refs(
        &state,
        vec![
            git_ref("main", GitRefKind::Branch),
            git_ref("feature/current", GitRefKind::Branch),
            git_ref("origin/main", GitRefKind::RemoteBranch),
            git_ref("v1.0.0", GitRefKind::Tag),
            git_ref("origin", GitRefKind::Remote),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git checkout fe".to_owned(),
                cursor: "git checkout fe".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].provider, SuggestionProviderKind::Git);
    assert_eq!(
        suggestions[0].replacement_text,
        "git checkout feature/current"
    );
    assert_eq!(suggestions[0].suffix, "ature/current");
    assert_eq!(suggestions[0].replacement_range.start, 13);
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("kind"))
            .map(String::as_str),
        Some("branch")
    );
}

#[test]
fn git_suggestions_use_remote_position_for_pull() {
    let (_home, state) = test_state();
    cache_git_refs(
        &state,
        vec![
            git_ref("origin", GitRefKind::Remote),
            git_ref("main", GitRefKind::Branch),
            git_ref("origin/main", GitRefKind::RemoteBranch),
        ],
    );

    let suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git pull or".to_owned(),
                cursor: "git pull or".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list suggestions");

    assert_eq!(suggestions.len(), 1);
    assert_eq!(suggestions[0].replacement_text, "git pull origin");
    assert_eq!(suggestions[0].suffix, "igin");
    assert_eq!(
        suggestions[0]
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("kind"))
            .map(String::as_str),
        Some("remote")
    );
}

#[test]
fn provider_cache_survives_app_state_reopen() {
    let (home, state) = test_state();
    cache_commands(&state, vec!["git".to_owned(), "grep".to_owned()]);
    cache_listing(
        &state,
        "/srv/app",
        vec![sftp_entry(
            "/srv/app/config",
            "config",
            SftpEntryKind::Directory,
        )],
    );
    cache_git_refs(&state, vec![git_ref("feature/current", GitRefKind::Branch)]);
    drop(state);

    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("reopen app state");

    let remote_command_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "gi".to_owned(),
                cursor: "gi".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemoteCommand]),
                limit: Some(5),
            },
        )
        .expect("list remote command suggestions after reopen");
    assert_eq!(remote_command_suggestions[0].replacement_text, "git");

    let remote_path_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "cd co".to_owned(),
                cursor: "cd co".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::RemotePath]),
                limit: Some(5),
            },
        )
        .expect("list remote path suggestions after reopen");
    assert_eq!(remote_path_suggestions[0].replacement_text, "cd config/");

    let git_suggestions = state
        .command_suggestions()
        .list_suggestions(
            state.command_store(),
            state.command_history(),
            CommandSuggestionRequest {
                context_key: None,
                generation: None,
                mode: Default::default(),
                input: "git checkout fe".to_owned(),
                cursor: "git checkout fe".chars().count(),
                target: CommandHistoryTarget::Ssh,
                session_id: None,
                pane_id: None,
                profile_id: None,
                remote_host_id: Some("host-prod".to_owned()),
                cwd: Some("/srv/app".to_owned()),
                shell: Some("bash".to_owned()),
                providers: Some(vec![SuggestionProviderKind::Git]),
                limit: Some(5),
            },
        )
        .expect("list git suggestions after reopen");
    assert_eq!(
        git_suggestions[0].replacement_text,
        "git checkout feature/current"
    );
}
