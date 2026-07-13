//! External SSH launch secret broker tests.
//!
//! @author kongweiguang

use std::{fs, thread, time::Duration};

use kerminal_lib::services::external_launch::{
    ExternalLaunchParseInput, ExternalLaunchParserRegistry, ExternalLaunchSecretBroker,
    ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretSlot, ExternalSecretSource,
};

#[test]
fn broker_converts_command_line_password_to_session_ref_and_redacts_debug() {
    let broker = ExternalLaunchSecretBroker::new();
    let request = parse_putty_password("KERM_FIXTURE_SECRET_DO_NOT_USE");
    let launch_id = request.id.clone();

    let protected = broker.protect_request(request).expect("protect request");

    let password_ref = protected
        .auth
        .password
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("password session ref");
    assert!(password_ref.ref_id.starts_with("external-secret:"));
    assert_eq!(
        broker
            .resolve_secret(password_ref)
            .expect("resolve")
            .as_deref(),
        Some("KERM_FIXTURE_SECRET_DO_NOT_USE")
    );
    assert_eq!(broker.snapshot().expect("snapshot").active_secret_count, 1);
    assert_redacted(&protected, "KERM_FIXTURE_SECRET_DO_NOT_USE");
    assert_redacted(&broker, "KERM_FIXTURE_SECRET_DO_NOT_USE");

    assert_eq!(broker.ack_launch(&launch_id).expect("ack cleanup"), 1);
    assert_eq!(
        broker
            .snapshot()
            .expect("snapshot after ack")
            .active_secret_count,
        0
    );
}

#[test]
fn broker_reads_password_file_into_session_ref() {
    let temp = tempfile::tempdir().expect("tempdir");
    let password_path = temp.path().join("password.txt");
    fs::write(
        &password_path,
        "KERM_FIXTURE_PASSFILE_SECRET_DO_NOT_USE\nignored-second-line\n",
    )
    .expect("write password file");

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
    assert!(request.auth.password.is_none());
    assert!(request.auth.password_file.is_some());

    let broker = ExternalLaunchSecretBroker::new();
    let protected = broker
        .protect_request(request)
        .expect("protect password file");
    let password_ref = protected
        .auth
        .password
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("password session ref");
    assert_eq!(password_ref.source, ExternalSecretSource::PasswordFile);
    assert_eq!(
        broker
            .resolve_secret(password_ref)
            .expect("resolve password file")
            .as_deref(),
        Some("KERM_FIXTURE_PASSFILE_SECRET_DO_NOT_USE")
    );
    assert_eq!(
        broker.close_launch(&protected.id).expect("close cleanup"),
        1
    );
}

#[test]
fn broker_converts_url_password_to_session_ref() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "-url".to_owned(),
                "ssh://admin:KERM_FIXTURE_URL_SECRET_DO_NOT_USE@db.internal:2201".to_owned(),
            ],
        ))
        .expect("parse URL password launch");
    let broker = ExternalLaunchSecretBroker::new();
    let protected = broker
        .protect_request(request)
        .expect("protect URL password");

    let password_ref = protected
        .auth
        .password
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("password session ref");
    assert_eq!(password_ref.source, ExternalSecretSource::Url);
    assert_eq!(
        broker
            .resolve_secret(password_ref)
            .expect("resolve URL password")
            .as_deref(),
        Some("KERM_FIXTURE_URL_SECRET_DO_NOT_USE")
    );
    assert_redacted(&protected, "KERM_FIXTURE_URL_SECRET_DO_NOT_USE");
}

#[test]
fn broker_supports_cancel_close_exit_and_clear_all_cleanup() {
    let broker = ExternalLaunchSecretBroker::new();
    let cancel = broker
        .protect_request(parse_putty_password("KERM_FIXTURE_CANCEL_SECRET"))
        .expect("protect cancel");
    let close = broker
        .protect_request(parse_putty_password("KERM_FIXTURE_CLOSE_SECRET"))
        .expect("protect close");
    let exit = broker
        .protect_request(parse_putty_password("KERM_FIXTURE_EXIT_SECRET"))
        .expect("protect exit");

    assert_eq!(broker.snapshot().expect("snapshot").active_secret_count, 3);
    assert_eq!(broker.cancel_launch(&cancel.id).expect("cancel"), 1);
    assert_eq!(broker.close_launch(&close.id).expect("close"), 1);
    assert_eq!(broker.exit_launch(&exit.id).expect("exit"), 1);
    assert_eq!(
        broker
            .snapshot()
            .expect("snapshot after cleanup")
            .active_secret_count,
        0
    );

    broker
        .protect_request(parse_putty_password("KERM_FIXTURE_CLEAR_ALL_SECRET"))
        .expect("protect clear all");
    assert_eq!(broker.clear_all().expect("clear all"), 1);
}

