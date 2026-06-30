//! 本地终端会话管理器集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{
        TerminalAgentKind, TerminalAgentStatus, TerminalCreateRequest, TerminalOutputKind,
        TerminalResizeRequest, TerminalSecretInputEntry, TerminalSecretInputPlan,
    },
    services::terminal_manager::{rules, TerminalManager},
};
use std::{
    fs,
    sync::mpsc,
    time::{Duration, Instant},
};
use tempfile::tempdir;

#[test]
fn create_session_rejects_zero_sized_terminal() {
    let manager = TerminalManager::new();
    let request = TerminalCreateRequest {
        rows: 0,
        cols: 80,
        ..TerminalCreateRequest::default()
    };

    let result = manager.create_session(request, |_| true);

    assert!(result.is_err());
    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn missing_session_operations_return_errors() {
    let manager = TerminalManager::new();

    assert!(manager.write("missing", "echo test\r").is_err());
    assert!(manager
        .resize("missing", TerminalResizeRequest { rows: 24, cols: 80 })
        .is_err());
    assert!(manager.close("missing").is_err());
    assert!(manager
        .start_log("missing", tempdir().unwrap().path())
        .is_err());
    assert!(manager.stop_log("missing").is_err());
    assert!(manager.log_state("missing").is_err());
}

#[test]
fn create_session_registers_and_close_removes_session() {
    let manager = TerminalManager::new();
    let (sender, _receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_echo_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let sessions = manager.list_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, summary.id);
    assert_eq!(sessions[0].cols, 80);
    assert_eq!(sessions[0].rows, 24);

    manager.close(&summary.id).unwrap();

    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn close_interactive_session_returns_quickly_and_removes_session() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();

    let started_at = Instant::now();
    manager.close(&summary.id).unwrap();
    let elapsed = started_at.elapsed();

    assert!(
        elapsed < Duration::from_secs(1),
        "interactive PTY close should not synchronously wait on child teardown: {elapsed:?}",
    );
    assert!(manager.session_summary(&summary.id).is_err());
}

#[test]
fn reap_orphan_sessions_removes_all_local_sessions_and_returns_diagnostics() {
    let manager = TerminalManager::new();
    let first = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();
    let second = manager
        .create_session(interactive_shell_request(), |_| true)
        .unwrap();

    let diagnostics = manager.reap_orphan_sessions().unwrap();

    assert_eq!(diagnostics.reaped_count, 2);
    assert_eq!(diagnostics.session_ids.len(), 2);
    assert!(diagnostics.session_ids.contains(&first.id));
    assert!(diagnostics.session_ids.contains(&second.id));
    assert!(manager.list_sessions().unwrap().is_empty());
    assert!(manager.session_summary(&first.id).is_err());
    assert!(manager.session_summary(&second.id).is_err());
}

#[test]
fn reap_orphan_sessions_on_empty_manager_is_noop() {
    let manager = TerminalManager::new();

    let diagnostics = manager.reap_orphan_sessions().unwrap();

    assert_eq!(diagnostics.reaped_count, 0);
    assert!(diagnostics.session_ids.is_empty());
    assert!(manager.list_sessions().unwrap().is_empty());
}

#[test]
fn target_ref_token_is_preserved_and_verifiable() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(short_lived_echo_request(), |_| true)
        .unwrap();

    let updated = manager.set_target_ref(&summary.id, "ssh:host-a").unwrap();
    let target_token = updated.target_token.clone().expect("target token");
    assert_eq!(target_token.split('.').count(), 5);
    let sessions = manager.list_sessions().unwrap();
    let (snapshot_summary, _snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();

    manager.close(&summary.id).unwrap();

    assert_eq!(updated.target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(sessions[0].target_ref.as_deref(), Some("ssh:host-a"));
    assert_eq!(
        sessions[0].target_token.as_deref(),
        Some(target_token.as_str())
    );
    assert_eq!(
        snapshot_summary.target_token.as_deref(),
        Some(target_token.as_str())
    );
    assert!(manager
        .verify_target_token(&summary.id, &target_token)
        .expect_err("closed session cannot verify token")
        .to_string()
        .contains("终端会话不存在"));
}

#[test]
fn target_token_rejects_forged_value() {
    let manager = TerminalManager::new();
    let summary = manager
        .create_session(short_lived_echo_request(), |_| true)
        .unwrap();

    let updated = manager.set_target_ref(&summary.id, "ssh:host-a").unwrap();
    let target_token = updated.target_token.expect("target token");

    assert!(manager
        .verify_target_token(&summary.id, &target_token)
        .expect("verify valid token")
        .is_some());
    assert!(manager
        .verify_target_token(&summary.id, "v1.forged.token")
        .expect("verify forged token")
        .is_none());

    manager.close(&summary.id).unwrap();
}

#[test]
fn close_removes_session_cleanup_paths() {
    let manager = TerminalManager::new();
    let temp = tempdir().unwrap();
    let cleanup_path = temp.path().join("identity.key");
    fs::write(&cleanup_path, "temporary private key").unwrap();
    let mut request = short_lived_echo_request();
    request.cleanup_paths = vec![cleanup_path.clone()];

    let summary = manager.create_session(request, |_| true).unwrap();
    manager.close(&summary.id).unwrap();

    assert!(!cleanup_path.exists());
}

#[test]
fn pty_session_emits_output_for_short_lived_command() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_echo_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
        }

        if received.contains("kerminal-pty-smoke") {
            break;
        }
    }

    manager.close(&summary.id).unwrap();

    assert!(
        received.contains("kerminal-pty-smoke"),
        "expected PTY output to contain smoke marker, got: {received:?}",
    );
    assert!(
        !received.contains("\u{1b}[6n"),
        "startup CPR query should be answered by the backend responder, not emitted to frontend data: {received:?}",
    );
}

