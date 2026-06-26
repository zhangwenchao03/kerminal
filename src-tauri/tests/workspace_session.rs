//! Workspace session file-backed command tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    commands::workspace_session::{workspace_session_load, workspace_session_save},
    paths::KerminalPaths,
    state::AppState,
};
use serde_json::json;
use tauri::Manager;

#[test]
fn workspace_session_load_missing_returns_none() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, _paths) = mock_app(home.path());

    let loaded = workspace_session_load(app.state::<AppState>()).expect("load workspace session");

    assert_eq!(loaded, None);
}

#[test]
fn workspace_session_save_writes_workspace_session_json_and_loads_it_back() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session = json!({
        "schemaVersion": 1,
        "activeTabId": "tab-main",
        "focusedPaneId": "pane-1"
    });

    workspace_session_save(app.state::<AppState>(), session.clone()).expect("save workspace");

    let session_path = paths.root.join("workspace").join("session.json");
    assert!(session_path.is_file());
    let raw = fs::read_to_string(&session_path).expect("session file");
    assert!(raw.ends_with('\n'));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&raw).expect("json"),
        session
    );
    assert_eq!(
        workspace_session_load(app.state::<AppState>()).expect("load workspace"),
        Some(session)
    );
}

#[test]
fn workspace_session_save_rejects_non_object_json() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());

    let error =
        workspace_session_save(app.state::<AppState>(), json!(["not", "object"])).expect_err("err");

    assert!(error.contains("workspace session"));
    assert!(!paths.root.join("workspace").join("session.json").exists());
}

#[test]
fn workspace_session_load_bad_or_non_object_json_returns_none() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session_path = paths.root.join("workspace").join("session.json");
    fs::create_dir_all(session_path.parent().expect("parent")).expect("mkdir");

    fs::write(&session_path, "not json").expect("write bad json");
    assert_eq!(
        workspace_session_load(app.state::<AppState>()).expect("load bad json"),
        None
    );

    fs::write(&session_path, "[]").expect("write array json");
    assert_eq!(
        workspace_session_load(app.state::<AppState>()).expect("load non object"),
        None
    );
}

fn mock_app(home: &std::path::Path) -> (tauri::App<tauri::test::MockRuntime>, KerminalPaths) {
    let paths = KerminalPaths::from_home_dir(home);
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    (app, paths)
}
