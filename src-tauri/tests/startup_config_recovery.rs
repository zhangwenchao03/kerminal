//! 损坏配置启动恢复的进程级回归测试。
//!
//! @author kongweiguang

use std::{
    env, fs,
    process::{Command, Stdio},
};

use kerminal_lib::{paths::KerminalPaths, state::AppState};

const CHILD_HOME_ENV: &str = "KERMINAL_STARTUP_RECOVERY_CHILD_HOME";
const SETTINGS_SOURCE: &str = "schema_version = 1\n[appearance\ntheme = \"secret-theme\"\n";
const PROFILE_SOURCE: &str = "schema_version = 1\nid = [\nsecret = \"do-not-log\"\n";

#[test]
fn corrupt_settings_and_profile_restart_in_read_only_recovery() {
    let home = tempfile::tempdir().expect("temp home");
    let root = KerminalPaths::from_home_dir(home.path()).root;
    fs::create_dir_all(root.join("profiles")).expect("create profiles directory");
    fs::write(root.join("settings.toml"), SETTINGS_SOURCE).expect("write corrupt settings");
    fs::write(root.join("profiles/corrupt.toml"), PROFILE_SOURCE).expect("write corrupt profile");

    let output = Command::new(env::current_exe().expect("current test executable"))
        .args([
            "--exact",
            "startup_recovery_child_process",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_HOME_ENV, home.path())
        .stdin(Stdio::null())
        .output()
        .expect("spawn recovery child");

    assert!(
        output.status.success(),
        "recovery child failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(root.join("settings.toml")).expect("read settings after restart"),
        SETTINGS_SOURCE
    );
    assert_eq!(
        fs::read_to_string(root.join("profiles/corrupt.toml")).expect("read profile after restart"),
        PROFILE_SOURCE
    );

    let diagnostics = String::from_utf8(output.stdout).expect("utf-8 diagnostics");
    assert!(diagnostics.contains("settings.toml"));
    assert!(diagnostics.contains("profiles/*.toml"));
    assert!(diagnostics.contains("read-only"));
    assert!(!diagnostics.contains(home.path().to_string_lossy().as_ref()));
    assert!(!diagnostics.contains("secret-theme"));
    assert!(!diagnostics.contains("do-not-log"));
}

#[test]
fn startup_recovery_child_process() {
    let Some(home) = env::var_os(CHILD_HOME_ENV) else {
        return;
    };
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home))
        .expect("initialize app state in read-only recovery");
    let snapshot = state.startup_recovery();
    assert!(snapshot.read_only);
    assert_eq!(snapshot.diagnostics.len(), 2);
    assert_eq!(
        state
            .settings()
            .load_settings()
            .expect("load fallback settings"),
        Default::default()
    );
    assert!(state.update_settings(Default::default()).is_err());
    let profiles = state
        .profiles()
        .list_profiles()
        .expect("load fallback profiles");
    assert!(!profiles.is_empty());
    assert!(state.profiles().delete_profile(&profiles[0].id).is_err());
    println!("{snapshot:?}");
}
