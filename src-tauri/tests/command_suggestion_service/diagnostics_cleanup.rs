use super::*;

#[test]
fn cleanup_diagnostics_prunes_retained_data_and_resets_persisted_telemetry() {
    let (_home, state) = test_state();
    let now = unix_time_millis_i64(SystemTime::now());
    let old_audit = now - millis_for_days(40);
    let old_feedback = now - millis_for_days(400);
    let recent_audit = now - millis_for_days(2);
    let fresh_cache_expires_at = now + millis_for_days(1);
    let expired_cache_expires_at = now - 1_000;

    {
        let conn = Connection::open(state.storage().database_file()).expect("open test db");
        conn.execute(
            "
            INSERT INTO command_suggestion_audit_events (
                id, event_kind, provider, target, decision, reason,
                remote_host_id, cwd, path, pane_id, session_id,
                metadata_json, created_at_unix_ms, created_at
            )
            VALUES
                ('audit-old', 'remoteProbeSchedule', 'remoteCommand', 'ssh', 'skipped',
                 'remote-probe-disabled', 'host-prod', '/srv/app', NULL, 'pane-1',
                 'session-1', '{}', ?1, datetime('now')),
                ('audit-new', 'remoteProbeSchedule', 'remoteCommand', 'ssh', 'skipped',
                 'remote-probe-disabled', 'host-prod', '/srv/app', NULL, 'pane-1',
                 'session-1', '{}', ?2, datetime('now'))
            ",
            params![old_audit, recent_audit],
        )
        .expect("seed audit events");
        conn.execute(
            "
            INSERT INTO command_suggestion_feedback (
                id, action, provider, target, replacement_text, input,
                source_id, session_id, pane_id, profile_id, remote_host_id,
                cwd, shell, created_at_unix_ms, created_at
            )
            VALUES (
                'feedback-old', 'dismissed', 'history', 'ssh', 'git status',
                'git st', NULL, 'session-1', 'pane-1', NULL, 'host-prod',
                '/srv/app', 'bash', ?1, datetime('now')
            )
            ",
            params![old_feedback],
        )
        .expect("seed feedback");
        conn.execute(
            "
            INSERT INTO command_suggestion_provider_cache (
                provider, host_id, scope_key, repo_root, payload_json,
                cached_at_unix_ms, expires_at_unix_ms, ttl_seconds, updated_at
            )
            VALUES
                ('remoteCommand', 'host-prod', 'expired', NULL, '{}', ?1, ?2, 1,
                 datetime('now')),
                ('remoteCommand', 'host-prod', 'fresh', NULL, '{}', ?1, ?3, 86400,
                 datetime('now'))
            ",
            params![now, expired_cache_expires_at, fresh_cache_expires_at],
        )
        .expect("seed provider cache");
        conn.execute(
            "
            INSERT INTO command_suggestion_telemetry (
                provider, query_count, candidate_count, total_elapsed_ms,
                cache_hit_count, cache_miss_count, refresh_success_count,
                refresh_failure_count, feedback_accepted_count,
                feedback_dismissed_count, feedback_skipped_count,
                first_event_unix_ms, last_event_unix_ms, last_error, updated_at
            )
            VALUES ('history', 10, 12, 30, 1, 2, 0, 0, 1, 2, 0, ?1, ?1, NULL,
                    datetime('now'))
            ",
            params![now],
        )
        .expect("seed telemetry");
    }

    let result = state
        .command_suggestions()
        .cleanup_diagnostics(
            state.storage(),
            CommandSuggestionDiagnosticsCleanupRequest {
                audit_retention_days: Some(30),
                feedback_retention_days: Some(365),
                prune_audit_events: Some(true),
                prune_expired_provider_cache: true,
                prune_feedback: Some(true),
                reset_persisted_telemetry: true,
            },
        )
        .expect("cleanup diagnostics");

    assert_eq!(result.audit_events_deleted, 1);
    assert_eq!(result.feedback_deleted, 1);
    assert_eq!(result.provider_cache_deleted, 1);
    assert_eq!(result.telemetry_rows_deleted, 1);

    let conn = Connection::open(state.storage().database_file()).expect("open test db");
    let audit_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_audit_events",
            [],
            |row| row.get(0),
        )
        .expect("count audit events");
    let feedback_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_feedback",
            [],
            |row| row.get(0),
        )
        .expect("count feedback");
    let cache_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_provider_cache",
            [],
            |row| row.get(0),
        )
        .expect("count provider cache");
    let telemetry_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_suggestion_telemetry",
            [],
            |row| row.get(0),
        )
        .expect("count telemetry");

    assert_eq!(audit_count, 1);
    assert_eq!(feedback_count, 0);
    assert_eq!(cache_count, 1);
    assert_eq!(telemetry_count, 0);
}
