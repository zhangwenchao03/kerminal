//! 本地 PTY 下真实 TUI 程序 smoke 矩阵。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind},
    services::terminal_manager::TerminalManager,
};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[test]
fn local_pty_wsl_tui_program_matrix_covers_available_tools() {
    let cases = discover_tui_cases();
    let mut passed = Vec::new();
    let mut skipped = Vec::new();
    let mut failures = Vec::new();

    for case in cases {
        match case.status {
            TuiCaseStatus::Skipped(reason) => {
                println!(
                    "tui matrix program={} status=skipped reason={reason}",
                    case.name
                );
                skipped.push(format!("{}: {reason}", case.name));
            }
            TuiCaseStatus::Runnable {
                request,
                interaction,
                expected_exit,
                expected_output,
            } => match run_tui_case(
                case.name,
                request,
                interaction,
                expected_exit,
                expected_output,
            ) {
                Ok(report) => {
                    println!(
                        "tui matrix program={} status=passed data_bytes={}",
                        case.name, report.data_bytes
                    );
                    passed.push(case.name.to_owned());
                }
                Err(error) => failures.push(format!("{}: {error}", case.name)),
            },
        }
    }

    assert!(
        failures.is_empty(),
        "local PTY TUI program matrix failures:\n{}",
        failures.join("\n")
    );
    println!(
        "tui matrix summary passed={} skipped={}",
        passed.join(","),
        skipped.join(",")
    );
}

struct TuiCase {
    name: &'static str,
    status: TuiCaseStatus,
}

enum TuiCaseStatus {
    Runnable {
        request: TerminalCreateRequest,
        interaction: &'static str,
        expected_exit: &'static str,
        expected_output: &'static [&'static str],
    },
    Skipped(String),
}

struct TuiCaseReport {
    data_bytes: usize,
}

fn run_tui_case(
    name: &'static str,
    request: TerminalCreateRequest,
    interaction: &'static str,
    expected_exit: &'static str,
    expected_output: &'static [&'static str],
) -> Result<TuiCaseReport, String> {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
        .map_err(|error| format!("create session failed: {error}"))?;

    let result = run_tui_case_inner(
        name,
        &manager,
        &summary.id,
        &receiver,
        interaction,
        expected_exit,
        expected_output,
    );
    let close_result = manager.close(&summary.id);
    match (result, close_result) {
        (Ok(report), Ok(())) => Ok(report),
        (Ok(report), Err(error)) if error.to_string().contains("终端会话不存在") => {
            Ok(report)
        }
        (Ok(_), Err(error)) => Err(format!("close failed after passing matrix: {error}")),
        (Err(error), _) => Err(error),
    }
}

fn run_tui_case_inner(
    name: &'static str,
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    interaction: &'static str,
    expected_exit: &'static str,
    expected_output: &'static [&'static str],
) -> Result<TuiCaseReport, String> {
    let mut transcript = collect_until_output(
        manager,
        session_id,
        receiver,
        &format!("matrix-{name}-ready"),
        Duration::from_secs(10),
    )?;
    transcript.push_str(&collect_additional_output_for(
        manager,
        session_id,
        receiver,
        Duration::from_millis(500),
    ));
    manager
        .write(session_id, interaction)
        .map_err(|error| format!("{name}: write TUI interaction failed: {error}"))?;
    transcript.push_str(&collect_until_output(
        manager,
        session_id,
        receiver,
        expected_exit,
        Duration::from_secs(10),
    )?);
    transcript.push_str(&collect_additional_output_for(
        manager,
        session_id,
        receiver,
        Duration::from_millis(250),
    ));

    for expected in expected_output {
        if !transcript.contains(expected) {
            return Err(format!(
                "{name}: missing expected output marker {expected:?}; transcript={transcript:?}"
            ));
        }
    }
    Ok(TuiCaseReport {
        data_bytes: transcript.len(),
    })
}

fn collect_until_output(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut received = String::new();

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };

        match event.kind {
            TerminalOutputKind::Data => {
                received.push_str(&event.data);
                reply_to_frontend_cpr_query(manager, session_id, &event.data);
            }
            TerminalOutputKind::Error => {
                return Err(format!("terminal emitted error event: {}", event.data));
            }
            _ => {}
        }

        if received.contains(expected) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected PTY output to contain {expected:?}, got: {received:?}"
    ))
}

