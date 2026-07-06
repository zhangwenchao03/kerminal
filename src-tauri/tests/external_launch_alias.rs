//! External SSH launch compatibility alias tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    paths::KerminalPaths,
    services::external_launch::{
        default_external_launch_alias_directory, delete_external_launch_aliases,
        external_launch_alias_file_name, external_launch_alias_marker_path,
        external_launch_alias_path, generate_external_launch_aliases,
        inspect_external_launch_alias, ExternalLaunchAliasGenerateRequest,
        ExternalLaunchAliasInstallMode, ExternalLaunchAliasState, ExternalLaunchSourceTool,
    },
};
use tempfile::tempdir;

#[test]
fn alias_model_maps_personas_to_isolated_default_paths() {
    let root = tempdir().expect("temp root");
    let paths = KerminalPaths::from_root(root.path().join(".kerminal"));
    let alias_dir = default_external_launch_alias_directory(&paths);

    assert_eq!(
        alias_dir,
        paths
            .root
            .join("external-launch")
            .join("compatibility-aliases")
    );
    assert_eq!(
        external_launch_alias_file_name(ExternalLaunchSourceTool::Putty).expect("putty filename"),
        "putty.exe"
    );
    assert_eq!(
        external_launch_alias_file_name(ExternalLaunchSourceTool::Mobaxterm)
            .expect("mobaxterm filename"),
        "MobaXterm.exe"
    );
    assert_eq!(
        external_launch_alias_file_name(ExternalLaunchSourceTool::Openssh)
            .expect("openssh filename"),
        "ssh.exe"
    );
    assert!(
        external_launch_alias_file_name(ExternalLaunchSourceTool::KerminalNative).is_err(),
        "native Kerminal launch does not need a vendor compatibility filename"
    );
}

#[test]
fn alias_generation_copies_shim_and_supports_regeneration() {
    let root = tempdir().expect("temp root");
    let shim = root.path().join("kerminal-launch-shim.exe");
    let alias_dir = root.path().join("compat path with spaces");
    fs::write(&shim, "shim-v1").expect("write fake shim");

    let mut request = ExternalLaunchAliasGenerateRequest::new(
        &shim,
        &alias_dir,
        vec![ExternalLaunchSourceTool::Putty],
    );
    request.prefer_hard_link = false;
    let generated = generate_external_launch_aliases(request.clone()).expect("generate aliases");

    assert_eq!(generated.len(), 1);
    assert_eq!(generated[0].state, ExternalLaunchAliasState::Managed);
    assert_eq!(
        generated[0].install_mode,
        Some(ExternalLaunchAliasInstallMode::Copy)
    );
    assert_eq!(
        fs::read_to_string(&generated[0].alias_path).expect("read alias"),
        "shim-v1"
    );
    assert!(generated[0].marker_path.exists());

    fs::write(&shim, "shim-v2").expect("update fake shim");
    let regenerated = generate_external_launch_aliases(request).expect("regenerate aliases");

    assert_eq!(
        fs::read_to_string(&regenerated[0].alias_path).expect("read regenerated alias"),
        "shim-v2"
    );
    assert_eq!(
        inspect_external_launch_alias(&alias_dir, ExternalLaunchSourceTool::Putty)
            .expect("inspect alias")
            .state,
        ExternalLaunchAliasState::Managed
    );
}

#[test]
fn alias_generation_refuses_to_overwrite_non_kerminal_executable() {
    let root = tempdir().expect("temp root");
    let shim = root.path().join("kerminal-launch-shim.exe");
    let alias_dir = root.path().join("compat");
    let alias_path = external_launch_alias_path(&alias_dir, ExternalLaunchSourceTool::Mobaxterm)
        .expect("alias path");
    fs::create_dir_all(&alias_dir).expect("create alias dir");
    fs::write(&shim, "kerminal shim").expect("write fake shim");
    fs::write(&alias_path, "real third-party executable").expect("write third-party exe");

    let error = generate_external_launch_aliases(ExternalLaunchAliasGenerateRequest::new(
        &shim,
        &alias_dir,
        vec![ExternalLaunchSourceTool::Mobaxterm],
    ))
    .expect_err("non-managed executable must not be overwritten");

    assert!(error.to_string().contains("refusing to overwrite"));
    assert_eq!(
        fs::read_to_string(alias_path).expect("third-party exe unchanged"),
        "real third-party executable"
    );
}

