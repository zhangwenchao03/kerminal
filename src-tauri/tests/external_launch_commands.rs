//! External SSH launch command DTO tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    commands::external_launch::{
        external_launch_alias_delete_for_paths, external_launch_alias_generate_for_paths,
        external_launch_alias_status_for_paths, external_launch_snapshot_to_dto,
        external_ssh_launch_request_to_dto, ExternalLaunchAliasCommandRequestDto,
    },
    paths::KerminalPaths,
    services::external_launch::{
        ExternalLaunchEntrypoint, ExternalLaunchIntake, ExternalLaunchParseInput,
        ExternalLaunchParserRegistry, ExternalLaunchPolicy, ExternalLaunchSecretBroker,
        ExternalLaunchSourceTool, ExternalLaunchTaskSnapshot,
    },
};
use tempfile::tempdir;

#[test]
fn command_dto_exposes_only_redacted_auth_metadata() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Putty,
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "2202".to_owned(),
                "-pw".to_owned(),
                "KERM_COMMAND_DTO_SECRET_DO_NOT_USE".to_owned(),
            ],
        ))
        .expect("parse putty launch");
    let request = ExternalLaunchSecretBroker::new()
        .protect_request(request)
        .expect("protect secret");

    let dto = external_ssh_launch_request_to_dto(request);
    let json = serde_json::to_string(&dto).expect("serialize dto");

    assert_eq!(dto.target.host, "example.internal");
    assert_eq!(dto.target.username.as_deref(), Some("ops"));
    assert_eq!(dto.target.port, 2202);
    assert!(dto.auth.has_password);
    assert!(!dto.auth.has_key_passphrase);
    assert!(!dto.auth.password_file_present);
    assert!(dto.auth.identity_file.is_none());
    let diagnostics_json =
        serde_json::to_string(&dto.diagnostics).expect("serialize public diagnostics");
    assert!(!diagnostics_json.contains("example.internal"));
    assert!(!diagnostics_json.contains("ops"));
    assert!(dto
        .diagnostics
        .argv_redacted
        .iter()
        .all(|arg| matches!(arg.as_str(), "<executable>" | "<option>" | "<argument>")));
    assert!(!json.contains("KERM_COMMAND_DTO_SECRET_DO_NOT_USE"));
    assert!(!json.contains("external-secret:"));
}

#[test]
fn command_dto_does_not_expose_password_file_path() {
    let temp = tempfile::tempdir().expect("tempdir");
    let password_path = temp.path().join("external-password.txt");
    fs::write(&password_path, "KERM_COMMAND_DTO_PASSFILE_SECRET\n").expect("write password");

    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Putty,
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "backup@backup.internal".to_owned(),
                "-pwfile".to_owned(),
                password_path.to_string_lossy().into_owned(),
            ],
        ))
        .expect("parse password file launch");
    let request = ExternalLaunchSecretBroker::new()
        .protect_request(request)
        .expect("protect password file");

    let dto = external_ssh_launch_request_to_dto(request);
    let json = serde_json::to_string(&dto).expect("serialize dto");

    assert!(dto.auth.has_password);
    assert!(dto.auth.password_file_present);
    assert!(!json.contains("KERM_COMMAND_DTO_PASSFILE_SECRET"));
    assert!(!json.contains("external-password.txt"));
    assert!(!json.contains("external-secret:"));
}

#[test]
fn snapshot_dto_exposes_policy_without_secret_refs() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        disabled_tools: vec![ExternalLaunchSourceTool::Xshell],
        ..ExternalLaunchPolicy::default()
    });
    intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@snapshot.example.internal".to_owned(),
                "-pw".to_owned(),
                "KERM_COMMAND_SNAPSHOT_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept launch");
    let claimed = intake.take_pending().expect("claim launch");
    let claimed_launch_id = claimed[0].id.clone();

    let dto = external_launch_snapshot_to_dto(
        intake.snapshot().expect("intake snapshot"),
        intake.secret_broker().snapshot().expect("secret snapshot"),
        ExternalLaunchTaskSnapshot::default(),
    );
    let json = serde_json::to_string(&dto).expect("serialize snapshot dto");

    assert_eq!(dto.intake.pending_count, 0);
    assert_eq!(dto.intake.claimed_count, 1);
    assert_eq!(dto.intake.claimed_request_hashes.len(), 1);
    assert_eq!(dto.intake.claimed_request_hashes[0].len(), 12);
    assert!(dto
        .intake
        .policy
        .disabled_tools
        .contains(&ExternalLaunchSourceTool::Xshell));
    assert_eq!(dto.secrets.active_secret_count, 1);
    assert_eq!(dto.tasks, Default::default());
    assert_eq!(
        dto.secrets.request_hashes,
        dto.intake.claimed_request_hashes
    );
    assert!(!json.contains(&claimed_launch_id));
    assert!(!json.contains("KERM_COMMAND_SNAPSHOT_SECRET_DO_NOT_USE"));
    assert!(!json.contains("external-secret:"));
}

