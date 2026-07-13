//! Bridge 的父进程发现辅助函数。
//!
//! @author kongweiguang

use std::{path::Path, time::Duration};

const PARENT_DISCOVERY_TIMEOUT: Duration = Duration::from_millis(1_500);
const PARENT_WORKER_TIMEOUT: Duration = Duration::from_secs(4);

pub(super) fn direct_parent_command_line_for_args_impl(argv: &[String]) -> Option<String> {
    if !should_capture_direct_parent_command_line(argv) {
        return None;
    }
    discover_parent_command_line()
        .filter(|value| looks_like_bhost_command_line(value))
        .or_else(|| discover_bhost_parent_command_line_for_args(argv))
}

pub(super) async fn direct_parent_command_line_for_args_bounded_impl(
    argv: Vec<String>,
) -> Option<String> {
    if !should_capture_direct_parent_command_line(&argv) {
        return None;
    }
    let worker =
        tokio::task::spawn_blocking(move || direct_parent_command_line_for_args_impl(&argv));
    match tokio::time::timeout(PARENT_WORKER_TIMEOUT, worker).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            tauri_plugin_log::log::warn!(
                target: "external_launch.intake",
                "parent discovery worker failed: {error}"
            );
            None
        }
        Err(_) => {
            tauri_plugin_log::log::warn!(
                target: "external_launch.intake",
                "parent discovery worker timed out"
            );
            None
        }
    }
}

fn should_capture_direct_parent_command_line(argv: &[String]) -> bool {
    argv.iter()
        .skip(1)
        .any(|value| value.to_ascii_lowercase().ends_with(".moba"))
}

#[cfg(windows)]
fn discover_parent_command_line() -> Option<String> {
    let script = format!(
        "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = {}'; \
         if ($p) {{ $pp=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $p.ParentProcessId); \
         if ($pp) {{ [Console]::Out.Write($pp.CommandLine) }} }}",
        std::process::id()
    );
    run_powershell_discovery(&script)
}

#[cfg(windows)]
fn discover_bhost_parent_command_line_for_args(argv: &[String]) -> Option<String> {
    let session_name = argv
        .iter()
        .skip(1)
        .find(|value| value.to_ascii_lowercase().ends_with(".moba"))
        .and_then(|value| {
            Path::new(value)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
        .filter(|value| !value.trim().is_empty())?;
    let session_name = powershell_single_quote(&session_name);
    let script = format!(
        "$session={session_name}; Get-CimInstance Win32_Process -Filter \"Name = 'bhmultauth.exe'\" | \
         Where-Object {{ $_.CommandLine -and $_.CommandLine -like '*kerminal*' -and $_.CommandLine -like ('*' + $session + '*') }} | \
         Sort-Object CreationDate -Descending | Select-Object -First 1 -ExpandProperty CommandLine"
    );
    run_powershell_discovery(&script)
}

#[cfg(windows)]
fn run_powershell_discovery(script: &str) -> Option<String> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        thread,
        time::Instant,
    };

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + PARENT_DISCOVERY_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                if !status.success() {
                    return None;
                }
                let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                return (!value.is_empty()).then_some(value);
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(not(windows))]
fn discover_bhost_parent_command_line_for_args(_argv: &[String]) -> Option<String> {
    None
}

#[cfg(not(windows))]
fn discover_parent_command_line() -> Option<String> {
    None
}

fn looks_like_bhost_command_line(value: &str) -> bool {
    value
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase()
        .contains("bhmultauth.exe")
}

fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