#[test]
fn pty_session_answers_startup_cpr_without_frontend_renderer_reply() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(startup_cpr_query_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_output_events_without_frontend_reply(&receiver, "kerminal-cpr-ok");
    let data = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect::<String>();

    manager.close(&summary.id).unwrap();

    assert!(
        data.contains("kerminal-cpr-ok"),
        "PTY child should receive backend CPR response without frontend renderer reply: {data:?}",
    );
    assert!(
        !data.contains("\u{1b}[6n"),
        "backend-answered CPR query must not be forwarded to terminal data: {data:?}",
    );
}

#[test]
fn pty_session_emits_agent_signal_events_without_writing_markers_to_data() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(agent_signal_marker_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    let data = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect::<String>();
    let signals = events
        .iter()
        .filter_map(|event| event.agent_signal.as_ref())
        .collect::<Vec<_>>();
    let session_summary = manager.session_summary(&summary.id).unwrap();
    let (_snapshot_session, snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();

    manager.close(&summary.id).unwrap();

    assert_eq!(summary.agent_session_id.as_deref(), Some("ags-codex"));
    assert!(
        data.contains("beforeafter"),
        "agent marker must be removed without dropping surrounding output: {data:?}",
    );
    assert!(
        !data.contains("777;notify;Kerminal"),
        "agent marker must not be written into terminal data: {data:?}",
    );
    assert!(
        !snapshot.data.contains("777;notify;Kerminal"),
        "agent marker must not be persisted into output snapshot: {:?}",
        snapshot.data,
    );
    assert_eq!(
        signals.len(),
        3,
        "expected working, finished, exited: {events:?}"
    );
    assert_eq!(signals[0].agent, TerminalAgentKind::Codex);
    assert_eq!(signals[0].status, TerminalAgentStatus::Working);
    assert_eq!(signals[1].status, TerminalAgentStatus::Finished);
    assert_eq!(signals[2].status, TerminalAgentStatus::Exited);
    for signal in &signals {
        assert_eq!(signal.agent_session_id.as_deref(), Some("ags-codex"));
        assert_eq!(signal.terminal_session_id, summary.id);
    }
    assert_eq!(
        session_summary
            .agent_signal
            .as_ref()
            .map(|signal| signal.status),
        Some(TerminalAgentStatus::Exited),
    );
}

#[test]
fn output_snapshot_returns_recent_terminal_output() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_echo_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    wait_for_output(&manager, &summary.id, &receiver, "kerminal-pty-smoke");

    let (snapshot_session, snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();
    let (_, tiny_snapshot) = manager.output_snapshot(&summary.id, 8).unwrap();

    manager.close(&summary.id).unwrap();

    assert_eq!(snapshot_session.id, summary.id);
    assert!(snapshot.data.contains("kerminal-pty-smoke"));
    assert!(snapshot.captured_bytes <= snapshot.max_bytes);
    assert!(tiny_snapshot.captured_bytes <= 8);
    assert!(tiny_snapshot.truncated);
}

#[test]
fn pty_session_flushes_short_lived_tail_without_waiting_for_threshold() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events =
        collect_until_output_events(&manager, &summary.id, &receiver, "kerminal-final-tail");
    manager.close(&summary.id).unwrap();

    assert!(
        events.iter().any(|event| {
            event.kind == TerminalOutputKind::Data && event.data.contains("kerminal-final-tail")
        }),
        "short output tail must be delivered by idle flush before close: {events:?}",
    );
}

