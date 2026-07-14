use kerminal_lib::services::external_launch::{
    build_external_launch_shim_envelope, ExternalLaunchAcceptOutcome, ExternalLaunchIntake,
};

#[test]
fn duplicate_bridge_request_id_is_idempotent() {
    let intake = ExternalLaunchIntake::new();
    let mut envelope = build_external_launch_shim_envelope(
        vec![
            "putty.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@dedup.example.internal".to_owned(),
        ],
        None,
        None,
    )
    .expect("build shim envelope");
    envelope.request_id = "request-stable-1".to_owned();

    let first = intake
        .accept_bridge_envelope(envelope.clone())
        .expect("accept first envelope");
    let duplicate = intake
        .accept_bridge_envelope(envelope)
        .expect("accept duplicate envelope");

    let first = match first {
        ExternalLaunchAcceptOutcome::Queued(value) => value,
        other => panic!("expected first queued outcome, got {other:?}"),
    };
    let duplicate = match duplicate {
        ExternalLaunchAcceptOutcome::Queued(value) => value,
        other => panic!("expected duplicate queued outcome, got {other:?}"),
    };
    assert_eq!(duplicate.launch_id, first.launch_id);
    assert_eq!(intake.snapshot().expect("snapshot").pending_count, 1);
    assert_eq!(intake.snapshot().expect("snapshot").accepted_count, 1);
}

#[test]
fn bridge_request_id_reuse_with_different_payload_is_rejected() {
    let intake = ExternalLaunchIntake::new();
    let mut first = build_external_launch_shim_envelope(
        vec![
            "putty.exe".to_owned(),
            "-ssh".to_owned(),
            "first@dedup.example.internal".to_owned(),
        ],
        None,
        None,
    )
    .expect("build first envelope");
    first.request_id = "request-collision-1".to_owned();
    let mut conflicting = build_external_launch_shim_envelope(
        vec![
            "putty.exe".to_owned(),
            "-ssh".to_owned(),
            "other@dedup.example.internal".to_owned(),
        ],
        None,
        None,
    )
    .expect("build conflicting envelope");
    conflicting.request_id = first.request_id.clone();

    intake
        .accept_bridge_envelope(first)
        .expect("accept first envelope");
    let error = intake
        .accept_bridge_envelope(conflicting)
        .expect_err("request id cannot be reused for another payload");

    assert!(error.to_string().contains("request id was reused"));
    assert_eq!(intake.snapshot().expect("snapshot").pending_count, 1);
}

#[test]
fn bridge_delivery_history_is_bounded_and_evicts_oldest_request() {
    let intake = ExternalLaunchIntake::new();
    let mut first_envelope = None;
    let mut first_launch_id = None;
    let mut second_envelope = None;
    let mut second_launch_id = None;

    for index in 0..512 {
        let mut envelope = build_external_launch_shim_envelope(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@history.example.internal".to_owned(),
            ],
            None,
            None,
        )
        .expect("build history envelope");
        envelope.request_id = format!("history-request-{index}");
        if index == 0 {
            first_envelope = Some(envelope.clone());
        } else if index == 1 {
            second_envelope = Some(envelope.clone());
        }
        let queued = match intake
            .accept_bridge_envelope(envelope)
            .expect("accept history envelope")
        {
            ExternalLaunchAcceptOutcome::Queued(queued) => queued,
            other => panic!("expected queued history envelope, got {other:?}"),
        };
        if index == 0 {
            first_launch_id = Some(queued.launch_id.clone());
        } else if index == 1 {
            second_launch_id = Some(queued.launch_id.clone());
        }
        let claimed = intake.take_pending().expect("claim history request");
        assert_eq!(claimed.len(), 1);
        assert!(intake
            .acknowledge(&queued.launch_id)
            .expect("ack history request"));
    }

    let first_envelope = first_envelope.expect("first envelope");
    let first_launch_id = first_launch_id.expect("first launch id");
    let refreshed = match intake
        .accept_bridge_envelope(first_envelope.clone())
        .expect("refresh first LRU entry")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected refreshed duplicate, got {other:?}"),
    };
    assert_eq!(refreshed.launch_id, first_launch_id);

    let mut newest = build_external_launch_shim_envelope(
        vec![
            "putty.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@history.example.internal".to_owned(),
        ],
        None,
        None,
    )
    .expect("build newest envelope");
    newest.request_id = "history-request-512".to_owned();
    let newest = match intake
        .accept_bridge_envelope(newest)
        .expect("accept newest history envelope")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected newest queued envelope, got {other:?}"),
    };
    let claimed = intake.take_pending().expect("claim newest request");
    assert_eq!(claimed.len(), 1);
    assert!(intake
        .acknowledge(&newest.launch_id)
        .expect("ack newest request"));

    let second_replay = match intake
        .accept_bridge_envelope(second_envelope.expect("second envelope"))
        .expect("replay LRU-evicted request")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected replay to queue after LRU eviction, got {other:?}"),
    };
    assert_ne!(
        second_replay.launch_id,
        second_launch_id.expect("second launch id")
    );
    let first_replay = match intake
        .accept_bridge_envelope(first_envelope)
        .expect("replay refreshed request")
    {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected refreshed request to stay deduplicated, got {other:?}"),
    };
    assert_eq!(first_replay.launch_id, first_launch_id);
}
