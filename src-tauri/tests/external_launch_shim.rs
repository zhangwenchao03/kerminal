//! External SSH launch compatibility shim tests.
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::Duration,
};

use kerminal_lib::paths::KERMINAL_CONFIG_ROOT_ENV;
use kerminal_lib::services::external_launch::{
    build_external_launch_shim_envelope, external_launch_bridge_endpoint, infer_shim_persona,
    resolve_kerminal_main_executable, run_external_launch_bridge_server, ExternalLaunchEntrypoint,
    ExternalLaunchParserRegistry, ExternalLaunchSourceTool, KERMINAL_MAIN_EXE_ENV,
    KERMINAL_SHIM_PERSONA_ALIAS_ARG, KERMINAL_SHIM_PERSONA_ARG,
};
use tempfile::tempdir;

const SHIM_SECRET: &str = "KERM_SHIM_PASSWORD_DO_NOT_USE";

#[test]
fn shim_infers_persona_from_argv0_without_parsing_business_args() {
    assert_eq!(
        infer_shim_persona("C:\\tools\\putty.exe", None).expect("putty persona"),
        ExternalLaunchSourceTool::Putty
    );
    assert_eq!(
        infer_shim_persona("/opt/Kerminal/MobaXterm.exe", None).expect("moba persona"),
        ExternalLaunchSourceTool::Mobaxterm
    );
    assert_eq!(
        infer_shim_persona("ssh.exe", None).expect("openssh persona"),
        ExternalLaunchSourceTool::Openssh
    );
}

#[test]
fn shim_persona_arg_overrides_argv0_and_is_not_forwarded() {
    let envelope = build_external_launch_shim_envelope(
        vec![
            "kerminal-launch-shim.exe".to_owned(),
            KERMINAL_SHIM_PERSONA_ARG.to_owned(),
            "xshell".to_owned(),
            "-url".to_owned(),
            format!("ssh://deploy:{SHIM_SECRET}@shim.example.internal:2202"),
        ],
        Some("C:/work".to_owned()),
        None,
    )
    .expect("build shim envelope");

    assert_eq!(envelope.persona, ExternalLaunchSourceTool::Xshell);
    assert_eq!(envelope.cwd.as_deref(), Some("C:/work"));
    assert!(!envelope
        .argv
        .iter()
        .any(|arg| arg == KERMINAL_SHIM_PERSONA_ARG || arg == "xshell"));

    let request = ExternalLaunchParserRegistry::new()
        .parse(&envelope.parse_input())
        .expect("parse forwarded xshell argv");
    assert_eq!(request.source.entrypoint, ExternalLaunchEntrypoint::ShimIpc);
    assert_eq!(request.target.host, "shim.example.internal");
    assert_eq!(request.target.username.as_deref(), Some("deploy"));
    assert!(!format!("{envelope:?}").contains(SHIM_SECRET));
    assert!(!format!("{request:?}").contains(SHIM_SECRET));
}

#[test]
fn shim_persona_alias_arg_is_supported_for_manual_smoke() {
    let envelope = build_external_launch_shim_envelope(
        vec![
            "shim.exe".to_owned(),
            KERMINAL_SHIM_PERSONA_ALIAS_ARG.to_owned(),
            "putty".to_owned(),
            "-ssh".to_owned(),
            "ops@alias.example.internal".to_owned(),
            "-pw".to_owned(),
            SHIM_SECRET.to_owned(),
        ],
        None,
        None,
    )
    .expect("build shim envelope");

    assert_eq!(envelope.persona, ExternalLaunchSourceTool::Putty);
    assert_eq!(envelope.argv[0], "shim.exe");
    assert!(!envelope
        .argv
        .iter()
        .any(|arg| arg == KERMINAL_SHIM_PERSONA_ALIAS_ARG || arg == "putty"));
}