#[test]
fn pty_session_emits_final_tail_before_closed_for_short_lived_command() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    manager.close(&summary.id).unwrap();

    assert_data_event_before_closed(&events, "kerminal-final-tail");
}

#[test]
fn pty_session_emits_stderr_tail_before_closed() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(stderr_tail_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events = collect_until_closed_events(&manager, &summary.id, &receiver);
    manager.close(&summary.id).unwrap();

    assert_data_event_before_closed(&events, "kerminal-stderr-tail");
}

#[test]
fn pty_session_immediate_exit_emits_closed_once() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(immediate_exit_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let mut events = collect_until_closed_events(&manager, &summary.id, &receiver);
    events.extend(collect_additional_events(
        &receiver,
        Duration::from_millis(500),
    ));
    manager.close(&summary.id).unwrap();

    let closed_count = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Closed)
        .count();
    assert_eq!(
        closed_count, 1,
        "closed event must be emitted once: {events:?}"
    );
}

#[test]
fn pty_session_tolerates_output_consumer_closing_before_session_exit() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(short_lived_tail_request(), move |event| {
            let _ = sender.send(event.kind.clone());
            false
        })
        .unwrap();

    let first_event = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("output consumer should receive at least one event before closing");
    manager.close(&summary.id).unwrap();

    assert_eq!(first_event, TerminalOutputKind::Data);
}

#[test]
fn pty_session_coalesces_fast_bulk_output_and_snapshot_keeps_tail() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(fast_bulk_output_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let events =
        collect_until_output_events(&manager, &summary.id, &receiver, "kerminal-bulk-tail");
    let received = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect::<String>();
    let data_events = events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .count();
    let (_, snapshot) = manager.output_snapshot(&summary.id, 4096).unwrap();

    manager.close(&summary.id).unwrap();

    assert!(
        received.contains("kerminal-bulk-tail"),
        "expected bulk output tail, got {} events and {} bytes",
        data_events,
        received.len(),
    );
    assert!(
        data_events <= 16,
        "fast 128 KiB output should be coalesced before emitting, got {data_events} data events",
    );
    assert!(snapshot.data.contains("kerminal-bulk-tail"));
}