fn collect_additional_output_for(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
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
            reply_to_frontend_cpr_query(manager, session_id, &event.data);
        }
    }

    received
}

fn reply_to_frontend_cpr_query(manager: &TerminalManager, session_id: &str, data: &str) {
    if data.contains("\u{1b}[6n") {
        let _ = manager.write(session_id, "\u{1b}[1;1R");
    }
}

fn discover_tui_cases() -> Vec<TuiCase> {
    let Some(wsl) = find_executable("wsl.exe") else {
        return ["vim", "less", "top", "tmux"]
            .into_iter()
            .map(|name| skipped_case(name, "wsl.exe not found on PATH"))
            .collect();
    };

    [
        (
            "vim",
            vim_script(),
            ":q!\r",
            "matrix-vim-exit",
            &["matrix-vim-content"][..],
        ),
        (
            "less",
            less_script(),
            "q",
            "matrix-less-exit",
            &["matrix-less-content"][..],
        ),
        (
            "top",
            top_script(),
            "q",
            "matrix-top-exit",
            &["matrix-top-ready"][..],
        ),
        (
            "tmux",
            tmux_script(),
            "\u{2}d",
            "matrix-tmux-exit",
            &["matrix-tmux-pane"][..],
        ),
    ]
    .into_iter()
    .map(
        |(name, script, interaction, expected_exit, expected_output)| {
            if !wsl_has_command(name) {
                return skipped_case(name, format!("WSL command {name} not found"));
            }
            TuiCase {
                name,
                status: TuiCaseStatus::Runnable {
                    request: terminal_request(wsl.clone(), script),
                    interaction,
                    expected_exit,
                    expected_output,
                },
            }
        },
    )
    .collect()
}

fn skipped_case(name: &'static str, reason: impl Into<String>) -> TuiCase {
    TuiCase {
        name,
        status: TuiCaseStatus::Skipped(reason.into()),
    }
}

fn terminal_request(wsl: PathBuf, script: String) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some(wsl.to_string_lossy().into_owned()),
        args: vec!["-e".to_owned(), "bash".to_owned(), "-lc".to_owned(), script],
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

fn wsl_has_command(command: &str) -> bool {
    Command::new("wsl.exe")
        .args([
            "-e",
            "bash",
            "-lc",
            &format!("command -v {command} >/dev/null 2>&1"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn find_executable(program: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn vim_script() -> String {
    r#"export TERM=xterm-256color
tmp="$(mktemp)"
printf 'matrix-vim-content\n' > "$tmp"
printf 'matrix-vim-ready\n'
vim -Nu NONE -n -i NONE -N "$tmp"
rc="$?"
rm -f "$tmp"
printf 'matrix-vim-exit:%s\n' "$rc"
"#
    .to_owned()
}

fn less_script() -> String {
    r#"export TERM=xterm-256color
tmp="$(mktemp)"
printf 'matrix-less-content\nmatrix-less-second-line\n' > "$tmp"
printf 'matrix-less-ready\n'
less -R "$tmp"
rc="$?"
rm -f "$tmp"
printf 'matrix-less-exit:%s\n' "$rc"
"#
    .to_owned()
}

fn top_script() -> String {
    r#"export TERM=xterm-256color
printf 'matrix-top-ready\n'
top
rc="$?"
printf 'matrix-top-exit:%s\n' "$rc"
"#
    .to_owned()
}

fn tmux_script() -> String {
    r#"export TERM=xterm-256color
sock="kerminal-pty-matrix-$$"
tmux -L "$sock" -f /dev/null kill-server >/dev/null 2>&1 || true
tmux -L "$sock" -f /dev/null new-session -d -s matrix 'printf matrix-tmux-pane; sleep 30'
printf 'matrix-tmux-ready\n'
tmux -L "$sock" -f /dev/null attach-session -t matrix
rc="$?"
tmux -L "$sock" -f /dev/null kill-server >/dev/null 2>&1 || true
printf 'matrix-tmux-exit:%s\n' "$rc"
"#
    .to_owned()
}
