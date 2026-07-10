//! Terminal escape responder protocol tests.
//!
//! @author kongweiguang

use kerminal_lib::services::terminal_escape_responder::{
    TerminalEscapeResponder, PRIMARY_DA_RESPONSE, SECONDARY_DA_RESPONSE, STARTUP_CPR_RESPONSE,
};

#[test]
fn responds_to_primary_secondary_da_and_startup_cpr() {
    let mut responder = TerminalEscapeResponder::new();

    let observed = responder.observe("\u{1b}[c\u{1b}[0c\u{1b}[>c\u{1b}[>0c\u{1b}[6nready");

    assert_eq!(observed.data, "ready");
    assert_eq!(
        observed.responses,
        vec![
            PRIMARY_DA_RESPONSE,
            PRIMARY_DA_RESPONSE,
            SECONDARY_DA_RESPONSE,
            SECONDARY_DA_RESPONSE,
            STARTUP_CPR_RESPONSE,
        ]
    );
}

#[test]
fn keeps_split_query_pending_until_complete() {
    let mut responder = TerminalEscapeResponder::new();

    let first = responder.observe("\u{1b}[");
    let second = responder.observe("6nOK");

    assert_eq!(first.data, "");
    assert!(first.responses.is_empty());
    assert_eq!(second.data, "OK");
    assert_eq!(second.responses, vec![STARTUP_CPR_RESPONSE]);
    assert_eq!(responder.pending_len(), 0);
}

#[test]
fn passes_da_and_cpr_responses_without_looping() {
    let mut responder = TerminalEscapeResponder::new();

    let input = "\u{1b}[?1;2c\u{1b}[>0;276;0c\u{1b}[1;1R";
    let observed = responder.observe(input);

    assert_eq!(observed.data, input);
    assert!(observed.responses.is_empty());
}

#[test]
fn does_not_answer_cpr_after_visible_output() {
    let mut responder = TerminalEscapeResponder::new();

    let first = responder.observe("prompt");
    let second = responder.observe("\u{1b}[6n");

    assert_eq!(first.data, "prompt");
    assert!(first.responses.is_empty());
    assert_eq!(second.data, "\u{1b}[6n");
    assert!(second.responses.is_empty());
}

#[test]
fn preserves_non_query_escape_sequences_without_marking_osc_payload_visible() {
    let mut responder = TerminalEscapeResponder::new();

    let observed =
        responder.observe("\u{1b}[31m\u{1b}]777;notify;Kerminal;codex;working\u{7}\u{1b}[6n");

    assert_eq!(
        observed.data,
        "\u{1b}[31m\u{1b}]777;notify;Kerminal;codex;working\u{7}"
    );
    assert_eq!(observed.responses, vec![STARTUP_CPR_RESPONSE]);
}

#[test]
fn preserves_escape_followed_by_multibyte_text_without_panicking() {
    let mut responder = TerminalEscapeResponder::new();
    let binary_like = "\u{1b}ߚtail";

    let observed = responder.observe(binary_like);

    assert_eq!(observed.data, binary_like);
    assert!(observed.responses.is_empty());
    assert_eq!(responder.pending_len(), 0);
}

#[test]
fn caps_runaway_incomplete_csi_without_unbounded_pending() {
    let mut responder = TerminalEscapeResponder::new();
    let runaway = format!("\u{1b}[{}", "1".repeat(300));

    let observed = responder.observe(&runaway);

    assert_eq!(observed.data, runaway);
    assert!(observed.responses.is_empty());
    assert_eq!(responder.pending_len(), 0);
}