#[test]
fn session_log_writes_new_output_until_stopped() {
    let manager = TerminalManager::new();
    let logs_root = tempdir().unwrap();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(interactive_shell_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let started = manager.start_log(&summary.id, logs_root.path()).unwrap();
    assert!(started.active);
    assert!(started
        .path
        .as_deref()
        .is_some_and(|path| path.contains("session-")));

    manager.write(&summary.id, log_smoke_command()).unwrap();
    wait_for_output(&manager, &summary.id, &receiver, "kerminal-log-smoke");

    let stopped = manager.stop_log(&summary.id).unwrap();
    manager.close(&summary.id).unwrap();

    assert!(!stopped.active);
    assert!(stopped.bytes_written >= started.bytes_written);
    let log_path = stopped.path.expect("stopped log path");
    let log = fs::read_to_string(log_path).unwrap();
    assert!(log.contains("Kerminal session log"));
    assert!(log.contains("kerminal-log-smoke"));
}

#[test]
fn session_log_redacts_common_secret_shapes() {
    let manager = TerminalManager::new();
    let logs_root = tempdir().unwrap();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(interactive_shell_request(), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    manager.start_log(&summary.id, logs_root.path()).unwrap();
    manager.write(&summary.id, log_secret_command()).unwrap();
    wait_for_output(
        &manager,
        &summary.id,
        &receiver,
        "kerminal-secret-log-smoke",
    );

    let stopped = manager.stop_log(&summary.id).unwrap();
    manager.close(&summary.id).unwrap();

    let log_path = stopped.path.expect("stopped log path");
    let log = fs::read_to_string(log_path).unwrap();
    assert!(log.contains("kerminal-secret-log-smoke"));
    assert!(log.contains("TOKEN=[已脱敏]"));
    assert!(log.contains("Bearer [已脱敏]"));
    assert!(!log.contains("super-secret-token-12345"));
    assert!(!log.contains("abcdefghijklmnopqrstuvwxyz"));
    assert!(!log.contains("sk-terminal-secret-12345"));
}

#[test]
fn secret_prompt_match_accepts_prompt_like_password_suffixes() {
    let markers = vec!["password:".to_owned()];

    assert!(rules::secret_prompt_matches("password: ", &markers));
    assert!(rules::secret_prompt_matches(
        "deploy@dev.internal's password:",
        &markers
    ));
    assert!(rules::secret_prompt_matches("enter password:", &markers));
    assert!(rules::secret_prompt_matches(
        "password for deploy:",
        &markers
    ));
}

#[test]
fn secret_prompt_match_rejects_password_history_and_status_lines() {
    let markers = vec!["password:".to_owned()];

    assert!(!rules::secret_prompt_matches(
        "last failed password:",
        &markers
    ));
    assert!(!rules::secret_prompt_matches(
        "accepted password:",
        &markers
    ));
    assert!(!rules::secret_prompt_matches("password changed:", &markers));
    assert!(!rules::secret_prompt_matches(
        "password: changed yesterday",
        &markers
    ));
}

#[test]
fn secret_prompt_match_rejects_prefixed_specific_marker_lines() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(!rules::secret_prompt_matches(
        "notice: deploy@dev.internal's password:",
        &markers,
    ));
}

#[test]
fn secret_prompt_match_ignores_terminal_control_prefixes() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(rules::secret_prompt_matches(
        "\u{1b}[6n\u{1b}[?9001h\u{1b}]0;C:\\WINDOWS\\system32\\cmd.exe\u{7}\u{1b}[?25hdeploy@dev.internal's password: ",
        &markers,
    ));
}

#[test]
fn secret_prompt_match_uses_last_line_for_banners_and_split_prompts() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(!rules::secret_prompt_matches(
        "last failed password:\r\ndeploy@dev.internal's pass",
        &markers,
    ));
    assert!(rules::secret_prompt_matches(
        "last failed password:\r\ndeploy@dev.internal's password: ",
        &markers,
    ));
}

