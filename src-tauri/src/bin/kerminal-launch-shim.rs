#![cfg_attr(windows, windows_subsystem = "windows")]

//! Kerminal external SSH launch compatibility shim.
//!
//! @author kongweiguang

use std::{
    env,
    fs::OpenOptions,
    io::Write,
    path::Path,
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use kerminal_lib::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    services::external_launch::{
        build_external_launch_shim_envelope, external_launch_bridge_endpoint,
        resolve_kerminal_main_executable, send_external_launch_bridge_envelope,
        ExternalLaunchBridgeEnvelope, KERMINAL_SHIM_PERSONA_ENV,
    },
};

const FIRST_DELIVERY_TIMEOUT: Duration = Duration::from_millis(250);
const COLD_START_DELIVERY_TIMEOUT: Duration = Duration::from_secs(8);

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{}", redacted_error_message(error));
        std::process::exit(1);
    }
}

async fn run() -> AppResult<()> {
    let current_exe = env::current_exe()?;
    let envelope = build_external_launch_shim_envelope(
        env::args().collect(),
        env::current_dir()
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
        env::var(KERMINAL_SHIM_PERSONA_ENV).ok(),
    )?;
    let parent_command_line = if should_capture_parent_command_line(&envelope) {
        discover_parent_command_line()
    } else {
        None
    };
    let envelope = envelope.with_parent_command_line(parent_command_line);
    let paths = KerminalPaths::from_environment_or_current_home()?;
    let endpoint = external_launch_bridge_endpoint(&paths.root);
    let log_path = paths.logs.join("external-launch-shim.log");
    write_shim_log(
        &log_path,
        &format!(
            "received persona={:?} argv_count={} cwd_present={}",
            envelope.persona,
            envelope.argv.len(),
            envelope.cwd.is_some()
        ),
    );

    match send_external_launch_bridge_envelope(&endpoint, envelope.clone(), FIRST_DELIVERY_TIMEOUT)
        .await
    {
        Ok(response) if response.ok => {
            write_shim_log(
                &log_path,
                &format!(
                    "delivered_running request_hash_present={} pending_count={}",
                    response.request_hash.is_some(),
                    response.pending_count
                ),
            );
            return Ok(());
        }
        Ok(response) => {
            write_shim_log(
                &log_path,
                &format!("rejected_running message={:?}", response.message),
            );
            return Err(AppError::InvalidInput(response.message.unwrap_or_else(
                || "external launch bridge rejected request".to_owned(),
            )));
        }
        Err(error) => {
            write_shim_log(
                &log_path,
                &format!(
                    "bridge_unavailable_first_try error={}",
                    redacted_error_message(error)
                ),
            );
        }
    }

    let main_exe = resolve_kerminal_main_executable(&current_exe).ok_or_else(|| {
        AppError::InvalidInput("Kerminal main executable was not found".to_owned())
    })?;
    write_shim_log(&log_path, "starting_main path_present=true");
    start_kerminal_main(&main_exe)?;
    deliver_after_cold_start(&endpoint, envelope, &log_path).await
}

async fn deliver_after_cold_start(
    endpoint: &kerminal_lib::services::external_launch::ExternalLaunchBridgeEndpoint,
    envelope: ExternalLaunchBridgeEnvelope,
    log_path: &Path,
) -> AppResult<()> {
    match send_external_launch_bridge_envelope(endpoint, envelope, COLD_START_DELIVERY_TIMEOUT)
        .await
    {
        Ok(response) if response.ok => {
            write_shim_log(
                log_path,
                &format!(
                    "delivered_after_cold_start request_hash_present={} pending_count={}",
                    response.request_hash.is_some(),
                    response.pending_count
                ),
            );
            Ok(())
        }
        Ok(response) => {
            write_shim_log(
                log_path,
                &format!("rejected_after_cold_start message={:?}", response.message),
            );
            Err(AppError::InvalidInput(response.message.unwrap_or_else(
                || "external launch bridge rejected request".to_owned(),
            )))
        }
        Err(error) => {
            write_shim_log(
                log_path,
                &format!(
                    "bridge_unavailable_after_cold_start error={}",
                    redacted_error_message(error)
                ),
            );
            Err(AppError::InvalidInput(
                "external launch bridge unavailable or timed out".to_owned(),
            ))
        }
    }
}

fn start_kerminal_main(path: &Path) -> AppResult<()> {
    Command::new(path).spawn()?;
    Ok(())
}

fn write_shim_log(path: &Path, message: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned());
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{timestamp} {message}");
    }
}

fn should_capture_parent_command_line(envelope: &ExternalLaunchBridgeEnvelope) -> bool {
    envelope.persona.as_str() == "mobaxterm"
        && envelope
            .argv
            .iter()
            .any(|value| value.to_ascii_lowercase().ends_with(".moba"))
}

#[cfg(windows)]
fn discover_parent_command_line() -> Option<String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let script = format!(
        "$p=Get-CimInstance Win32_Process -Filter 'ProcessId = {}'; \
         if ($p) {{ \
           $pp=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $p.ParentProcessId); \
           if ($pp) {{ [Console]::Out.Write($pp.CommandLine) }} \
         }}",
        std::process::id()
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!value.is_empty()).then_some(value)
}

#[cfg(not(windows))]
fn discover_parent_command_line() -> Option<String> {
    None
}

fn redacted_error_message(error: AppError) -> String {
    match error {
        AppError::InvalidInput(message) if message.contains("external launch") => message,
        AppError::InvalidInput(_) => "external launch shim rejected request".to_owned(),
        AppError::HomeDirectoryUnavailable => {
            "external launch shim home directory unavailable".to_owned()
        }
        AppError::Io(_) => "external launch shim I/O failed".to_owned(),
        _ => "external launch shim failed".to_owned(),
    }
}