#[test]
fn broker_converts_key_passphrase_without_leaking_debug() {
    let broker = ExternalLaunchSecretBroker::new();
    let mut request = parse_putty_password("KERM_FIXTURE_PASSWORD_FOR_KEY_CASE");
    request.auth.password = None;
    request.auth.key_passphrase = Some(
        ExternalSecretSlot::inline(
            ExternalSecretKind::KeyPassphrase,
            ExternalSecretSource::CommandLine,
            "KERM_FIXTURE_KEY_PASSPHRASE_DO_NOT_USE",
        )
        .expect("inline passphrase"),
    );
    let protected = broker.protect_request(request).expect("protect passphrase");

    let passphrase_ref = protected
        .auth
        .key_passphrase
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("passphrase session ref");
    assert_eq!(passphrase_ref.kind, ExternalSecretKind::KeyPassphrase);
    assert_eq!(
        broker
            .resolve_secret(passphrase_ref)
            .expect("resolve passphrase")
            .as_deref(),
        Some("KERM_FIXTURE_KEY_PASSPHRASE_DO_NOT_USE")
    );
    assert_redacted(&protected, "KERM_FIXTURE_KEY_PASSPHRASE_DO_NOT_USE");
    assert_redacted(&broker, "KERM_FIXTURE_KEY_PASSPHRASE_DO_NOT_USE");
}

#[test]
fn broker_rejects_unc_and_device_password_file_paths_before_opening() {
    let broker = ExternalLaunchSecretBroker::new();
    for unsafe_path in [
        r"\\server\share\password.txt",
        r"\\?\C:\secrets\password.txt",
        r"\\.\PIPE\password",
        "NUL.txt",
    ] {
        let request = parse_putty_password_file(unsafe_path);
        let error = broker
            .protect_request(request)
            .expect_err("unsafe password file path must fail closed");
        assert!(
            error.to_string().contains("device") || error.to_string().contains("UNC"),
            "unexpected error for {unsafe_path}: {error}"
        );
    }
    assert_eq!(broker.snapshot().expect("snapshot").active_secret_count, 0);
}

#[cfg(unix)]
#[test]
fn broker_rejects_symlink_password_file() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("tempdir");
    let target = temp.path().join("password.txt");
    let link = temp.path().join("password-link.txt");
    fs::write(&target, "KERM_SYMLINK_PASSWORD\n").expect("write password");
    symlink(&target, &link).expect("create symlink");

    let error = ExternalLaunchSecretBroker::new()
        .protect_request(parse_putty_password_file(&link.to_string_lossy()))
        .expect_err("symlink password file must fail closed");
    assert!(error.to_string().contains("symbolic link"));
}

#[test]
fn broker_rejects_secret_capacity_without_retaining_extra_values() {
    let broker = ExternalLaunchSecretBroker::with_limits(1, Duration::from_secs(60));
    broker
        .protect_request(parse_putty_password("KERM_SECRET_CAPACITY_FIRST"))
        .expect("store first secret");

    let error = broker
        .protect_request(parse_putty_password("KERM_SECRET_CAPACITY_SECOND"))
        .expect_err("capacity must fail closed");

    assert!(error.to_string().contains("capacity"));
    assert_eq!(broker.snapshot().expect("snapshot").active_secret_count, 1);
    assert_redacted(&broker, "KERM_SECRET_CAPACITY_SECOND");
}

#[test]
fn broker_expires_orphan_secret_refs() {
    let broker = ExternalLaunchSecretBroker::with_limits(4, Duration::from_millis(5));
    let protected = broker
        .protect_request(parse_putty_password("KERM_SECRET_TTL_CANARY"))
        .expect("protect expiring secret");
    let secret_ref = protected
        .auth
        .password
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("password ref")
        .clone();

    thread::sleep(Duration::from_millis(20));

    assert!(broker
        .resolve_secret(&secret_ref)
        .expect("resolve expired ref")
        .is_none());
    assert_eq!(broker.snapshot().expect("snapshot").active_secret_count, 0);
}

fn parse_putty_password(
    password: &str,
) -> kerminal_lib::services::external_launch::ExternalSshLaunchRequest {
    ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Putty,
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-pw".to_owned(),
                password.to_owned(),
            ],
        ))
        .expect("parse putty password")
}

fn parse_putty_password_file(
    path: &str,
) -> kerminal_lib::services::external_launch::ExternalSshLaunchRequest {
    ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Putty,
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "secret-file@example.internal".to_owned(),
                "-pwfile".to_owned(),
                path.to_owned(),
            ],
        ))
        .expect("parse password file request")
}

fn assert_redacted(value: &impl std::fmt::Debug, secret: &str) {
    assert!(
        !format!("{value:?}").contains(secret),
        "debug output leaked secret"
    );
}
