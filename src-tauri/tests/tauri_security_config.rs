use serde_json::Value;
use std::{fs, path::PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_json(path: impl Into<PathBuf>) -> Value {
    let path = path.into();
    let content = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&content)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn read_text(path: impl Into<PathBuf>) -> String {
    let path = path.into();
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
}

#[test]
fn tauri_config_enables_strict_production_csp_and_dev_csp() {
    let config = read_json(manifest_dir().join("tauri.conf.json"));
    let security = &config["app"]["security"];

    let csp = security["csp"]
        .as_str()
        .expect("production CSP must be a string");
    assert!(csp.contains("default-src 'self'"));
    assert!(csp.contains("connect-src 'self' ipc: http://ipc.localhost"));
    assert!(csp.contains("object-src 'none'"));
    assert!(csp.contains("frame-ancestors 'none'"));
    assert!(!csp.contains("localhost:1425"));
    assert!(!csp.contains("ws://"));
    assert!(!csp.contains("'unsafe-eval'"));

    let dev_csp = security["devCsp"]
        .as_str()
        .expect("development CSP must be a string");
    assert!(dev_csp.contains("http://localhost:1425"));
    assert!(dev_csp.contains("ws://localhost:1425"));
    assert!(dev_csp.contains("http://127.0.0.1:1425"));
    assert!(dev_csp.contains("ws://127.0.0.1:1425"));
    assert!(dev_csp.contains("'unsafe-eval'"));

    // Keep this disabled until the WebView/xterm startup path is verified with
    // prototype freezing enabled. The production CSP still carries the primary
    // hardening guarantees checked above.
    assert_eq!(security["freezePrototype"], false);
    assert_eq!(security["capabilities"], serde_json::json!(["default"]));
}

#[test]
fn default_capability_grants_core_and_custom_titlebar_window_access_to_main_window() {
    let capability = read_json(manifest_dir().join("capabilities/default.json"));

    assert_eq!(capability["identifier"], "default");
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert_eq!(
        capability["permissions"],
        serde_json::json!([
            "core:default",
            "dialog:default",
            "core:window:allow-start-dragging",
            "core:window:allow-minimize",
            "core:window:allow-toggle-maximize",
            "core:window:allow-close"
        ])
    );

    let permissions = capability["permissions"]
        .as_array()
        .expect("permissions must be an array");
    let forbidden_prefixes = ["opener:", "fs:", "shell:", "process:", "http:"];
    for permission in permissions {
        let permission = permission
            .as_str()
            .expect("default capability permissions must be string ids");
        if permission.starts_with("dialog:") {
            assert_eq!(
                permission, "dialog:default",
                "dialog permission must stay limited to the default scope"
            );
        }
        assert!(
            !forbidden_prefixes
                .iter()
                .any(|prefix| permission.starts_with(prefix)),
            "unexpected high-risk permission in default capability: {permission}",
        );
    }
}

#[test]
fn main_window_uses_app_drawn_titlebar_with_file_drop_events_for_sftp() {
    let config = read_json(manifest_dir().join("tauri.conf.json"));
    let windows = config["app"]["windows"]
        .as_array()
        .expect("windows must be an array");
    let main_window = windows.first().expect("main window must be configured");

    assert_eq!(main_window["title"], "Kerminal");
    assert_eq!(main_window["decorations"], false);
    assert_eq!(main_window["dragDropEnabled"], true);
}

#[test]
fn configured_bundle_icons_exist() {
    let manifest = manifest_dir();
    let config = read_json(manifest.join("tauri.conf.json"));
    let icons = config["bundle"]["icon"]
        .as_array()
        .expect("bundle icons must be an array");

    assert!(
        !icons.is_empty(),
        "at least one bundle icon must be configured"
    );
    assert!(
        icons.iter().any(|icon| icon == "icons/icon.ico"),
        "Windows taskbar/app executable icon must be configured"
    );
    for icon in icons {
        let icon = icon
            .as_str()
            .expect("bundle icon entries must be string paths");
        let path = manifest.join(icon);
        assert!(path.exists(), "configured bundle icon must exist: {icon}");
        assert!(
            fs::metadata(&path)
                .unwrap_or_else(|error| panic!("failed to stat {}: {error}", path.display()))
                .len()
                > 0,
            "configured bundle icon must not be empty: {icon}",
        );
    }
}

#[test]
fn unused_opener_plugin_is_not_registered_or_declared() {
    let manifest = manifest_dir();
    let cargo_toml = read_text(manifest.join("Cargo.toml"));
    let lib_rs = read_text(manifest.join("src/lib.rs"));
    let package_json = read_text(manifest.join("../package.json"));

    assert!(!cargo_toml.contains("tauri-plugin-opener"));
    assert!(!lib_rs.contains("tauri_plugin_opener"));
    assert!(!package_json.contains("@tauri-apps/plugin-opener"));
}
