//! 本地终端会话管理器集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{
        TerminalCreateRequest, TerminalOutputKind, TerminalResizeRequest, TerminalSecretInputEntry,
        TerminalSecretInputPlan, TerminalSecretInputResponse,
    },
    services::terminal_manager::TerminalManager,
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
            if event.data.contains("\u{1b}[6n") {
                manager.write(&summary.id, "\u{1b}[1;1R").unwrap();
            }
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
fn secret_input_response_answers_prompt_and_redacts_echoed_secret() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tPtyPassword123";
    let mut request = password_prompt_request(secret);
    request.secret_input_response = Some(TerminalSecretInputResponse {
        prompt_markers: vec!["deploy@dev.internal's password:".to_owned()],
        response: secret.to_owned(),
        redact_values: vec![secret.to_owned()],
        max_responses: 1,
    });

    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(received.contains("[已脱敏]"));
    assert!(
        !received.contains(secret),
        "secret input response must not be echoed to frontend output: {received:?}",
    );
}

#[test]
fn secret_input_response_answers_split_prompt_across_reads() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tSplitPrompt123";
    let mut request = split_password_prompt_request(secret);
    request.secret_input_response = Some(TerminalSecretInputResponse {
        prompt_markers: vec!["deploy@dev.internal's password:".to_owned()],
        response: secret.to_owned(),
        redact_values: vec![secret.to_owned()],
        max_responses: 1,
    });

    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(
        !received.contains(secret),
        "split prompt response must not be echoed to frontend output: {received:?}",
    );
}

#[test]
fn secret_input_response_does_not_repeat_after_second_prompt() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tSingleUsePrompt123";
    let mut request = repeated_password_prompt_request();
    request.secret_input_response = Some(TerminalSecretInputResponse {
        prompt_markers: vec!["deploy@dev.internal's password:".to_owned()],
        response: secret.to_owned(),
        redact_values: vec![secret.to_owned()],
        max_responses: 1,
    });

    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
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
        received.to_ascii_lowercase().matches("password:").count() >= 2,
        "expected the second password prompt to stay visible, got: {received:?}",
    );
    assert!(
        !received.contains("unexpected-second-read"),
        "secret input response must not answer the second prompt: {received:?}",
    );
    assert!(
        !received.contains(secret),
        "single-use secret response must not be echoed to frontend output: {received:?}",
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
        received.to_ascii_lowercase().matches("password:").count() >= 3,
        "expected the third fallback prompt to stay visible, got: {received:?}",
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
