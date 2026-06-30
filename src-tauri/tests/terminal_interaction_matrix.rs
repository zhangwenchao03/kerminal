//! 本地 PTY 交互矩阵集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{
        TerminalCreateRequest, TerminalOutputEvent, TerminalOutputKind, TerminalResizeRequest,
    },
    services::terminal_manager::TerminalManager,
};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
use tempfile::tempdir;

const MATRIX_READY: &str = "matrix-ready";
const MATRIX_BRACKETED_PASTE_OK: &str = "matrix-bracketed-paste-ok";
const MATRIX_UNICODE_OK: &str = "matrix-unicode-ok";
const MATRIX_CTRL_C_OK: &str = "matrix-ctrl-c-ok";
const MATRIX_CTRL_D_OK: &str = "matrix-ctrl-d-ok";
const MATRIX_ALT_ENTER: &str = "matrix-alt-enter";
const MATRIX_ALT_EXIT: &str = "matrix-alt-exit";
const MATRIX_TEXT_INPUT: &str =
    "\u{1b}[200~matrix-paste-payload\u{1b}[201~Kerminal\u{4e2d}\u{6587}\u{2713}";
const MATRIX_CTRL_C_INPUT: &str = "\u{3}";
const MATRIX_CTRL_D_INPUT: &str = "\u{4}";

#[test]
fn local_pty_interaction_matrix_covers_available_shells() {
    let temp = tempdir().expect("create matrix temp dir");
    let node_script = temp.path().join("kerminal-terminal-matrix.js");
    fs::write(&node_script, NODE_HARNESS).expect("write node harness");

    let cases = discover_shell_cases(&node_script);
    let mut passed = Vec::new();
    let mut skipped = Vec::new();
    let mut failures = Vec::new();

    for mut case in cases {
        if let Some(reason) = case.skip_reason.take() {
            println!("matrix shell={} status=skipped reason={reason}", case.name);
            skipped.push(format!("{}: {reason}", case.name));
            continue;
        }

        let Some(request) = case.request.take() else {
            let reason = "missing runnable request";
            println!("matrix shell={} status=skipped reason={reason}", case.name);
            skipped.push(format!("{}: {reason}", case.name));
            continue;
        };

        match run_shell_case(case.name, request) {
            Ok(report) => {
                println!(
                    "matrix shell={} status=passed data_bytes={} resize_child_observed={}",
                    case.name, report.data_bytes, report.resize_child_observed
                );
                passed.push(case.name.to_owned());
            }
            Err(error) => failures.push(format!("{}: {error}", case.name)),
        }
    }

    assert!(
        failures.is_empty(),
        "local PTY interaction matrix failures:\n{}",
        failures.join("\n")
    );
    assert!(
        !passed.is_empty(),
        "local PTY interaction matrix did not run any shell; skipped={skipped:?}"
    );
    println!(
        "matrix summary passed={} skipped={}",
        passed.join(","),
        skipped.join(",")
    );
}

struct ShellMatrixCase {
    name: &'static str,
    request: Option<TerminalCreateRequest>,
    skip_reason: Option<String>,
}

impl ShellMatrixCase {
    fn runnable(name: &'static str, request: TerminalCreateRequest) -> Self {
        Self {
            name,
            request: Some(request),
            skip_reason: None,
        }
    }

    fn skipped(name: &'static str, reason: impl Into<String>) -> Self {
        Self {
            name,
            request: None,
            skip_reason: Some(reason.into()),
        }
    }
}

struct ShellMatrixReport {
    data_bytes: usize,
    resize_child_observed: bool,
}