#[test]
fn secret_input_plan_answers_prompt_and_redacts_echoed_secret() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tPtyPassword123";
    let request = password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry(
            "target",
            "deploy@dev.internal's password:",
            secret,
        )],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(received.contains("[已脱敏]"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "auto-submitted password prompt should not stay visible: {received:?}",
    );
    assert!(
        !received.contains(secret),
        "secret input response must not be echoed to frontend output: {received:?}",
    );
}

#[test]
fn secret_input_plan_does_not_repeat_after_second_prompt() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tSingleUsePrompt123";
    let request = repeated_password_prompt_request();
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry(
            "target",
            "deploy@dev.internal's password:",
            secret,
        )],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let mut received = collect_until_output(&manager, &summary.id, &receiver, "first-read");
    received.push_str(&collect_additional_output_for(
        &manager,
        &summary.id,
        &receiver,
        Duration::from_millis(900),
    ));
    manager.close(&summary.id).unwrap();

    assert!(received.contains("first-read"));
    assert!(
        received.to_ascii_lowercase().matches("password:").count() >= 1,
        "expected only the later password prompt to stay visible, got: {received:?}",
    );
    assert!(
        !received.contains("unexpected-second-read"),
        "secret input plan must not answer the second prompt: {received:?}",
    );
    assert!(
        !received.contains(secret),
        "single-use secret plan must not be echoed to frontend output: {received:?}",
    );
}

#[test]
fn secret_input_plan_answers_two_independent_password_prompts_and_redacts_values() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let jump_secret = "jumpSecret123";
    let target_secret = "targetSecret456";
    let request = two_password_prompts_request(jump_secret, target_secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![
            secret_entry("jump", "bastion password:", jump_secret),
            secret_entry("target", "target password:", target_secret),
        ],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "target-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("jump-ok"));
    assert!(received.contains("target-ok"));
    assert!(received.matches("[已脱敏]").count() >= 2);
    assert!(!received.contains(jump_secret));
    assert!(!received.contains(target_secret));
}

#[test]
fn secret_input_plan_answers_split_prompt_across_reads() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "planSplitSecret123";
    let request = split_password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry(
            "split-target",
            "deploy@dev.internal's password:",
            secret,
        )],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "split auto-submitted password prompt should not stay visible: {received:?}",
    );
    assert!(!received.contains(secret));
}

#[test]
fn secret_input_plan_answers_split_host_prompt_with_generic_marker() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "genericSplitSecret123";
    let request = split_password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry("generic-target", "password:", secret)],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "generic split password prompt should not stay visible: {received:?}",
    );
    assert!(
        !received.contains("deploy@dev.internal"),
        "generic split password prompt prefix should be redacted: {received:?}",
    );
    assert!(!received.contains(secret));
}

#[test]
fn secret_input_plan_clears_generic_prompt_line_when_owner_prefix_was_split() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "genericOwnerSplitSecret123";
    let request = early_split_password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry("generic-owner-target", "password:", secret)],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("\r\x1b[2K"));
    assert!(received.contains("auth-ok"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "split generic password prompt should not stay visible: {received:?}",
    );
    assert!(!received.contains(secret));
}

#[test]
fn secret_input_plan_fallback_marker_advances_entries_without_overrepeating() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let first_secret = "fallbackFirst123";
    let second_secret = "fallbackSecond456";
    let request = fallback_password_prompts_request(first_secret, second_secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![
            secret_entry("first", "password:", first_secret),
            secret_entry("second", "password:", second_secret),
        ],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let mut received = collect_until_output(&manager, &summary.id, &receiver, "second-read");
    received.push_str(&collect_additional_output_for(
        &manager,
        &summary.id,
        &receiver,
        Duration::from_millis(900),
    ));
    manager.close(&summary.id).unwrap();

    assert!(received.contains("first-read"));
    assert!(received.contains("second-read"));
    assert!(
        received.to_ascii_lowercase().matches("password:").count() >= 1,
        "expected only the unanswered fallback prompt to stay visible, got: {received:?}",
    );
    assert!(
        !received.contains("unexpected-third-read"),
        "fallback marker must not over-answer exhausted entries: {received:?}",
    );
    assert!(!received.contains(first_secret));
    assert!(!received.contains(second_secret));
}

