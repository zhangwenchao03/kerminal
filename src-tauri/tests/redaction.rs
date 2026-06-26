//! 敏感信息脱敏集成测试。
//!
//! @author kongweiguang

use kerminal_lib::security::redaction::redact_terminal_text;

#[test]
fn redacts_hyphenated_sk_tokens() {
    let (redacted, changed) = redact_terminal_text("prefix sk-terminal-secret-12345 suffix");

    assert!(changed);
    assert!(!redacted.contains("sk-terminal-secret-12345"));
    assert!(redacted.contains("prefix [已脱敏:api-key] suffix"));
}

#[test]
fn redacts_sk_tokens_after_escaped_newline() {
    let (redacted, changed) = redact_terminal_text(r"prefix\nsk-terminal-secret-12345\nsuffix");

    assert!(changed);
    assert!(!redacted.contains("sk-terminal-secret-12345"));
    assert!(redacted.contains(r"\n[已脱敏:api-key]\n"));
}
