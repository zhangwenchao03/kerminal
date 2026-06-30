//! Agent OSC signal detector tests.
//!
//! @author kongweiguang

use kerminal_lib::services::terminal_agent_signal_detector::{
    TerminalAgentKind, TerminalAgentSignal, TerminalAgentSignalDetector, TerminalAgentStatus,
};

#[test]
fn split_kerminal_marker_emits_working_signal() {
    let mut detector = TerminalAgentSignalDetector::new();

    assert!(detector.observe("\u{1b}]777;notify;Kerminal;co").is_empty());
    let signals = detector.observe("dex;working\u{7}");

    assert_eq!(
        signals,
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Codex,
            status: TerminalAgentStatus::Working,
        }]
    );
    assert_eq!(detector.armed_agent(), Some(TerminalAgentKind::Codex));
}

#[test]
fn oversized_osc_is_dropped_and_does_not_block_next_signal() {
    let mut detector = TerminalAgentSignalDetector::with_max_osc_sequence_bytes(48);

    let oversized = format!(
        "\u{1b}]777;notify;Kerminal;codex;{}{}\u{7}",
        "working".repeat(12),
        "x".repeat(64),
    );
    assert!(detector.observe(&oversized).is_empty());
    assert_eq!(detector.armed_agent(), None);

    let signals = detector.observe("\u{1b}]777;notify;Kerminal;claude;working\u{1b}\\");

    assert_eq!(
        signals,
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Claude,
            status: TerminalAgentStatus::Working,
        }]
    );
}

#[test]
fn unknown_agent_does_not_self_arm_or_emit_exit() {
    let mut detector = TerminalAgentSignalDetector::new();

    assert!(detector
        .observe("\u{1b}]133;C;unknown-agent --watch\u{7}")
        .is_empty());
    assert!(detector
        .observe("\u{1b}]777;notify;Kerminal;unknown;working\u{7}")
        .is_empty());

    assert_eq!(detector.armed_agent(), None);
    assert_eq!(detector.finish_pty(), None);
}

#[test]
fn osc133_command_start_auto_recognizes_known_agents() {
    let mut detector = TerminalAgentSignalDetector::new();

    let signals =
        detector.observe("\u{1b}]133;C;env NODE_ENV=test /usr/local/bin/gemini.cmd --yolo\u{7}");

    assert_eq!(
        signals,
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Gemini,
            status: TerminalAgentStatus::Working,
        }]
    );
    assert_eq!(detector.armed_agent(), Some(TerminalAgentKind::Gemini));
}

#[test]
fn finish_marker_updates_agent_status() {
    let mut detector = TerminalAgentSignalDetector::new();

    assert_eq!(
        detector.observe("\u{1b}]133;C;codex --full-auto\u{7}"),
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Codex,
            status: TerminalAgentStatus::Working,
        }]
    );

    let signals = detector.observe("\u{1b}]777;notify;Kerminal;codex;finished\u{7}");

    assert_eq!(
        signals,
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Codex,
            status: TerminalAgentStatus::Finished,
        }]
    );
    assert_eq!(detector.armed_agent(), Some(TerminalAgentKind::Codex));
}

#[test]
fn osc9_attention_uses_current_armed_agent_only() {
    let mut detector = TerminalAgentSignalDetector::new();

    assert!(detector
        .observe("\u{1b}]9;attention please\u{7}")
        .is_empty());
    assert_eq!(
        detector.observe("\u{1b}]133;C;\"C:\\dev\\js\\nodejs\\claude.ps1\" --resume\u{7}"),
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Claude,
            status: TerminalAgentStatus::Working,
        }]
    );

    let signals = detector.observe("\u{1b}]9;attention please\u{7}");

    assert_eq!(
        signals,
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Claude,
            status: TerminalAgentStatus::Attention,
        }]
    );
}

#[test]
fn pty_eof_turns_armed_agent_into_exited_once() {
    let mut detector = TerminalAgentSignalDetector::new();

    assert_eq!(
        detector.observe("\u{1b}]777;notify;Kerminal;gemini;working\u{7}"),
        vec![TerminalAgentSignal {
            agent: TerminalAgentKind::Gemini,
            status: TerminalAgentStatus::Working,
        }]
    );

    assert_eq!(
        detector.finish_pty(),
        Some(TerminalAgentSignal {
            agent: TerminalAgentKind::Gemini,
            status: TerminalAgentStatus::Exited,
        })
    );
    assert_eq!(detector.finish_pty(), None);
}
