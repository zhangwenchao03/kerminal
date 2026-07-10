#![allow(dead_code)]

use kerminal_lib::{
    models::terminal::{TerminalCreateRequest, TerminalOutputKind, TerminalSecretInputEntry},
    services::terminal_manager::TerminalManager,
};
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

pub fn wait_for_output(
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

pub fn collect_until_output(
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

pub fn collect_additional_output_for(
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

pub fn collect_until_output_events(
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

pub fn collect_until_closed_events(
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

pub fn collect_until_output_events_without_frontend_reply(
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

pub fn collect_additional_events(
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

pub fn assert_data_event_before_closed(
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

pub fn secret_entry(id: &str, marker: &str, response: &str) -> TerminalSecretInputEntry {
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
pub fn split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
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
pub fn early_split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
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
pub fn two_password_prompts_request(
    jump_secret: &str,
    target_secret: &str,
) -> TerminalCreateRequest {
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
pub fn two_password_prompts_request(
    jump_secret: &str,
    target_secret: &str,
) -> TerminalCreateRequest {
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
pub fn fallback_password_prompts_request(
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
pub fn fallback_password_prompts_request(
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
pub fn split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
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
pub fn early_split_password_prompt_request(secret: &str) -> TerminalCreateRequest {
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
pub fn repeated_password_prompt_request() -> TerminalCreateRequest {
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
pub fn repeated_password_prompt_request() -> TerminalCreateRequest {
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
pub fn interactive_shell_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/Q".to_owned(), "/K".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
pub fn interactive_shell_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
pub fn log_smoke_command() -> &'static str {
    "echo kerminal-log-smoke\r"
}

#[cfg(target_os = "windows")]
pub fn log_secret_command() -> &'static str {
    "echo TOKEN=super-secret-token-12345 && echo Authorization: Bearer abcdefghijklmnopqrstuvwxyz && echo sk-terminal-secret-12345 && echo kerminal-secret-log-smoke\r"
}

#[cfg(target_os = "windows")]
pub fn password_prompt_request(secret: &str) -> TerminalCreateRequest {
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
pub fn password_prompt_request(secret: &str) -> TerminalCreateRequest {
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
pub fn log_smoke_command() -> &'static str {
    "printf 'kerminal-log-smoke\\n'\n"
}

#[cfg(not(target_os = "windows"))]
pub fn log_secret_command() -> &'static str {
    "printf 'TOKEN=super-secret-token-12345\\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\\nsk-terminal-secret-12345\\nkerminal-secret-log-smoke\\n'\n"
}

#[cfg(target_os = "windows")]
pub fn short_lived_echo_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/C".to_owned(), "echo kerminal-pty-smoke".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
pub fn startup_cpr_query_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec!["-e".to_owned(), startup_cpr_node_script().to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
pub fn agent_signal_marker_request() -> TerminalCreateRequest {
    let mut request = TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec![
            "-e".to_owned(),
            "process.stdout.write('before\\x1b]777;notify;Kerminal;codex;working\\x07after\\x1b]777;notify;Kerminal;codex;finished\\x07')".to_owned(),
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
pub fn short_lived_tail_request() -> TerminalCreateRequest {
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
pub fn fast_bulk_output_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec![
            "-e".to_owned(),
            "process.stdout.write('x'.repeat(131072)); process.stdout.write('kerminal-bulk-tail')"
                .to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
pub fn stderr_tail_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec![
            "-e".to_owned(),
            "process.stderr.write('kerminal-stderr-tail')".to_owned(),
        ],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
pub fn immediate_exit_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("cmd.exe".to_owned()),
        args: vec!["/Q".to_owned(), "/C".to_owned(), "exit /B 0".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
pub fn short_lived_echo_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec!["-lc".to_owned(), "printf kerminal-pty-smoke".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
pub fn startup_cpr_query_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("node".to_owned()),
        args: vec!["-e".to_owned(), startup_cpr_node_script().to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

pub fn startup_cpr_node_script() -> &'static str {
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
pub fn agent_signal_marker_request() -> TerminalCreateRequest {
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
pub fn short_lived_tail_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec!["-lc".to_owned(), "printf kerminal-final-tail".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(not(target_os = "windows"))]
pub fn fast_bulk_output_request() -> TerminalCreateRequest {
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
pub fn stderr_tail_request() -> TerminalCreateRequest {
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
pub fn immediate_exit_request() -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some("/bin/sh".to_owned()),
        args: vec!["-lc".to_owned(), "exit 0".to_owned()],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}