fn run_shell_case(
    name: &'static str,
    request: TerminalCreateRequest,
) -> Result<ShellMatrixReport, String> {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let summary = manager
        .create_session(request, move |event| sender.send(event).is_ok())
        .map_err(|error| format!("create session failed: {error}"))?;

    let result = run_shell_case_inner(name, &manager, &summary.id, &receiver);
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

fn run_shell_case_inner(
    name: &'static str,
    manager: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
) -> Result<ShellMatrixReport, String> {
    let mut transcript = collect_until_output(
        manager,
        session_id,
        receiver,
        MATRIX_READY,
        Duration::from_secs(8),
    )?;

    manager
        .resize(
            session_id,
            TerminalResizeRequest {
                rows: 31,
                cols: 101,
            },
        )
        .map_err(|error| format!("{name}: resize failed: {error}"))?;
    let resized = manager
        .session_summary(session_id)
        .map_err(|error| format!("{name}: summary after resize failed: {error}"))?;
    if resized.rows != 31 || resized.cols != 101 {
        return Err(format!(
            "{name}: resize summary mismatch, expected 101x31 got {}x{}",
            resized.cols, resized.rows
        ));
    }

    transcript.push_str(&collect_additional_output_for(
        manager,
        session_id,
        receiver,
        Duration::from_millis(300),
    ));
    manager
        .write(session_id, MATRIX_TEXT_INPUT)
        .map_err(|error| format!("{name}: write text interaction bytes failed: {error}"))?;
    transcript.push_str(&collect_until_output(
        manager,
        session_id,
        receiver,
        MATRIX_UNICODE_OK,
        Duration::from_secs(8),
    )?);
    manager
        .write(session_id, MATRIX_CTRL_C_INPUT)
        .map_err(|error| format!("{name}: write Ctrl+C failed: {error}"))?;
    transcript.push_str(&collect_until_output(
        manager,
        session_id,
        receiver,
        MATRIX_CTRL_C_OK,
        Duration::from_secs(8),
    )?);
    manager
        .write(session_id, MATRIX_CTRL_D_INPUT)
        .map_err(|error| format!("{name}: write Ctrl+D failed: {error}"))?;
    transcript.push_str(&collect_until_output(
        manager,
        session_id,
        receiver,
        MATRIX_CTRL_D_OK,
        Duration::from_secs(8),
    )?);
    transcript.push_str(&collect_additional_output_for(
        manager,
        session_id,
        receiver,
        Duration::from_millis(250),
    ));

    assert_matrix_output(name, &transcript)?;
    Ok(ShellMatrixReport {
        data_bytes: transcript.len(),
        resize_child_observed: transcript.contains("matrix-resize-ok"),
    })
}

fn assert_matrix_output(name: &str, output: &str) -> Result<(), String> {
    for (label, expected) in [
        ("alternate screen enter sequence", "\u{1b}[?1049h"),
        ("alternate screen exit sequence", "\u{1b}[?1049l"),
        ("alternate screen enter marker", MATRIX_ALT_ENTER),
        ("alternate screen exit marker", MATRIX_ALT_EXIT),
        ("bracketed paste bytes", MATRIX_BRACKETED_PASTE_OK),
        ("unicode input bytes", MATRIX_UNICODE_OK),
        ("Ctrl+C byte", MATRIX_CTRL_C_OK),
        ("Ctrl+D byte", MATRIX_CTRL_D_OK),
    ] {
        if !output.contains(expected) {
            return Err(format!(
                "{name}: missing {label} marker {expected:?}; output={output:?}"
            ));
        }
    }
    Ok(())
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

#[cfg(target_os = "windows")]
fn discover_shell_cases(node_script: &Path) -> Vec<ShellMatrixCase> {
    vec![
        discover_cmd_case(node_script),
        discover_node_shell_case(
            "powershell-7",
            "pwsh.exe",
            node_script,
            NodeShellKind::PowerShell,
        ),
        discover_node_shell_case(
            "windows-powershell",
            "powershell.exe",
            node_script,
            NodeShellKind::PowerShell,
        ),
        discover_git_bash_case(node_script),
        discover_wsl_bash_case(),
    ]
}

#[cfg(not(target_os = "windows"))]
fn discover_shell_cases(_node_script: &Path) -> Vec<ShellMatrixCase> {
    let mut cases = Vec::new();
    if let Some(bash) = find_executable("bash") {
        cases.push(ShellMatrixCase::runnable(
            "bash",
            bash_request(&bash, &["--noprofile", "--norc", "-lc"]),
        ));
    } else {
        cases.push(ShellMatrixCase::skipped("bash", "bash not found on PATH"));
    }
    if let Some(sh) = find_executable("sh") {
        cases.push(ShellMatrixCase::runnable("sh", bash_request(&sh, &["-lc"])));
    } else {
        cases.push(ShellMatrixCase::skipped("sh", "sh not found on PATH"));
    }
    cases
}

#[cfg(target_os = "windows")]
fn discover_cmd_case(node_script: &Path) -> ShellMatrixCase {
    let Some(cmd) = find_executable("cmd.exe") else {
        return ShellMatrixCase::skipped("cmd", "cmd.exe not found on PATH");
    };
    if find_executable("node.exe")
        .or_else(|| find_executable("node"))
        .is_none()
    {
        return ShellMatrixCase::skipped("cmd", "node executable not found for raw TTY harness");
    };
    ShellMatrixCase::runnable(
        "cmd",
        terminal_request(
            cmd,
            vec![
                "/Q".to_owned(),
                "/D".to_owned(),
                "/C".to_owned(),
                format!("node.exe {}", node_script.to_string_lossy()),
            ],
        ),
    )
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
enum NodeShellKind {
    PowerShell,
}

#[cfg(target_os = "windows")]
fn discover_node_shell_case(
    name: &'static str,
    shell_name: &str,
    node_script: &Path,
    kind: NodeShellKind,
) -> ShellMatrixCase {
    let Some(shell) = find_executable(shell_name) else {
        return ShellMatrixCase::skipped(name, format!("{shell_name} not found on PATH"));
    };
    let Some(node) = find_executable("node.exe").or_else(|| find_executable("node")) else {
        return ShellMatrixCase::skipped(name, "node executable not found for raw TTY harness");
    };

    let args = match kind {
        NodeShellKind::PowerShell => vec![
            "-NoLogo".to_owned(),
            "-NoProfile".to_owned(),
            "-ExecutionPolicy".to_owned(),
            "Bypass".to_owned(),
            "-Command".to_owned(),
            format!(
                "& {} {}",
                powershell_quote(&node),
                powershell_quote(node_script)
            ),
        ],
    };
    ShellMatrixCase::runnable(name, terminal_request(shell, args))
}

#[cfg(target_os = "windows")]
fn discover_git_bash_case(node_script: &Path) -> ShellMatrixCase {
    let Some(bash) = find_git_bash() else {
        return ShellMatrixCase::skipped("git-bash", "Git Bash bash.exe not found");
    };
    let Some(node) = find_executable("node.exe").or_else(|| find_executable("node")) else {
        return ShellMatrixCase::skipped(
            "git-bash",
            "node executable not found for raw TTY harness",
        );
    };
    if !command_status_success(Command::new(&bash).args(["--noprofile", "--norc", "-lc", "true"])) {
        return ShellMatrixCase::skipped("git-bash", "Git Bash did not run a smoke command");
    }
    ShellMatrixCase::runnable(
        "git-bash",
        terminal_request(
            bash,
            vec![
                "--noprofile".to_owned(),
                "--norc".to_owned(),
                "-lc".to_owned(),
                format!(
                    "exec {} {}",
                    shell_quote(&msys_path(&node)),
                    shell_quote(&msys_path(node_script))
                ),
            ],
        ),
    )
}

#[cfg(target_os = "windows")]
fn discover_wsl_bash_case() -> ShellMatrixCase {
    let Some(wsl) = find_executable("wsl.exe") else {
        return ShellMatrixCase::skipped("wsl-bash", "wsl.exe not found on PATH");
    };
    if !command_status_success(Command::new(&wsl).args([
        "-e",
        "bash",
        "-lc",
        "printf kerminal-wsl-bash-ok",
    ])) {
        return ShellMatrixCase::skipped(
            "wsl-bash",
            "wsl.exe is present but default distro bash smoke failed",
        );
    }
    ShellMatrixCase::runnable(
        "wsl-bash",
        terminal_request(
            wsl,
            vec![
                "-e".to_owned(),
                "bash".to_owned(),
                "-lc".to_owned(),
                bash_harness_script(),
            ],
        ),
    )
}

#[cfg(not(target_os = "windows"))]
fn bash_request(shell: &Path, prefix_args: &[&str]) -> TerminalCreateRequest {
    let mut args = prefix_args
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    args.push(bash_harness_script());
    terminal_request(shell.to_path_buf(), args)
}

fn terminal_request(shell: PathBuf, args: Vec<String>) -> TerminalCreateRequest {
    TerminalCreateRequest {
        shell: Some(shell.to_string_lossy().into_owned()),
        args,
        rows: 24,
        cols: 80,
        ..TerminalCreateRequest::default()
    }
}

#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(git) = find_executable("git.exe") {
        if let Some(git_root) = git.parent().and_then(Path::parent) {
            candidates.push(git_root.join("bin").join("bash.exe"));
        }
    }
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(
            PathBuf::from(program_files)
                .join("Git")
                .join("bin")
                .join("bash.exe"),
        );
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(program_files_x86)
                .join("Git")
                .join("bin")
                .join("bash.exe"),
        );
    }
    if let Some(path_bash) = find_executable("bash.exe") {
        if !path_bash
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("\\windows\\system32\\bash.exe")
        {
            candidates.push(path_bash);
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn command_status_success(command: &mut Command) -> bool {
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn find_executable(program: &str) -> Option<PathBuf> {
    let program_path = Path::new(program);
    if program_path.components().count() > 1 {
        return program_path.is_file().then(|| program_path.to_path_buf());
    }

    let path_var = env::var_os("PATH")?;
    let extensions = executable_extensions(program);
    for dir in env::split_paths(&path_var) {
        for extension in &extensions {
            let candidate = dir.join(format!("{program}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_extensions(program: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        if Path::new(program).extension().is_some() {
            return vec![String::new()];
        }
        let pathext = env::var_os("PATHEXT")
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_owned());
        pathext
            .split(';')
            .filter(|extension| !extension.trim().is_empty())
            .map(|extension| extension.to_owned())
            .chain(std::iter::once(String::new()))
            .collect()
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![String::new()]
    }
}

#[cfg(target_os = "windows")]
fn powershell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn msys_path(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('\\', "/");
    if value.len() >= 3 && value.as_bytes()[1] == b':' && value.as_bytes()[2] == b'/' {
        let drive = value[0..1].to_ascii_lowercase();
        value = format!("/{drive}/{}", &value[3..]);
    }
    value
}

#[cfg(target_os = "windows")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn bash_harness_script() -> String {
    r#"set +e
paste_start="$(printf '\033[200~')"
paste_end="$(printf '\033[201~')"
ctrl_c="$(printf '\003')"
ctrl_d="$(printf '\004')"
unicode_expected="$(printf 'Kerminal\344\270\255\346\226\207\342\234\223')"
printf '\033[?1049hmatrix-alt-enter\n\033[?1049lmatrix-alt-exit\nmatrix-ready\n'
old_stty="$(stty -g 2>/dev/null)"
stty raw -echo min 0 time 1 2>/dev/null || true
buf=""
paste_ok=0
unicode_ok=0
ctrl_c_ok=0
trap 'if [ "$ctrl_c_ok" -eq 0 ]; then printf "matrix-ctrl-c-ok\n"; ctrl_c_ok=1; fi' INT
end=$((SECONDS + 8))
while [ "$SECONDS" -lt "$end" ]; do
  ch=""
  if ! IFS= read -r -s -n 1 ch; then
    if [ "$paste_ok" -eq 1 ] && [ "$unicode_ok" -eq 1 ] && [ "$ctrl_c_ok" -eq 1 ]; then
      printf 'matrix-ctrl-d-ok\n'
      break
    fi
    continue
  fi
  [ -z "$ch" ] && continue
  case "$ch" in
    "$ctrl_c")
      if [ "$ctrl_c_ok" -eq 0 ]; then printf 'matrix-ctrl-c-ok\n'; ctrl_c_ok=1; fi
      ;;
    "$ctrl_d")
      printf 'matrix-ctrl-d-ok\n'
      break
      ;;
  esac
  buf="${buf}${ch}"
  if [ "$paste_ok" -eq 0 ]; then
    case "$buf" in
      *"$paste_start"matrix-paste-payload"$paste_end"*) printf 'matrix-bracketed-paste-ok\n'; paste_ok=1 ;;
    esac
  fi
  if [ "$unicode_ok" -eq 0 ]; then
    case "$buf" in
      *"$unicode_expected"*) printf 'matrix-unicode-ok\n'; unicode_ok=1 ;;
    esac
  fi
