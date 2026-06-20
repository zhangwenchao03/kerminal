//! 终端 Profile 服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::profile::{ProfileCreateRequest, ProfileUpdateRequest},
    paths::KerminalPaths,
    state::AppState,
};
use std::collections::HashMap;
use tempfile::{tempdir, TempDir};

#[test]
fn initialization_seeds_detected_terminal_profiles() {
    let (_home, state) = test_state();

    let profiles = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list seeded profiles");

    assert!(!profiles.is_empty());
    assert_eq!(
        profiles.iter().filter(|profile| profile.is_default).count(),
        1
    );
    assert!(profiles.iter().all(|profile| !profile.name.is_empty()));
    assert!(profiles.iter().all(|profile| !profile.shell.is_empty()));
}

#[test]
fn create_profile_persists_structured_args_env_and_default_flag() {
    let (_home, state) = test_state();
    let cwd = tempdir().expect("create cwd");

    let created = state
        .profiles()
        .create_profile(
            state.storage(),
            ProfileCreateRequest {
                name: "项目 PowerShell".to_owned(),
                shell: "pwsh.exe".to_owned(),
                args: vec!["-NoLogo".to_owned()],
                cwd: Some(cwd.path().to_string_lossy().into_owned()),
                env: HashMap::from([("RUST_LOG".to_owned(), "debug".to_owned())]),
                set_default: true,
            },
        )
        .expect("create profile");

    assert_eq!(created.name, "项目 PowerShell");
    assert_eq!(created.args, vec!["-NoLogo"]);
    assert_eq!(created.env.get("RUST_LOG"), Some(&"debug".to_owned()));
    assert!(created.is_default);

    let profiles = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list profiles");
    assert_eq!(
        profiles.iter().filter(|profile| profile.is_default).count(),
        1
    );
    assert_eq!(
        profiles
            .iter()
            .find(|profile| profile.is_default)
            .map(|profile| profile.id.as_str()),
        Some(created.id.as_str())
    );
}

#[test]
fn update_profile_keeps_existing_default_unless_replaced() {
    let (_home, state) = test_state();
    let original_default = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list profiles")
        .into_iter()
        .find(|profile| profile.is_default)
        .expect("default profile exists");

    let updated = state
        .profiles()
        .update_profile(
            state.storage(),
            ProfileUpdateRequest {
                id: original_default.id.clone(),
                name: "默认终端".to_owned(),
                shell: original_default.shell.clone(),
                args: original_default.args.clone(),
                cwd: original_default.cwd.clone(),
                env: original_default.env.clone(),
                set_default: false,
                sort_order: original_default.sort_order,
            },
        )
        .expect("update profile");

    assert_eq!(updated.name, "默认终端");
    assert!(updated.is_default);
}

#[test]
fn delete_default_profile_reassigns_default_and_keeps_last_profile() {
    let (_home, state) = test_state();
    let created = state
        .profiles()
        .create_profile(
            state.storage(),
            ProfileCreateRequest {
                name: "临时终端".to_owned(),
                shell: "cmd.exe".to_owned(),
                args: Vec::new(),
                cwd: None,
                env: HashMap::new(),
                set_default: true,
            },
        )
        .expect("create default profile");

    assert!(state
        .profiles()
        .delete_profile(state.storage(), &created.id)
        .expect("delete default profile"));

    let mut profiles = state
        .profiles()
        .list_profiles(state.storage())
        .expect("list profiles after delete");
    assert_eq!(
        profiles.iter().filter(|profile| profile.is_default).count(),
        1
    );

    while profiles.len() > 1 {
        let removable = profiles
            .iter()
            .find(|profile| !profile.is_default)
            .unwrap_or(&profiles[0])
            .id
            .clone();
        state
            .profiles()
            .delete_profile(state.storage(), &removable)
            .expect("delete non-last profile");
        profiles = state
            .profiles()
            .list_profiles(state.storage())
            .expect("list remaining profiles");
    }

    let error = state
        .profiles()
        .delete_profile(state.storage(), &profiles[0].id)
        .expect_err("reject deleting last profile");
    assert!(matches!(error, AppError::InvalidInput(_)));
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}
