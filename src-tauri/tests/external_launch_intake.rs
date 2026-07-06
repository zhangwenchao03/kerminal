//! External SSH launch intake tests.
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    build_external_launch_shim_envelope, ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint,
    ExternalLaunchEventKind, ExternalLaunchIntake, ExternalLaunchPolicy, ExternalLaunchSourceTool,
    ExternalSecretSlot,
};

#[test]
fn intake_noops_for_regular_kerminal_activation() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec!["C:\\Program Files\\Kerminal\\kerminal.exe".to_owned()],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept no-op args");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Noop(_)));
    assert!(outcome.event_payload().is_none());
    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.pending_count, 0);
    assert_eq!(snapshot.noop_count, 1);
}

#[test]
fn intake_queues_protected_request_from_cold_start_vendor_args() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "2202".to_owned(),
                "-pw".to_owned(),
                "KERM_FIXTURE_INTAKE_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept external launch args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(queued.entrypoint, ExternalLaunchEntrypoint::DirectArgv);
    assert_eq!(queued.target.host, "example.internal");
    assert_eq!(queued.target.port, 2202);
    assert_eq!(queued.target.username.as_deref(), Some("ops"));
    assert_eq!(queued.pending_count, 1);

    let event = ExternalLaunchAcceptOutcome::Queued(queued.clone())
        .event_payload()
        .expect("queued event");
    assert_eq!(event.kind, ExternalLaunchEventKind::Queued);
    assert_eq!(event.launch_id.as_deref(), Some(queued.launch_id.as_str()));
    assert_eq!(event.pending_count, 1);

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    let request = &pending[0];
    assert_eq!(request.id, queued.launch_id);
    let password_ref = request
        .auth
        .password
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("password session ref");
    assert_eq!(
        intake
            .secret_broker()
            .resolve_secret(password_ref)
            .expect("resolve password")
            .as_deref(),
        Some("KERM_FIXTURE_INTAKE_SECRET_DO_NOT_USE")
    );
    assert!(!format!("{request:?}").contains("KERM_FIXTURE_INTAKE_SECRET_DO_NOT_USE"));
    assert_eq!(intake.snapshot().expect("snapshot").pending_count, 0);
}

#[test]
fn intake_queues_openssh_style_args_when_argv0_is_kerminal() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-p".to_owned(),
                "2206".to_owned(),
                "-l".to_owned(),
                "core".to_owned(),
                "core.internal".to_owned(),
                "uptime".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept OpenSSH-style external launch args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Openssh);
    assert_eq!(queued.target.host, "core.internal");
    assert_eq!(queued.target.port, 2206);
    assert_eq!(queued.target.username.as_deref(), Some("core"));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].options.remote_command.as_deref(), Some("uptime"));
}

#[test]
fn intake_noops_for_regular_kerminal_runtime_args() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "--no-sandbox".to_owned(),
                "--".to_owned(),
                "window-state".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept regular runtime args");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Noop(_)));
    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.noop_count, 1);
    assert_eq!(snapshot.pending_count, 0);
}

#[test]
fn parse_failure_records_redacted_error_without_queuing() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "not-a-port".to_owned(),
                "-pw".to_owned(),
                "KERM_FIXTURE_REJECTED_SECRET_DO_NOT_USE".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept rejected args");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(rejected.arg_count, 7);
    assert!(rejected.cwd_present);
    assert_eq!(rejected.raw_hash.len(), 64);
    assert!(!format!("{rejected:?}").contains("KERM_FIXTURE_REJECTED_SECRET_DO_NOT_USE"));
    let event = ExternalLaunchAcceptOutcome::Rejected(rejected)
        .event_payload()
        .expect("rejected event");
    assert_eq!(event.kind, ExternalLaunchEventKind::Rejected);
    assert!(event.launch_id.is_none());
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);

    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.pending_count, 0);
    assert_eq!(snapshot.rejected_count, 1);
    assert!(!format!("{snapshot:?}").contains("KERM_FIXTURE_REJECTED_SECRET_DO_NOT_USE"));
}

#[test]
fn protect_failure_records_rejection_without_aborting_startup() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-pwfile".to_owned(),
                "C:\\missing\\KERM_FIXTURE_SECRET_PATH_DO_NOT_USE.txt".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("protect failure should be captured as rejection");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(rejected.message, "external SSH launch rejected");
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);
    assert!(!format!("{rejected:?}").contains("KERM_FIXTURE_SECRET_PATH_DO_NOT_USE"));
    assert!(!format!("{intake:?}").contains("KERM_FIXTURE_SECRET_PATH_DO_NOT_USE"));
}

#[test]
fn multiple_launches_preserve_order_and_take_pending_drains() {
    let intake = ExternalLaunchIntake::new();

    intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "-p".to_owned(),
                "2022".to_owned(),
                "first@one.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept first");
    intake
        .accept_args(
            vec![
                "Xshell.exe".to_owned(),
                "-url".to_owned(),
                "ssh://second@two.internal:2200".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept second");

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].target.host, "one.internal");
    assert_eq!(pending[0].target.username.as_deref(), Some("first"));
    assert_eq!(pending[1].target.host, "two.internal");
    assert_eq!(pending[1].target.username.as_deref(), Some("second"));
    assert_eq!(intake.take_pending().expect("take pending again").len(), 0);
    assert_eq!(intake.snapshot().expect("snapshot").accepted_count, 2);
}

#[test]
fn policy_rejects_vendor_args_without_secret_leak() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        accept_vendor_args: false,
        ..ExternalLaunchPolicy::default()
    });

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@policy.example.internal".to_owned(),
                "-pw".to_owned(),
                "KERM_POLICY_VENDOR_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept policy rejected args");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(
        rejected.message,
        "external SSH vendor argument launch disabled by policy"
    );
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);

    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.rejected_count, 1);
    assert!(!snapshot.policy.accept_vendor_args);
    assert!(!format!("{snapshot:?}").contains("KERM_POLICY_VENDOR_SECRET_DO_NOT_USE"));
}

#[test]
fn policy_rejects_disabled_shim_bridge_before_parsing() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        shim_bridge_enabled: false,
        ..ExternalLaunchPolicy::default()
    });
    let envelope = build_external_launch_shim_envelope(
        vec![
            "putty.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@shim-policy.example.internal".to_owned(),
            "-pw".to_owned(),
            "KERM_POLICY_SHIM_SECRET_DO_NOT_USE".to_owned(),
        ],
        None,
        None,
    )
    .expect("build shim envelope");

    let outcome = intake
        .accept_bridge_envelope(envelope)
        .expect("accept policy rejected envelope");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(
        rejected.message,
        "external SSH shim bridge disabled by policy"
    );
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);
    assert!(!format!("{intake:?}").contains("KERM_POLICY_SHIM_SECRET_DO_NOT_USE"));
}

#[test]
fn policy_auto_open_sftp_marks_accepted_requests() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        auto_open_sftp: true,
        ..ExternalLaunchPolicy::default()
    });

    let outcome = intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "-p".to_owned(),
                "2206".to_owned(),
                "ops@auto-sftp.example.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept auto sftp request");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Queued(_)));
    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert!(pending[0].options.open_sftp);
    assert!(intake.snapshot().expect("snapshot").policy.auto_open_sftp);
}
