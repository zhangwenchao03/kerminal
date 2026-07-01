//! TerminalManager secret input integration tests.

mod support;

use kerminal_lib::{
    models::terminal::TerminalSecretInputPlan,
    services::terminal_manager::{rules, TerminalManager},
};
use std::{sync::mpsc, time::Duration};
use support::terminal_manager::{
    collect_additional_output_for, collect_until_output, early_split_password_prompt_request,
    fallback_password_prompts_request, password_prompt_request, repeated_password_prompt_request,
    secret_entry, split_password_prompt_request, two_password_prompts_request,
};

#[test]
fn secret_prompt_match_accepts_prompt_like_password_suffixes() {
    let markers = vec!["password:".to_owned()];

    assert!(rules::secret_prompt_matches("password: ", &markers));
    assert!(rules::secret_prompt_matches(
        "deploy@dev.internal's password:",
        &markers
    ));
    assert!(rules::secret_prompt_matches("enter password:", &markers));
    assert!(rules::secret_prompt_matches(
        "password for deploy:",
        &markers
    ));
}

#[test]
fn secret_prompt_match_rejects_password_history_and_status_lines() {
    let markers = vec!["password:".to_owned()];

    assert!(!rules::secret_prompt_matches(
        "last failed password:",
        &markers
    ));
    assert!(!rules::secret_prompt_matches(
        "accepted password:",
        &markers
    ));
    assert!(!rules::secret_prompt_matches("password changed:", &markers));
    assert!(!rules::secret_prompt_matches(
        "password: changed yesterday",
        &markers
    ));
}

#[test]
fn secret_prompt_match_rejects_prefixed_specific_marker_lines() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(!rules::secret_prompt_matches(
        "notice: deploy@dev.internal's password:",
        &markers,
    ));
}

#[test]
fn secret_prompt_match_ignores_terminal_control_prefixes() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(rules::secret_prompt_matches(
        "\u{1b}[6n\u{1b}[?9001h\u{1b}]0;C:\\WINDOWS\\system32\\cmd.exe\u{7}\u{1b}[?25hdeploy@dev.internal's password: ",
        &markers,
    ));
}

#[test]
fn secret_prompt_match_uses_last_line_for_banners_and_split_prompts() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(!rules::secret_prompt_matches(
        "last failed password:\r\ndeploy@dev.internal's pass",
        &markers,
    ));
    assert!(rules::secret_prompt_matches(
        "last failed password:\r\ndeploy@dev.internal's password: ",
        &markers,
    ));
}

#[test]
fn secret_input_plan_answers_prompt_and_redacts_echoed_secret() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tPtyPassword123";
    let request = password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry(
            "target",
            "deploy@dev.internal's password:",
            secret,
        )],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(received.contains("[已脱敏]"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "auto-submitted password prompt should not stay visible: {received:?}",
    );
    assert!(
        !received.contains(secret),
        "secret input response must not be echoed to frontend output: {received:?}",
    );
}

#[test]
fn secret_input_plan_does_not_repeat_after_second_prompt() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "s3cr3tSingleUsePrompt123";
    let request = repeated_password_prompt_request();
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry(
            "target",
            "deploy@dev.internal's password:",
            secret,
        )],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let mut received = collect_until_output(&manager, &summary.id, &receiver, "first-read");
    received.push_str(&collect_additional_output_for(
        &manager,
        &summary.id,
        &receiver,
        Duration::from_millis(900),
    ));
    manager.close(&summary.id).unwrap();

    assert!(received.contains("first-read"));
    assert!(
        received.to_ascii_lowercase().matches("password:").count() >= 1,
        "expected only the later password prompt to stay visible, got: {received:?}",
    );
    assert!(
        !received.contains("unexpected-second-read"),
        "secret input plan must not answer the second prompt: {received:?}",
    );
    assert!(
        !received.contains(secret),
        "single-use secret plan must not be echoed to frontend output: {received:?}",
    );
}

#[test]
fn secret_input_plan_answers_two_independent_password_prompts_and_redacts_values() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let jump_secret = "jumpSecret123";
    let target_secret = "targetSecret456";
    let request = two_password_prompts_request(jump_secret, target_secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![
            secret_entry("jump", "bastion password:", jump_secret),
            secret_entry("target", "target password:", target_secret),
        ],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "target-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("jump-ok"));
    assert!(received.contains("target-ok"));
    assert!(received.matches("[已脱敏]").count() >= 2);
    assert!(!received.contains(jump_secret));
    assert!(!received.contains(target_secret));
}

#[test]
fn secret_input_plan_answers_split_prompt_across_reads() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "planSplitSecret123";
    let request = split_password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry(
            "split-target",
            "deploy@dev.internal's password:",
            secret,
        )],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "split auto-submitted password prompt should not stay visible: {received:?}",
    );
    assert!(!received.contains(secret));
}

#[test]
fn secret_input_plan_answers_split_host_prompt_with_generic_marker() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "genericSplitSecret123";
    let request = split_password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry("generic-target", "password:", secret)],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("auth-ok"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "generic split password prompt should not stay visible: {received:?}",
    );
    assert!(
        !received.contains("deploy@dev.internal"),
        "generic split password prompt prefix should be redacted: {received:?}",
    );
    assert!(!received.contains(secret));
}

#[test]
fn secret_input_plan_clears_generic_prompt_line_when_owner_prefix_was_split() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let secret = "genericOwnerSplitSecret123";
    let request = early_split_password_prompt_request(secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![secret_entry("generic-owner-target", "password:", secret)],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let received = collect_until_output(&manager, &summary.id, &receiver, "auth-ok");
    manager.close(&summary.id).unwrap();

    assert!(received.contains("\r\x1b[2K"));
    assert!(received.contains("auth-ok"));
    assert!(
        !received.to_ascii_lowercase().contains("password:"),
        "split generic password prompt should not stay visible: {received:?}",
    );
    assert!(!received.contains(secret));
}

#[test]
fn secret_input_plan_fallback_marker_advances_entries_without_overrepeating() {
    let manager = TerminalManager::new();
    let (sender, receiver) = mpsc::channel();
    let first_secret = "fallbackFirst123";
    let second_secret = "fallbackSecond456";
    let request = fallback_password_prompts_request(first_secret, second_secret);
    let secret_input_plan = TerminalSecretInputPlan {
        entries: vec![
            secret_entry("first", "password:", first_secret),
            secret_entry("second", "password:", second_secret),
        ],
    };

    let summary = manager
        .create_session_with_secret_input_plan(request, Some(secret_input_plan), move |event| {
            sender.send(event).is_ok()
        })
        .unwrap();

    let mut received = collect_until_output(&manager, &summary.id, &receiver, "second-read");
    received.push_str(&collect_additional_output_for(
        &manager,
        &summary.id,
        &receiver,
        Duration::from_millis(900),
    ));
    manager.close(&summary.id).unwrap();

    assert!(received.contains("first-read"));
    assert!(received.contains("second-read"));
    assert!(
        received.to_ascii_lowercase().matches("password:").count() >= 1,
        "expected only the unanswered fallback prompt to stay visible, got: {received:?}",
    );
    assert!(
        !received.contains("unexpected-third-read"),
        "fallback marker must not over-answer exhausted entries: {received:?}",
    );
    assert!(!received.contains(first_secret));
    assert!(!received.contains(second_secret));
}
