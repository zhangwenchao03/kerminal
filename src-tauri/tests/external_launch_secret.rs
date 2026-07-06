//! External SSH launch secret broker tests.
//!
//! @author kongweiguang

use std::fs;

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

fn assert_redacted(value: &impl std::fmt::Debug, secret: &str) {
    assert!(
        !format!("{value:?}").contains(secret),
        "debug output leaked secret"
    );
}