fn wait_for_output(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
    expected: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }

        if received.contains(expected) {
            return;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

fn collect_until_output(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
    expected: &str,
) -> String {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }

        if received.contains(expected) {
            return received;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

fn collect_additional_output_for(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
    duration: Duration,
) -> String {
    let deadline = Instant::now() + duration;
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }
    }

    received
}

fn collect_until_output_events(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
    expected: &str,
) -> Vec<kerminal_lib::models::terminal::TerminalOutputEvent> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut events = Vec::new();
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
            if event.data.contains("\u{1b}[6n") {
                manager.write(session_id, "\u{1b}[1;1R").unwrap();
            }
        }
        events.push(event);
        if received.contains(expected) {
            return events;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

fn collect_until_closed_events(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
) -> Vec<kerminal_lib::models::terminal::TerminalOutputEvent> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut events = Vec::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data && event.data.contains("\u{1b}[6n") {
            manager.write(session_id, "\u{1b}[1;1R").unwrap();
        }
        let is_closed = event.kind == TerminalOutputKind::Closed;
        events.push(event);
        if is_closed {
            return events;
        }
    }

    panic!("expected PTY session to emit closed, got: {events:?}");
}

fn collect_until_output_events_without_frontend_reply(
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
    expected: &str,
) -> Vec<kerminal_lib::models::terminal::TerminalOutputEvent> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut events = Vec::new();
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        if event.kind == TerminalOutputKind::Data {
            received.push_str(&event.data);
        }
        events.push(event);
        if received.contains(expected) {
            return events;
        }
    }

    panic!("expected PTY output to contain {expected:?}, got: {received:?}");
}

fn collect_additional_events(
    receiver: &mpsc::Receiver<kerminal_lib::models::terminal::TerminalOutputEvent>,
    duration: Duration,
) -> Vec<kerminal_lib::models::terminal::TerminalOutputEvent> {
    let deadline = Instant::now() + duration;
    let mut events = Vec::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        events.push(event);
    }

    events
}

fn assert_data_event_before_closed(
    events: &[kerminal_lib::models::terminal::TerminalOutputEvent],
    expected: &str,
) {
    let data_index = events
        .iter()
        .position(|event| event.kind == TerminalOutputKind::Data && event.data.contains(expected))
        .unwrap_or_else(|| panic!("expected data event containing {expected:?}, got: {events:?}"));
    let closed_index = events
        .iter()
        .position(|event| event.kind == TerminalOutputKind::Closed)
        .unwrap_or_else(|| panic!("expected closed event, got: {events:?}"));

    assert!(
        data_index < closed_index,
        "final tail must be delivered before closed: {events:?}",
    );
}

fn secret_entry(id: &str, marker: &str, response: &str) -> TerminalSecretInputEntry {
    TerminalSecretInputEntry {
        id: id.to_owned(),
        label: id.to_owned(),
        prompt_markers: vec![marker.to_owned()],
        response: response.to_owned(),
        redact_values: vec![response.to_owned()],
        max_responses: 1,
    }
}

