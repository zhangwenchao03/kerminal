//! AI terminal context 服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::{
        ai_context::AiTerminalContextRequest,
        terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    },
    security::redaction::redact_terminal_text,
    services::{ai_context_service::AiContextService, terminal_manager::TerminalManager},
};
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

#[test]
fn terminal_context_snapshot_contains_source_and_redacts_recent_output() {
    let manager = TerminalManager::new();
    let service = AiContextService::new();
    let (sender, receiver) = mpsc::channel();

    let summary = manager
        .create_session(secret_output_request(), move |event| {
            sender.send(event).is_ok()
        })
        .expect("create terminal session");

    wait_for_output(&manager, &summary.id, &receiver, "kerminal-ai-context");

    let snapshot = service
        .terminal_context_snapshot(
            &manager,
            AiTerminalContextRequest {
                session_id: summary.id.clone(),
                pane_id: Some("pane-1".to_owned()),
                pane_title: Some("本地 PowerShell".to_owned()),
                tab_id: Some("tab-1".to_owned()),
                tab_title: Some("本地终端".to_owned()),
                machine_id: Some("local-powershell".to_owned()),
                machine_name: Some("PowerShell".to_owned()),
                machine_kind: Some("local".to_owned()),
                max_output_bytes: Some(4096),
            },
        )
        .expect("build ai context");

    manager.close(&summary.id).expect("close session");

    assert_eq!(snapshot.session.id, summary.id);
    assert_eq!(snapshot.source.pane_id.as_deref(), Some("pane-1"));
    assert_eq!(snapshot.policy.mode, "currentTerminal");
    assert!(snapshot.policy.includes_recent_output);
    assert!(!snapshot.policy.includes_full_history);
    assert!(snapshot.policy.secret_redaction);
    assert!(snapshot.output.data.contains("kerminal-ai-context"));
    assert!(snapshot.redacted);
    assert!(!snapshot.output.data.contains("sk-context-secret"));
    assert!(snapshot.output.data.contains("[已脱敏"));
}

#[test]
fn terminal_context_rejects_missing_or_blank_session() {
    let manager = TerminalManager::new();
    let service = AiContextService::new();

    let error = service
        .terminal_context_snapshot(
            &manager,
            AiTerminalContextRequest {
                session_id: " ".to_owned(),
                pane_id: None,
                pane_title: None,
                tab_id: None,
                tab_title: None,
                machine_id: None,
                machine_name: None,
                machine_kind: None,
                max_output_bytes: None,
            },
        )
        .expect_err("blank session id should fail");
    assert!(error.to_string().contains("尚未绑定终端 session"));

    let error = service
        .terminal_context_snapshot(
            &manager,
            AiTerminalContextRequest {
                session_id: "missing".to_owned(),
                pane_id: None,
                pane_title: None,
                tab_id: None,
                tab_title: None,
                machine_id: None,
                machine_name: None,
                machine_kind: None,
                max_output_bytes: None,
            },
        )
        .expect_err("missing session should fail");
    assert!(error.to_string().contains("终端会话不存在"));
}

#[test]
fn redaction_covers_common_terminal_secret_shapes() {
    let (redacted, changed) = redact_terminal_text(
        "TOKEN=abc123456789\r\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\r\nsk-live-secret-key",
    );

    assert!(changed);
    assert!(redacted.contains("TOKEN=[已脱敏]"));
    assert!(redacted.contains("Bearer [已脱敏]"));
    assert!(!redacted.contains("abcdefghijklmnopqrstuvwxyz"));
    assert!(!redacted.contains("sk-live-secret-key"));
}

fn wait_for_output(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
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

#[cfg(target_os = "windows")]
fn secret_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec![
            "/C".to_owned(),
            "echo API_KEY=sk-context-secret-12345 && echo kerminal-ai-context".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
fn secret_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec![
            "-lc".to_owned(),
            "printf 'API_KEY=sk-context-secret-12345\\nkerminal-ai-context\\n'".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}