#[test]
fn alias_status_dto_reports_default_install_and_alias_paths() {
    let temp = tempdir().expect("tempdir");
    let install_dir = temp.path().join("Kerminal");
    fs::create_dir_all(&install_dir).expect("create install dir");
    let current_exe = install_dir.join("kerminal.exe");
    let shim = install_dir.join("kerminal-launch-shim.exe");
    fs::write(&current_exe, "main").expect("write main");
    fs::write(&shim, "shim").expect("write shim");
    let paths = KerminalPaths::from_root(temp.path().join(".kerminal"));

    let status = external_launch_alias_status_for_paths(&paths, current_exe).expect("alias status");

    let install_dir_text = path_text(&install_dir);
    assert_eq!(
        status.install_directory.as_deref(),
        Some(install_dir_text.as_str())
    );
    assert_eq!(status.shim_executable, path_text(&shim));
    assert!(status.shim_available);
    assert_eq!(
        status.alias_directory,
        path_text(
            paths
                .root
                .join("external-launch")
                .join("compatibility-aliases")
        )
    );
    assert_eq!(status.aliases.len(), 5);
    assert!(status
        .aliases
        .iter()
        .all(|alias| alias.tool != ExternalLaunchSourceTool::KerminalNative));
}

#[test]
fn alias_generate_and_delete_commands_use_safe_defaults() {
    let temp = tempdir().expect("tempdir");
    let install_dir = temp.path().join("Kerminal");
    fs::create_dir_all(&install_dir).expect("create install dir");
    let current_exe = install_dir.join("kerminal.exe");
    let shim = install_dir.join("kerminal-launch-shim.exe");
    fs::write(&current_exe, "main").expect("write main");
    fs::write(&shim, "shim").expect("write shim");
    let paths = KerminalPaths::from_root(temp.path().join(".kerminal"));
    let alias_dir = temp.path().join("compat with spaces");

    let generated = external_launch_alias_generate_for_paths(
        &paths,
        current_exe.clone(),
        ExternalLaunchAliasCommandRequestDto {
            alias_directory: Some(path_text(&alias_dir)),
            prefer_hard_link: Some(false),
            shim_executable: None,
            tools: Some(vec![ExternalLaunchSourceTool::Putty]),
        },
    )
    .expect("generate alias");

    assert_eq!(generated.len(), 1);
    assert_eq!(generated[0].tool, ExternalLaunchSourceTool::Putty);
    assert!(generated[0].alias_path.ends_with("putty.exe"));
    assert!(alias_dir.join("putty.exe").exists());

    let deleted = external_launch_alias_delete_for_paths(
        &paths,
        current_exe,
        ExternalLaunchAliasCommandRequestDto {
            alias_directory: Some(path_text(&alias_dir)),
            prefer_hard_link: None,
            shim_executable: None,
            tools: Some(vec![ExternalLaunchSourceTool::Putty]),
        },
    )
    .expect("delete alias");

    assert_eq!(deleted.len(), 1);
    assert!(deleted[0].removed_alias);
    assert!(!alias_dir.join("putty.exe").exists());
}

#[test]
fn alias_generate_command_refuses_non_kerminal_alias_targets() {
    let temp = tempdir().expect("tempdir");
    let install_dir = temp.path().join("Kerminal");
    let alias_dir = temp.path().join("compat");
    fs::create_dir_all(&install_dir).expect("create install dir");
    fs::create_dir_all(&alias_dir).expect("create alias dir");
    let current_exe = install_dir.join("kerminal.exe");
    let shim = install_dir.join("kerminal-launch-shim.exe");
    fs::write(&current_exe, "main").expect("write main");
    fs::write(&shim, "shim").expect("write shim");
    fs::write(alias_dir.join("MobaXterm.exe"), "real mobaxterm").expect("write real exe");
    let paths = KerminalPaths::from_root(temp.path().join(".kerminal"));

    let error = external_launch_alias_generate_for_paths(
        &paths,
        current_exe,
        ExternalLaunchAliasCommandRequestDto {
            alias_directory: Some(path_text(&alias_dir)),
            prefer_hard_link: None,
            shim_executable: None,
            tools: Some(vec![ExternalLaunchSourceTool::Mobaxterm]),
        },
    )
    .expect_err("must refuse third-party alias target");

    assert!(error.to_string().contains("refusing to overwrite"));
    assert_eq!(
        fs::read_to_string(alias_dir.join("MobaXterm.exe")).expect("third-party target unchanged"),
        "real mobaxterm"
    );
}

fn path_text(path: impl AsRef<std::path::Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}
