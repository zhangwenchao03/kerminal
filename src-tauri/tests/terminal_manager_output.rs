//! TerminalManager PTY output and snapshot integration tests.

mod support;

use kerminal_lib::{
    models::terminal::{TerminalAgentKind, TerminalAgentStatus, TerminalOutputKind},
    services::terminal_manager::TerminalManager,
};
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};
use support::terminal_manager::{
    agent_signal_marker_request, assert_data_event_before_closed, collect_additional_events,
    collect_until_closed_events, collect_until_output_events,
    collect_until_output_events_without_frontend_reply, fast_bulk_output_request,
    immediate_exit_request, short_lived_echo_request, short_lived_tail_request,
    startup_cpr_query_request, stderr_tail_request, wait_for_output,
};

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
