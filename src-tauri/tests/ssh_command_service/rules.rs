//! SSH 命令规则与输出边界集成测试。

use super::support::*;
use super::*;

#[test]
fn normalize_command_rejects_empty_and_nul() {
    assert!(matches!(
        rules::normalize_command_script(" \n\t "),
        Err(AppError::InvalidInput(_))
    ));
    assert!(matches!(
        rules::normalize_command_script("echo ok\0"),
        Err(AppError::InvalidInput(_))
    ));
    assert_eq!(
        rules::normalize_command_script("echo one\r\necho two").expect("normalize command"),
        "echo one\necho two\n"
    );
}

#[test]
fn timeout_and_output_bounds_are_clamped() {
    let plan = build_ssh_command_plan_with_executable(
        &remote_host(RemoteHostAuthType::Agent),
        "ssh".to_owned(),
        SshCommandRequest {
            host_id: "host-1".to_owned(),
            command: "whoami".to_owned(),
            timeout_seconds: Some(400),
            max_output_bytes: Some(1),
        },
    )
    .expect("build clamped plan");

    assert_eq!(plan.timeout_seconds, 300);
    assert_eq!(plan.max_output_bytes, 256);
}

#[test]
fn read_limited_output_captures_prefix_and_truncation_flag() {
    let output = rules::read_limited_output_summary(Cursor::new("abcdef中文".as_bytes()), 6)
        .expect("read output");

    assert_eq!(
        output,
        LimitedOutputSummary {
            text: "abcdef".to_owned(),
            captured_bytes: 6,
            truncated: true,
        }
    );
}

#[test]
fn limited_output_buffer_captures_prefix_and_tracks_truncation() {
    let output =
        rules::limited_output_summary_from_chunks(5, &[b"abc".as_ref(), "def中文".as_bytes()]);

    assert_eq!(
        output,
        LimitedOutputSummary {
            text: "abcde".to_owned(),
            captured_bytes: 5,
            truncated: true,
        }
    );
}
