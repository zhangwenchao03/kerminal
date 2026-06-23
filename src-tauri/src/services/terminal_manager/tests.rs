use super::*;

#[test]
fn secret_prompt_match_accepts_prompt_like_password_suffixes() {
    let markers = vec!["password:".to_owned()];

    assert!(secret_prompt_matches("password: ", &markers));
    assert!(secret_prompt_matches(
        "deploy@dev.internal's password:",
        &markers
    ));
    assert!(secret_prompt_matches("enter password:", &markers));
    assert!(secret_prompt_matches("password for deploy:", &markers));
}

#[test]
fn secret_prompt_match_rejects_password_history_and_status_lines() {
    let markers = vec!["password:".to_owned()];

    assert!(!secret_prompt_matches("last failed password:", &markers));
    assert!(!secret_prompt_matches("accepted password:", &markers));
    assert!(!secret_prompt_matches("password changed:", &markers));
    assert!(!secret_prompt_matches(
        "password: changed yesterday",
        &markers
    ));
}

#[test]
fn secret_prompt_match_rejects_prefixed_specific_marker_lines() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(!secret_prompt_matches(
        "notice: deploy@dev.internal's password:",
        &markers,
    ));
}

#[test]
fn secret_prompt_match_ignores_terminal_control_prefixes() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(secret_prompt_matches(
        "\u{1b}[6n\u{1b}[?9001h\u{1b}]0;C:\\WINDOWS\\system32\\cmd.exe\u{7}\u{1b}[?25hdeploy@dev.internal's password: ",
        &markers,
    ));
}

#[test]
fn secret_prompt_match_uses_last_line_for_banners_and_split_prompts() {
    let markers = vec!["deploy@dev.internal's password:".to_owned()];

    assert!(!secret_prompt_matches(
        "last failed password:\r\ndeploy@dev.internal's pass",
        &markers,
    ));
    assert!(secret_prompt_matches(
        "last failed password:\r\ndeploy@dev.internal's password: ",
        &markers,
    ));
}
