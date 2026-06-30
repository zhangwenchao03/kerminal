//! Explicitly gated Codex/Claude real CLI HITL smoke harness.
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{
        TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind, TerminalResizeRequest,
    },
    services::terminal_manager::TerminalManager,
};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

const ENABLE_HITL_ENV: &str = "KERMINAL_AGENT_CLI_HITL";
const ALLOW_SUBMIT_ENV: &str = "KERMINAL_AGENT_CLI_HITL_ALLOW_SUBMIT";
const PROMPT_ENV: &str = "KERMINAL_AGENT_CLI_HITL_PROMPT";
const EXPECT_ENV: &str = "KERMINAL_AGENT_CLI_HITL_EXPECT";
const DEFAULT_EXPECTED_REPLY: &str = "KERMINAL_SMOKE_OK";

#[test]
fn codex_and_claude_real_prompt_hitl_matrix() {
    let cases = discover_agent_cases();
    if !env_flag_enabled(ENABLE_HITL_ENV) {
        for case in cases {
            println!(
                "agent cli hitl program={} status=skipped reason=set {ENABLE_HITL_ENV}=1 to run real CLI smoke",
                case.name
            );
        }
        return;
    }

    let allow_submit = env_flag_enabled(ALLOW_SUBMIT_ENV);
    let mut passed = Vec::new();
    let mut skipped = Vec::new();
    let mut failures = Vec::new();

    for case in cases {
        match case.status {
            AgentCaseStatus::Skipped(reason) => {
                println!(
                    "agent cli hitl program={} status=skipped reason={reason}",
                    case.name
                );
                skipped.push(format!("{}: {reason}", case.name));
            }
            AgentCaseStatus::Runnable { request } => {
                match run_agent_cli_case(case.name, request, allow_submit) {
                    Ok(report) => {
                        println!(
                            "agent cli hitl program={} status=passed mode={} data_bytes={} saw_typed_markers={}",
                            case.name,
                            report.mode,
                            report.data_bytes,
                            report.saw_typed_markers
                        );
                        passed.push(case.name.to_owned());
                    }
                    Err(error) => failures.push(format!("{}: {error}", case.name)),
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "agent CLI HITL matrix failures:\n{}",
        failures.join("\n")
    );
    println!(
        "agent cli hitl summary passed={} skipped={} submit_allowed={allow_submit}",
        passed.join(","),
        skipped.join(",")
    );
}

struct AgentCase {
    name: &'static str,
    status: AgentCaseStatus,
}

enum AgentCaseStatus {
    Runnable { request: TerminalCreateRequest },
    Skipped(String),
}

struct AgentCaseReport {
    data_bytes: usize,
    mode: &'static str,
    saw_typed_markers: bool,
}

fn run_agent_cli_case(
    name: &'static str,
    request: TerminalCreateRequest,
    allow_submit: bool,
) -> Result<AgentCaseReport, String> {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
        .map_err(|error| format!("create session failed: {error}"))?;

    let result = run_agent_cli_case_inner(name, &manager, &summary.id, &receiver, allow_submit);
    let close_result = manager.close(&summary.id);
    match (result, close_result) {
        (Ok(report), Ok(())) => Ok(report),
        (Ok(report), Err(error)) if error.to_string().contains("终端会话不存在") => {
            Ok(report)
        }
        (Ok(_), Err(error)) => Err(format!("close failed after HITL smoke: {error}")),
        (Err(error), _) => Err(error),
    }
}

fn run_agent_cli_case_inner(
    name: &'static str,
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    allow_submit: bool,
) -> Result<AgentCaseReport, String> {
    let mut transcript =
        collect_until_any_data(manager, session_id, receiver, Duration::from_secs(15))?;

    manager
        .resize(
            session_id,
            TerminalResizeRequest {
                rows: 32,
                cols: 100,
            },
        )
        .map_err(|error| format!("{name}: resize failed: {error}"))?;

    if allow_submit {
        let expected =
            std::env::var(EXPECT_ENV).unwrap_or_else(|_| DEFAULT_EXPECTED_REPLY.to_owned());
        let prompt = std::env::var(PROMPT_ENV).unwrap_or_else(|_| {
            format!(
                "Kerminal PTY smoke. Reply exactly {expected}. Do not run tools.\nThis verifies multiline prompt input.\nFinal line."
            )
        });
        manager
            .write(session_id, &format!("{prompt}\r"))
            .map_err(|error| format!("{name}: write submit prompt failed: {error}"))?;
        transcript.push_str(&collect_until_output(
            manager,
            session_id,
            receiver,
            &expected,
            Duration::from_secs(120),
        )?);
        manager
            .write(session_id, "\t\u{1b}[Z\u{1b}\u{3}")
            .map_err(|error| format!("{name}: write post-submit key smoke failed: {error}"))?;
        transcript.push_str(&collect_additional_output_for(
            manager,
            session_id,
            receiver,
            Duration::from_secs(2),
        ));
        Ok(AgentCaseReport {
            data_bytes: transcript.len(),
            mode: "submit",
            saw_typed_markers: transcript.contains(DEFAULT_EXPECTED_REPLY),
        })
    } else {
        let typed = concat!(
            "kerminal-agent-smoke-line1\n",
            "kerminal-agent-smoke-line2\n",
            "kerminal-agent-smoke-line3"
        );
        manager
            .write(session_id, typed)
            .map_err(|error| format!("{name}: write multiline prompt failed: {error}"))?;
        manager
            .write(
                session_id,
                "\t\u{1b}[Z\u{1b}\u{1b}[200~kerminal paste line A\nkerminal paste line B\u{1b}[201~",
            )
            .map_err(|error| format!("{name}: write navigation/paste smoke failed: {error}"))?;
        transcript.push_str(&collect_additional_output_for(
            manager,
            session_id,
            receiver,
            Duration::from_secs(2),
        ));
        manager
            .write(session_id, "\u{3}\u{1b}")
            .map_err(|error| format!("{name}: write cancel keys failed: {error}"))?;
        transcript.push_str(&collect_additional_output_for(
            manager,
            session_id,
            receiver,
            Duration::from_secs(2),
        ));
        Ok(AgentCaseReport {
            data_bytes: transcript.len(),
            mode: "preflight-no-submit",
            saw_typed_markers: transcript.contains("kerminal-agent-smoke-line1")
                || transcript.contains("kerminal paste line A"),
        })
    }
}

fn collect_until_any_data(
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
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
                if !received.trim().is_empty() {
                    return Ok(received);
                }
            }
            TerminalOutputKind::Error => {
                return Err(format!("terminal emitted error event: {}", event.data));
            }
            TerminalOutputKind::Closed => {
                return Err(format!(
                    "agent CLI exited before prompt data; transcript={received:?}"
                ));
            }
            _ => {}
        }
    }

    Err(format!(
        "expected agent CLI to emit prompt data within {timeout:?}, got: {received:?}"
    ))
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
                if received.contains(expected) {
                    return Ok(received);
                }
            }
            TerminalOutputKind::Error => {
                return Err(format!("terminal emitted error event: {}", event.data));
            }
            _ => {}
        }
    }

    Err(format!(
        "expected agent CLI output to contain {expected:?}, got: {received:?}"
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

fn discover_agent_cases() -> Vec<AgentCase> {
    let Some(pwsh) = find_executable("pwsh.exe") else {
        return ["codex", "claude"]
            .into_iter()
            .map(|name| skipped_case(name, "pwsh.exe not found on PATH"))
            .collect();
    };

    ["codex", "claude"]
        .into_iter()
        .map(|name| {
            if !powershell_has_command(&pwsh, name) {
                return skipped_case(name, format!("{name} not found in PowerShell PATH"));
            }
            AgentCase {
                name,
                status: AgentCaseStatus::Runnable {
                    request: terminal_request(pwsh.clone(), name),
                },
            }
        })
        .collect()
}

fn terminal_request(pwsh: PathBuf, command: &str) -> TerminalCreateRequest {
    let script = format!("$env:TERM='xterm-256color'; $env:COLORTERM='truecolor'; & {command}");
    TerminalCreateRequest {
        shell: Some(pwsh.to_string_lossy().into_owned()),
        args: vec![
            "-NoLogo".to_owned(),
            "-NoProfile".to_owned(),
            "-ExecutionPolicy".to_owned(),
            "Bypass".to_owned(),
            "-Command".to_owned(),
            script,
        ],
        rows: 32,
        cols: 100,
        ..TerminalCreateRequest::default()
    }
}

fn skipped_case(name: &'static str, reason: impl Into<String>) -> AgentCase {
    AgentCase {
        name,
        status: AgentCaseStatus::Skipped(reason.into()),
    }
}

fn powershell_has_command(pwsh: &PathBuf, command: &str) -> bool {
    let script = format!(
        "if (Get-Command {command} -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 1 }}"
    );
    Command::new(pwsh)
        .args(["-NoLogo", "-NoProfile", "-Command", &script])
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

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}