#[test]
fn alias_generation_requires_kerminal_shim_source() {
    let root = tempdir().expect("temp root");
    let other_exe = root.path().join("putty.exe");
    let alias_dir = root.path().join("compat");
    fs::write(&other_exe, "third-party exe").expect("write non-shim source");

    let error = generate_external_launch_aliases(ExternalLaunchAliasGenerateRequest::new(
        &other_exe,
        &alias_dir,
        vec![ExternalLaunchSourceTool::Putty],
    ))
    .expect_err("non-shim source must not be copied");

    assert!(error.to_string().contains("Kerminal shim executable"));
}

#[test]
fn alias_generation_refuses_stale_marker_after_alias_is_replaced() {
    let root = tempdir().expect("temp root");
    let shim = root.path().join("kerminal-launch-shim.exe");
    let alias_dir = root.path().join("compat");
    fs::write(&shim, "kerminal shim").expect("write fake shim");

    let mut request = ExternalLaunchAliasGenerateRequest::new(
        &shim,
        &alias_dir,
        vec![ExternalLaunchSourceTool::Xshell],
    );
    request.prefer_hard_link = false;
    let generated = generate_external_launch_aliases(request.clone()).expect("generate alias");
    fs::write(&generated[0].alias_path, "replaced third-party executable")
        .expect("replace alias target");

    let inspection = inspect_external_launch_alias(&alias_dir, ExternalLaunchSourceTool::Xshell)
        .expect("inspect replaced alias");
    assert_eq!(inspection.state, ExternalLaunchAliasState::StaleMarker);

    let error = generate_external_launch_aliases(request)
        .expect_err("stale marker must not allow overwrite");
    assert!(error.to_string().contains("invalid Kerminal marker"));
}

#[test]
fn alias_deletion_removes_only_kerminal_managed_aliases() {
    let root = tempdir().expect("temp root");
    let shim = root.path().join("kerminal-launch-shim.exe");
    let alias_dir = root.path().join("compat");
    fs::write(&shim, "kerminal shim").expect("write fake shim");

    let generated = generate_external_launch_aliases(ExternalLaunchAliasGenerateRequest::new(
        &shim,
        &alias_dir,
        vec![ExternalLaunchSourceTool::Securecrt],
    ))
    .expect("generate alias");

    let removals =
        delete_external_launch_aliases(&alias_dir, &[ExternalLaunchSourceTool::Securecrt])
            .expect("delete managed alias");
    assert!(removals[0].removed_alias);
    assert!(removals[0].removed_marker);
    assert!(!generated[0].alias_path.exists());
    assert!(!generated[0].marker_path.exists());

    let alias_path = external_launch_alias_path(&alias_dir, ExternalLaunchSourceTool::Securecrt)
        .expect("alias path");
    fs::write(&alias_path, "real securecrt").expect("write non-managed alias");
    let error = delete_external_launch_aliases(&alias_dir, &[ExternalLaunchSourceTool::Securecrt])
        .expect_err("non-managed alias must not be deleted");
    assert!(error.to_string().contains("refusing to delete"));
    assert!(alias_path.exists());
}

#[test]
fn alias_deletion_cleans_stale_marker_when_alias_file_is_missing() {
    let root = tempdir().expect("temp root");
    let alias_dir = root.path().join("compat");
    let alias_path = external_launch_alias_path(&alias_dir, ExternalLaunchSourceTool::Openssh)
        .expect("alias path");
    let marker_path = external_launch_alias_marker_path(&alias_path);
    fs::create_dir_all(&alias_dir).expect("create alias dir");
    fs::write(&marker_path, "{}").expect("write stale marker");

    let removals = delete_external_launch_aliases(&alias_dir, &[ExternalLaunchSourceTool::Openssh])
        .expect("delete stale marker");

    assert!(!removals[0].removed_alias);
    assert!(removals[0].removed_marker);
    assert!(!marker_path.exists());
}