done
if [ -n "$old_stty" ]; then stty "$old_stty" 2>/dev/null || true; fi
printf 'matrix-exit\n'
"#
    .to_owned()
}

const NODE_HARNESS: &str = r#"const expectedUnicode = "Kerminal\u4e2d\u6587\u2713";
const pastePayload = "\x1b[200~matrix-paste-payload\x1b[201~";
let buffer = "";
let pasteOk = false;
let unicodeOk = false;
let ctrlCOk = false;
let resizeOk = false;

function writeLine(line) {
  process.stdout.write(`${line}\n`);
}

function observeResize() {
  if (!resizeOk && process.stdout.columns === 101 && process.stdout.rows === 31) {
    resizeOk = true;
    writeLine("matrix-resize-ok");
  }
}

if (process.stdin.isTTY && process.stdin.setRawMode) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.write("\x1b[?1049hmatrix-alt-enter\n\x1b[?1049lmatrix-alt-exit\nmatrix-ready\n");
process.stdout.on("resize", observeResize);
setInterval(observeResize, 50).unref();

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  observeResize();
  if (!pasteOk && buffer.includes(pastePayload)) {
    pasteOk = true;
    writeLine("matrix-bracketed-paste-ok");
  }
  if (!unicodeOk && buffer.includes(expectedUnicode)) {
    unicodeOk = true;
    writeLine("matrix-unicode-ok");
  }
  if (!ctrlCOk && chunk.includes("\x03")) {
    ctrlCOk = true;
    writeLine("matrix-ctrl-c-ok");
  }
  if (chunk.includes("\x04")) {
    writeLine("matrix-ctrl-d-ok");
    process.exit(0);
  }
});

setTimeout(() => {
  writeLine(`matrix-timeout:${JSON.stringify(buffer)}`);
  process.exit(2);
}, 8000);
"#;