#[test]
fn shim_env_persona_fills_unknown_argv0() {
    let envelope = build_external_launch_shim_envelope(
        vec![
            "compat-launcher.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@env.example.internal".to_owned(),
        ],
        None,
        Some("putty".to_owned()),
    )
    .expect("build shim envelope");

    assert_eq!(envelope.persona, ExternalLaunchSourceTool::Putty);
}

#[test]
fn shim_requires_persona_for_unknown_argv0_without_override() {
    let error = build_external_launch_shim_envelope(
        vec![
            "compat-launcher.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@example.internal".to_owned(),
        ],
        None,
        None,
    )
    .expect_err("unknown persona should fail");

    assert!(!error.to_string().contains("ops@example.internal"));
}

#[test]
fn shim_main_executable_resolution_uses_distinct_sibling() {
    let root = tempdir().expect("temp root");
    let shim_path = root.path().join("putty.exe");
    let main_path = root.path().join("kerminal.exe");
    fs::write(&shim_path, "shim").expect("write shim");
    fs::write(&main_path, "main").expect("write main");

    assert_eq!(
        resolve_kerminal_main_executable(&shim_path).as_deref(),
        Some(main_path.as_path())
    );
}

#[tokio::test]
async fn shim_process_delivers_to_running_bridge_without_secret_output() {
    let root = tempdir().expect("temp kerminal root");
    let paths = kerminal_lib::paths::KerminalPaths::from_root(root.path());
    let endpoint = external_launch_bridge_endpoint(&paths.root);
    let intake = kerminal_lib::services::external_launch::ExternalLaunchIntake::new();
    let server = tokio::spawn(run_external_launch_bridge_server(
        endpoint,
        intake.clone(),
        Arc::new(|_| {}),
    ));
    tokio::time::sleep(Duration::from_millis(50)).await;

    let paths_root = paths.root.clone();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(shim_binary())
            .env(KERMINAL_CONFIG_ROOT_ENV, paths_root)
            .arg(KERMINAL_SHIM_PERSONA_ALIAS_ARG)
            .arg("putty")
            .arg("-ssh")
            .arg("ops@process.example.internal")
            .arg("-P")
            .arg("2204")
            .arg("-pw")
            .arg(SHIM_SECRET)
            .output()
    })
    .await
    .expect("join shim process")
    .expect("run shim process");

    assert!(
        output.status.success(),
        "shim process failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains(SHIM_SECRET));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(SHIM_SECRET));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].source.entrypoint,
        ExternalLaunchEntrypoint::ShimIpc
    );
    assert_eq!(pending[0].target.host, "process.example.internal");
    assert_eq!(pending[0].target.port, 2204);
    assert!(!format!("{pending:?}").contains(SHIM_SECRET));

    server.abort();
}

#[tokio::test]
async fn shim_process_from_path_with_spaces_delivers_to_running_bridge() {
    let root = tempdir().expect("temp kerminal root");
    let paths = kerminal_lib::paths::KerminalPaths::from_root(root.path());
    let endpoint = external_launch_bridge_endpoint(&paths.root);
    let intake = kerminal_lib::services::external_launch::ExternalLaunchIntake::new();
    let server = tokio::spawn(run_external_launch_bridge_server(
        endpoint,
        intake.clone(),
        Arc::new(|_| {}),
    ));
    tokio::time::sleep(Duration::from_millis(50)).await;

    let shim_path = copy_shim_to_path_with_spaces(root.path());
    let paths_root = paths.root.clone();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(shim_path)
            .env(KERMINAL_CONFIG_ROOT_ENV, paths_root)
            .arg("-ssh")
            .arg("ops@spaces.example.internal")
            .arg("-P")
            .arg("2205")
            .arg("-pw")
            .arg(SHIM_SECRET)
            .output()
    })
    .await
    .expect("join shim process")
    .expect("run shim process from path with spaces");

    assert!(
        output.status.success(),
        "shim process failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains(SHIM_SECRET));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(SHIM_SECRET));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].source.entrypoint,
        ExternalLaunchEntrypoint::ShimIpc
    );
    assert_eq!(pending[0].source.tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(pending[0].target.host, "spaces.example.internal");
    assert_eq!(pending[0].target.port, 2205);
    assert!(!format!("{pending:?}").contains(SHIM_SECRET));

    server.abort();
}

