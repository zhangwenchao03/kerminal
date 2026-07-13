//! External SSH 创建任务 registry 的状态与脱敏快照测试。
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::ExternalLaunchTaskRegistry;

#[test]
fn task_registry_tracks_queue_inflight_complete_and_close_cancel() {
    let registry = ExternalLaunchTaskRegistry::new();
    let token = registry.register("launch-task-1").expect("register task");
    assert_eq!(
        registry.snapshot().expect("queued snapshot").queued_count,
        1
    );

    assert!(registry
        .mark_in_flight("launch-task-1")
        .expect("mark inflight"));
    assert_eq!(
        registry
            .snapshot()
            .expect("inflight snapshot")
            .in_flight_count,
        1
    );
    assert!(registry
        .complete("launch-task-1", "terminal-session-1")
        .expect("complete"));

    assert_eq!(
        registry
            .connected_session_id("launch-task-1")
            .expect("connected session lookup")
            .as_deref(),
        Some("terminal-session-1")
    );
    assert!(registry
        .release_connected_session("launch-task-1", "terminal-session-1")
        .expect("release session for reconnect"));
    let reconnect_token = registry
        .register("launch-task-1")
        .expect("same external launch can reconnect after old session closes");
    assert!(registry
        .mark_in_flight("launch-task-1")
        .expect("mark reconnect inflight"));
    assert!(registry
        .complete("launch-task-1", "terminal-session-2")
        .expect("complete reconnect"));

    let cancellation = registry.cancel("launch-task-1").expect("cancel connected");
    assert_eq!(
        cancellation.session_id.as_deref(),
        Some("terminal-session-2")
    );
    assert!(token.is_cancelled());
    assert!(reconnect_token.is_cancelled());
    let snapshot = registry.snapshot().expect("final snapshot");
    assert_eq!(snapshot.connected_count, 0);
    assert_eq!(snapshot.cancelled_count, 1);
    assert_eq!(snapshot.completed_count, 2);
}

#[test]
fn task_registry_cancel_and_deadline_prevent_late_completion() {
    let registry = ExternalLaunchTaskRegistry::new();
    let cancelled = registry.register("launch-cancel").expect("register cancel");
    registry.cancel("launch-cancel").expect("cancel queued");
    assert!(cancelled.is_cancelled());
    assert!(registry.register("launch-cancel").is_err());
    assert!(!registry
        .complete("launch-cancel", "late-session")
        .expect("late completion rejected"));
    assert!(registry
        .finish_failed("launch-cancel")
        .expect("late worker cleanup removes cancelling tombstone"));
    assert!(registry.register("launch-cancel").is_ok());
    registry
        .finish_failed("launch-cancel")
        .expect("cleanup retried generation");

    let deadline = registry
        .register("launch-deadline")
        .expect("register deadline");
    registry
        .mark_deadline("launch-deadline")
        .expect("mark deadline");
    assert!(deadline.is_cancelled());
    assert!(registry.register("launch-deadline").is_err());
    assert!(!registry
        .complete("launch-deadline", "late-deadline-session")
        .expect("deadline completion rejected"));
    assert!(registry
        .finish_failed("launch-deadline")
        .expect("deadline cleanup removes tombstone"));

    let snapshot = registry.snapshot().expect("snapshot");
    assert_eq!(snapshot.cancelled_count, 1);
    assert_eq!(snapshot.deadline_count, 1);
    assert_eq!(snapshot.queued_count, 0);
    assert_eq!(snapshot.in_flight_count, 0);
    assert!(!format!("{snapshot:?}").contains("launch-cancel"));
    assert!(!format!("{snapshot:?}").contains("late-session"));
}

#[test]
fn releasing_connected_session_cancels_lifecycle_watcher_token() {
    let registry = ExternalLaunchTaskRegistry::new();
    let token = registry.register("launch-release").expect("register task");
    assert!(registry
        .mark_in_flight("launch-release")
        .expect("mark in flight"));
    assert!(registry
        .complete("launch-release", "session-release")
        .expect("complete task"));

    assert!(registry
        .release_connected_session("launch-release", "session-release")
        .expect("release connected session"));
    assert!(token.is_cancelled());
    assert_eq!(
        registry
            .connected_session_id("launch-release")
            .expect("read connected task"),
        None
    );
}

#[test]
fn task_registry_failed_queue_acquire_does_not_leave_phantom_task() {
    let registry = ExternalLaunchTaskRegistry::new();
    registry
        .register("queue-timeout")
        .expect("register queued task");
    assert!(registry
        .finish_failed("queue-timeout")
        .expect("remove failed queue task"));

    let snapshot = registry.snapshot().expect("snapshot after queue failure");
    assert_eq!(snapshot.queued_count, 0);
    assert_eq!(snapshot.in_flight_count, 0);
    assert_eq!(snapshot.cancelled_count, 0);
    assert_eq!(snapshot.deadline_count, 0);
    assert!(!registry
        .finish_failed("queue-timeout")
        .expect("duplicate cleanup is idempotent"));
}