#[cfg(target_os = "windows")]
fn split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("powershell.exe".to_owned()),
        args: vec![
            "-NoProfile".to_owned(),
            "-Command".to_owned(),
            format!(
                "$secret = '{secret}'; [Console]::Out.Write(\"deploy@dev.internal's pass\"); Start-Sleep -Milliseconds 100; [Console]::Out.Write('word: '); $p = [Console]::In.ReadLine(); if ($p -eq $secret) {{ [Console]::Out.WriteLine('auth-ok') }}"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn early_split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("powershell.exe".to_owned()),
        args: vec![
            "-NoProfile".to_owned(),
            "-Command".to_owned(),
            format!(
                "$secret = '{secret}'; [Console]::Out.Write(\"deploy@dev.internal's \"); Start-Sleep -Milliseconds 100; [Console]::Out.Write('password: '); $p = [Console]::In.ReadLine(); if ($p -eq $secret) {{ [Console]::Out.WriteLine('auth-ok') }}"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn two_password_prompts_request(jump_secret: &str, target_secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/V:ON".to_owned(),
            "/Q".to_owned(),
            "/C".to_owned(),
            format!(
                "set /p p=bastion password: & if \"!p!\"==\"{jump_secret}\" echo echoed !p! jump-ok & set /p q=target password: & if \"!q!\"==\"{target_secret}\" echo echoed !q! target-ok"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn two_password_prompts_request(jump_secret: &str, target_secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            format!(
                "printf 'bastion password: '; IFS= read -r p; if [ \"$p\" = \"{jump_secret}\" ]; then printf 'echoed %s jump-ok\\n' \"$p\"; fi; printf 'target password: '; IFS= read -r q; if [ \"$q\" = \"{target_secret}\" ]; then printf 'echoed %s target-ok\\n' \"$q\"; fi"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn fallback_password_prompts_request(
    first_secret: &str,
    second_secret: &str,
) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/V:ON".to_owned(),
            "/Q".to_owned(),
            "/C".to_owned(),
            format!(
                "set /p a=password: & if \"!a!\"==\"{first_secret}\" echo first-read & set /p b=password: & if \"!b!\"==\"{second_secret}\" echo second-read & set /p c=password: & echo unexpected-third-read !c!"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn fallback_password_prompts_request(
    first_secret: &str,
    second_secret: &str,
) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            format!(
                "printf 'password: '; IFS= read -r a; if [ \"$a\" = \"{first_secret}\" ]; then printf 'first-read\\n'; fi; printf 'password: '; IFS= read -r b; if [ \"$b\" = \"{second_secret}\" ]; then printf 'second-read\\n'; fi; printf 'password: '; IFS= read -r c; printf 'unexpected-third-read %s\\n' \"$c\""
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            format!(
                "printf \"deploy@dev.internal's pass\"; sleep 0.1; printf \"word: \"; IFS= read -r p; if [ \"$p\" = \"{secret}\" ]; then printf 'auth-ok\\n'; fi"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn early_split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            format!(
                "printf \"deploy@dev.internal's \"; sleep 0.1; printf \"password: \"; IFS= read -r p; if [ \"$p\" = \"{secret}\" ]; then printf 'auth-ok\\n'; fi"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn repeated_password_prompt_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/V:ON".to_owned(),
            "/Q".to_owned(),
            "/C".to_owned(),
            "set /p p=deploy@dev.internal's password: & echo first-read & set /p q=deploy@dev.internal's password: & echo unexpected-second-read !q!".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn repeated_password_prompt_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf \"deploy@dev.internal's password: \"; IFS= read -r p; printf 'first-read\\n'; printf \"deploy@dev.internal's password: \"; IFS= read -r q; printf 'unexpected-second-read %s\\n' \"$q\"".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn interactive_shell_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/Q".to_owned(), "/K".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn interactive_shell_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn log_smoke_command() -> &'static str {
    "echo kerminal-log-smoke\r"
}

#[cfg(target_os = "windows")]
fn log_secret_command() -> &'static str {
    "echo TOKEN=super-secret-token-12345 && echo Authorization: Bearer abcdefghijklmnopqrstuvwxyz && echo sk-terminal-secret-12345 && echo kerminal-secret-log-smoke\r"
}

#[cfg(target_os = "windows")]
fn password_prompt_request(secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/V:ON".to_owned(),
            "/Q".to_owned(),
            "/C".to_owned(),
            format!(
                "set /p p=deploy@dev.internal's password: & if \"!p!\"==\"{secret}\" echo echoed !p! auth-ok"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn password_prompt_request(secret: &str) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            format!(
                "printf \"deploy@dev.internal's password: \"; IFS= read -r p; if [ \"$p\" = \"{secret}\" ]; then printf 'echoed %s auth-ok\\n' \"$p\"; fi"
            ),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn log_smoke_command() -> &'static str {
    "printf 'kerminal-log-smoke\\n'\n"
}

#[cfg(not(target_os = "windows"))]
fn log_secret_command() -> &'static str {
    "printf 'TOKEN=super-secret-token-12345\\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\\nsk-terminal-secret-12345\\nkerminal-secret-log-smoke\\n'\n"
}

#[cfg(target_os = "windows")]
fn short_lived_echo_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/C".to_owned(), "echo kerminal-pty-smoke".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn startup_cpr_query_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec!["-e".to_owned(), startup_cpr_node_script().to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn agent_signal_marker_request() -> TerminalCreateRequest {
    let mut request = TerminalCreateRequest {
        shell: Some("powershell.exe".to_owned()),
        args: vec![
            "-NoProfile".to_owned(),
            "-Command".to_owned(),
            "[Console]::Out.Write(\"before$([char]27)]777;notify;Kerminal;codex;working$([char]7)after$([char]27)]777;notify;Kerminal;codex;finished$([char]7)\")"
                .to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    };
    request.env.insert(
        "KERMINAL_AGENT_SESSION_ID".to_owned(),
        "ags-codex".to_owned(),
    );
    request
}

#[cfg(target_os = "windows")]
fn short_lived_tail_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/Q".to_owned(),
            "/C".to_owned(),
            "<nul set /p =kerminal-final-tail".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn fast_bulk_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("powershell.exe".to_owned()),
        args: vec![
            "-NoProfile".to_owned(),
            "-Command".to_owned(),
            "[Console]::Out.Write(('x' * 131072)); [Console]::Out.Write('kerminal-bulk-tail')"
                .to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn stderr_tail_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("powershell.exe".to_owned()),
        args: vec![
            "-NoProfile".to_owned(),
            "-Command".to_owned(),
            "[Console]::Error.Write('kerminal-stderr-tail')".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn immediate_exit_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/Q".to_owned(), "/C".to_owned(), "exit /B 0".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn short_lived_echo_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec!["-lc".to_owned(), "printf kerminal-pty-smoke".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn startup_cpr_query_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec!["-e".to_owned(), startup_cpr_node_script().to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

fn startup_cpr_node_script() -> &'static str {
    r#"const expected = "\x1b[1;1R";
let input = "";
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("\x1b[6n");
process.stdin.on("data", (chunk) => {
  input += chunk.toString("latin1");
  if (input.length >= expected.length) {
    const ok = input.startsWith(expected);
    process.stdout.write(ok ? "kerminal-cpr-ok" : `kerminal-cpr-bad:${JSON.stringify(input)}`);
    process.exit(ok ? 0 : 2);
  }
});
setTimeout(() => {
  process.stdout.write("kerminal-cpr-timeout");
  process.exit(3);
}, 3000);"#
}

#[cfg(not(target_os = "windows"))]
fn agent_signal_marker_request() -> TerminalCreateRequest {
    let mut request = TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf 'before\\033]777;notify;Kerminal;codex;working\\007after\\033]777;notify;Kerminal;codex;finished\\007'"
                .to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    };
    request.env.insert(
        "KERMINAL_AGENT_SESSION_ID".to_owned(),
        "ags-codex".to_owned(),
    );
    request
}

#[cfg(not(target_os = "windows"))]
fn short_lived_tail_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec!["-lc".to_owned(), "printf kerminal-final-tail".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn fast_bulk_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "awk 'BEGIN { for (i = 0; i < 131072; i++) printf \"x\"; printf \"kerminal-bulk-tail\" }'".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn stderr_tail_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf kerminal-stderr-tail >&2".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn immediate_exit_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec!["-lc".to_owned(), "exit 0".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}
