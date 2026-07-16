use std::time::{Duration, Instant};

use kerminal_lib::services::external_launch::{
    ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
    ExternalLaunchPolicy, ExternalSecretSlot,
};

#[test]
fn pending_queue_rejects_over_capacity_without_retaining_secret() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        pending_capacity: 1,
        ..ExternalLaunchPolicy::default()
    });
    intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "first@capacity.example.internal".to_owned(),
                "-pw".to_owned(),
                "KERM_CAPACITY_FIRST_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept first launch");

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "second@capacity.example.internal".to_owned(),
                "-pw".to_owned(),
                "KERM_CAPACITY_SECOND_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("capacity rejection is an intake outcome");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Rejected(_)));
    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.pending_count, 1);
    assert_eq!(snapshot.rejected_count, 1);
    assert_eq!(
        intake
            .secret_broker()
            .snapshot()
            .expect("secret snapshot")
            .active_secret_count,
        1
    );
}

#[tokio::test(flavor = "current_thread")]
async fn bounded_intake_reads_password_file_off_the_async_callback_path() {
    let temp = tempfile::tempdir().expect("tempdir");
    let password_path = temp.path().join("password.txt");
    std::fs::write(&password_path, "KERM_BOUNDED_PASSFILE_SECRET\n").expect("write password file");
    let intake = ExternalLaunchIntake::new();

    let outcome = tokio::time::timeout(
        Duration::from_secs(2),
        intake.accept_args_bounded(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "bounded@example.internal".to_owned(),
                "-pwfile".to_owned(),
                password_path.to_string_lossy().into_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        ),
    )
    .await
    .expect("bounded intake should complete")
    .expect("accept bounded launch");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Queued(_)));
    let request = intake
        .take_pending()
        .expect("take pending")
        .pop()
        .expect("queued request");
    assert!(request.auth.password_file.is_some());
    assert!(!format!("{request:?}").contains(&password_path.to_string_lossy().to_string()));
    assert!(request
        .auth
        .password
        .as_ref()
        .is_some_and(ExternalSecretSlot::is_session_ref));
    assert!(!format!("{request:?}").contains("KERM_BOUNDED_PASSFILE_SECRET"));
}

#[test]
fn claimed_launch_is_requeued_after_lease_expiry_and_ack_is_idempotent() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        claim_lease_ms: 30_000,
        ..ExternalLaunchPolicy::default()
    });
    let outcome = intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "lease@recovery.example.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept lease launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(value) => value.launch_id,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    let started_at = Instant::now();

    assert_eq!(
        intake
            .claim_pending_at(started_at)
            .expect("claim pending")
            .len(),
        1
    );
    assert!(intake
        .claim_pending_at(started_at + Duration::from_secs(29))
        .expect("claim before expiry")
        .is_empty());
    assert_eq!(
        intake
            .claim_pending_at(started_at + Duration::from_secs(31))
            .expect("reclaim after expiry")
            .len(),
        1
    );
    assert!(intake.acknowledge(&launch_id).expect("first ack"));
    assert!(!intake.acknowledge(&launch_id).expect("duplicate ack"));
    assert!(intake
        .active_request(&launch_id)
        .expect("active lookup")
        .is_none());
}

#[test]
fn recover_pending_redelivers_claim_for_webview_reload() {
    let intake = ExternalLaunchIntake::new();
    let outcome = intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "reload@recovery.example.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept reload launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(value) => value.launch_id,
        other => panic!("expected queued outcome, got {other:?}"),
    };

    assert_eq!(intake.recover_pending().expect("first recovery").len(), 1);
    let recovered = intake.recover_pending().expect("webview reload recovery");

    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].id, launch_id);
    assert!(intake
        .acknowledge(&launch_id)
        .expect("ack recovered launch"));
    assert!(intake.recover_pending().expect("after ack").is_empty());
}

#[test]
fn acknowledge_rejects_a_request_that_has_not_been_claimed() {
    let intake = ExternalLaunchIntake::new();
    let outcome = intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "pending@ack-order.example.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept pending launch");
    let launch_id = match outcome {
        ExternalLaunchAcceptOutcome::Queued(value) => value.launch_id,
        other => panic!("expected queued outcome, got {other:?}"),
    };

    let error = intake
        .acknowledge(&launch_id)
        .expect_err("pending launch cannot be acknowledged");
    assert!(error.to_string().contains("尚未被领取"));
}