#[tokio::test]
async fn shim_process_retries_until_cold_start_bridge_is_available_without_secret_output() {
    let root = tempdir().expect("temp kerminal root");
    let paths = kerminal_lib::paths::KerminalPaths::from_root(root.path());
    let endpoint = external_launch_bridge_endpoint(&paths.root);
    let intake = kerminal_lib::services::external_launch::ExternalLaunchIntake::new();
    let paths_root = paths.root.clone();
    let main_exe = cold_start_placeholder_main_executable();

    let shim = tokio::task::spawn_blocking(move || {
        Command::new(shim_binary())
            .env(KERMINAL_CONFIG_ROOT_ENV, paths_root)
            .env(KERMINAL_MAIN_EXE_ENV, main_exe)
            .arg(KERMINAL_SHIM_PERSONA_ALIAS_ARG)
            .arg("putty")
            .arg("-ssh")
            .arg("ops@cold-start.example.internal")
            .arg("-P")
            .arg("2206")
            .arg("-pw")
            .arg(SHIM_SECRET)
            .output()
    });

    tokio::time::sleep(Duration::from_millis(600)).await;
    let server = tokio::spawn(run_external_launch_bridge_server(
        endpoint,
        intake.clone(),
        Arc::new(|_| {}),
    ));

    let output = shim
        .await
        .expect("join shim process")
        .expect("run shim process");

    assert!(
        output.status.success(),
        "shim process failed after cold-start retry: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains(SHIM_SECRET));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(SHIM_SECRET));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(
        pending[0].source.entrypoint,
        ExternalLaunchEntrypoint::ShimIpc
    );
    assert_eq!(pending[0].target.host, "cold-start.example.internal");
    assert_eq!(pending[0].target.port, 2206);
    assert!(!format!("{pending:?}").contains(SHIM_SECRET));

    server.abort();
}

#[tokio::test]
async fn shim_process_unavailable_bridge_error_is_redacted() {
    let root = tempdir().expect("temp kerminal root");
    let main_path = root.path().join(if cfg!(windows) {
        "missing-kerminal.exe"
    } else {
        "missing-kerminal"
    });

    let root_path = root.path().to_path_buf();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(shim_binary())
            .env(KERMINAL_CONFIG_ROOT_ENV, root_path)
            .env(KERMINAL_MAIN_EXE_ENV, main_path)
            .arg(KERMINAL_SHIM_PERSONA_ALIAS_ARG)
            .arg("putty")
            .arg("-ssh")
            .arg("ops@unavailable.example.internal")
            .arg("-pw")
            .arg(SHIM_SECRET)
            .output()
    })
    .await
    .expect("join shim process")
    .expect("run shim process");

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Kerminal main executable was not found")
            || stderr.contains("external launch shim")
            || stderr.contains("external launch bridge unavailable or timed out")
    );
    assert!(!stderr.contains(SHIM_SECRET));
    assert!(!stderr.contains("ops@unavailable.example.internal"));
}

fn shim_binary() -> &'static str {
    env!("CARGO_BIN_EXE_kerminal-launch-shim")
}

fn copy_shim_to_path_with_spaces(root: &Path) -> PathBuf {
    let install_dir = root
        .join("Program Files")
        .join("Kerminal Compatibility Shim");
    fs::create_dir_all(&install_dir).expect("create shim directory with spaces");
    let shim_path = install_dir.join("putty.exe");
    fs::copy(shim_binary(), &shim_path).expect("copy shim binary");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(&shim_path)
            .expect("shim metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&shim_path, permissions).expect("set executable permissions");
    }
    shim_path
}

fn cold_start_placeholder_main_executable() -> PathBuf {
    if cfg!(windows) {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        return system_root.join("System32").join("where.exe");
    }
    PathBuf::from("/bin/true")
}
