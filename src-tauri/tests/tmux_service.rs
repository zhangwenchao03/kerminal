//! tmux service parser and command contract tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    models::{target::RemoteTargetRef, tmux::TmuxTargetRef},
    services::tmux_service::rules::{
        build_remote_command, command_args_with_socket, parse_panes, parse_sessions, parse_windows,
        stable_tmux_target_ref, validate_target, FIELD_SEPARATOR, SESSION_FORMAT,
    },
};

fn local_target() -> TmuxTargetRef {
    TmuxTargetRef {
        socket_name: None,
        socket_path: None,
        target: RemoteTargetRef::Local { profile_id: None },
        tmux_path: None,
    }
}

#[test]
fn parses_tmux_session_format_output() {
    let sep = FIELD_SEPARATOR;
    let output = format!(
        "$0{sep}'dev api'{sep}1{sep}2{sep}1710000000{sep}1710000100{sep}'/srv/app data'{sep}3\n"
    );

    let sessions = parse_sessions(&output, "ssh:prod").expect("parse sessions");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "$0");
    assert_eq!(sessions[0].name, "dev api");
    assert!(sessions[0].attached);
    assert_eq!(sessions[0].clients, 2);
    assert_eq!(sessions[0].windows, 3);
    assert_eq!(sessions[0].current_path.as_deref(), Some("/srv/app data"));
    assert_eq!(sessions[0].created_at, Some(1_710_000_000));
    assert_eq!(sessions[0].activity_at, Some(1_710_000_100));
}

#[test]
fn session_format_uses_attached_count_for_clients() {
    assert!(!SESSION_FORMAT.contains("#{q:"));
    assert!(SESSION_FORMAT.contains("#{session_name}"));
    assert!(!SESSION_FORMAT.contains("session_clients"));
    assert_eq!(SESSION_FORMAT.matches("session_attached").count(), 2);
}

#[test]
fn parses_attached_count_larger_than_one() {
    let sep = FIELD_SEPARATOR;
    let output =
        format!("$1{sep}'shared'{sep}2{sep}2{sep}1710000000{sep}1710000100{sep}'/srv/app'{sep}1\n");

    let sessions = parse_sessions(&output, "ssh:prod").expect("parse sessions");

    assert!(sessions[0].attached);
    assert_eq!(sessions[0].clients, 2);
}

#[test]
fn parses_unquoted_numeric_session_name_from_tmux_27() {
    let sep = FIELD_SEPARATOR;
    let output = format!("$0{sep}0{sep}0{sep}0{sep}1710000000{sep}1710000100{sep}{sep}1\n");

    let sessions = parse_sessions(&output, "ssh:primary").expect("parse sessions");

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "$0");
    assert_eq!(sessions[0].name, "0");
    assert!(!sessions[0].attached);
    assert_eq!(sessions[0].clients, 0);
    assert_eq!(sessions[0].current_path, None);
}

#[test]
fn parses_raw_tmux_fields_with_apostrophes() {
    let sep = FIELD_SEPARATOR;
    let output =
        format!("$1{sep}api's{sep}0{sep}0{sep}1710000000{sep}1710000100{sep}/srv/api's{sep}1\n");

    let sessions = parse_sessions(&output, "ssh:primary").expect("parse sessions");

    assert_eq!(sessions[0].name, "api's");
    assert_eq!(sessions[0].current_path.as_deref(), Some("/srv/api's"));
}

#[test]
fn rejects_tmux_session_output_with_wrong_field_count() {
    let error = parse_sessions("$0\ndev\n", "local").expect_err("invalid output");

    assert!(error.to_string().contains("字段数量不匹配"));
}

#[test]
fn parses_windows_and_panes_with_quoted_text() {
    let sep = FIELD_SEPARATOR;
    let windows =
        format!("@1{sep}$0{sep}0{sep}'app logs'{sep}1{sep}2{sep}'main-horizontal'{sep}'*'\n");
    let panes = format!(
        "%2{sep}@1{sep}1{sep}0{sep}'/srv/app'{sep}'tail -f'{sep}'logs pane'{sep}120{sep}30{sep}0\n"
    );

    let windows = parse_windows(&windows).expect("parse windows");
    let panes = parse_panes(&panes).expect("parse panes");

    assert_eq!(windows[0].name, "app logs");
    assert!(windows[0].active);
    assert_eq!(windows[0].layout.as_deref(), Some("main-horizontal"));
    assert_eq!(panes[0].current_command.as_deref(), Some("tail -f"));
    assert_eq!(panes[0].title.as_deref(), Some("logs pane"));
    assert!(!panes[0].dead);
}

#[test]
fn builds_socket_args_and_rejects_conflicting_socket_scope() {
    let mut target = local_target();
    target.socket_name = Some("work".to_owned());

    let args = command_args_with_socket(&target, &["list-sessions"]).expect("socket args");
    assert_eq!(args, vec!["-L", "work", "list-sessions"]);
    assert_eq!(stable_tmux_target_ref(&target), "local|L:work");

    target.socket_path = Some("/tmp/tmux.sock".to_owned());
    let error = validate_target(&target).expect_err("conflicting socket scope");
    assert!(error.to_string().contains("不能同时设置"));
}

#[test]
fn quotes_remote_tmux_command_arguments() {
    let command = build_remote_command(
        "tmux",
        &[
            "attach-session".to_owned(),
            "-t".to_owned(),
            "dev api's session".to_owned(),
        ],
    );

    assert_eq!(
        command,
        "'tmux' 'attach-session' '-t' 'dev api'\\''s session'"
    );
}
