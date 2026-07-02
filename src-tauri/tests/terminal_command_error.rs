//! Terminal command error classification tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::terminal::{
        TerminalCommandError, TerminalErrorClass, TerminalErrorOperation, TerminalErrorRecovery,
        TerminalOutputEvent,
    },
};
use std::io::{Error, ErrorKind};

#[test]
fn terminal_command_error_classifies_missing_session_as_not_retryable() {
    let error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::Write,
        &AppError::Terminal("终端会话不存在: missing".to_owned()),
    );

    assert_eq!(error.class, TerminalErrorClass::SessionNotFound);
    assert_eq!(error.recovery, TerminalErrorRecovery::NotRetryable);
    assert!(!error.retryable);
    assert_eq!(error.operation, TerminalErrorOperation::Write);
}

#[test]
fn terminal_command_error_classifies_write_resize_and_spawn_failures() {
    let write_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::Write,
        &AppError::Io(Error::new(ErrorKind::BrokenPipe, "broken pipe")),
    );
    let resize_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::Resize,
        &AppError::Io(Error::other("resize failed")),
    );
    let spawn_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::CreateSession,
        &AppError::Io(Error::new(ErrorKind::NotFound, "shell missing")),
    );

    assert_eq!(write_error.class, TerminalErrorClass::SessionClosed);
    assert_eq!(write_error.recovery, TerminalErrorRecovery::NotRetryable);
    assert_eq!(resize_error.class, TerminalErrorClass::ResizeFailed);
    assert!(resize_error.retryable);
    assert_eq!(spawn_error.class, TerminalErrorClass::SpawnFailed);
    assert_eq!(
        spawn_error.recovery,
        TerminalErrorRecovery::UserActionRequired
    );
}

#[test]
fn terminal_command_error_classifies_permission_dependency_logging_and_internal_errors() {
    let permission_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::StartLog,
        &AppError::Io(Error::new(ErrorKind::PermissionDenied, "access denied")),
    );
    let dependency_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::CreateSession,
        &AppError::Terminal("未找到 Telnet 客户端".to_owned()),
    );
    let state_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::Write,
        &AppError::StateLockPoisoned("terminal_writer"),
    );
    let logging_error = TerminalCommandError::from_app_error(
        TerminalErrorOperation::StartLog,
        &AppError::Io(Error::other("disk full")),
    );

    assert_eq!(permission_error.class, TerminalErrorClass::PermissionDenied);
    assert_eq!(
        permission_error.recovery,
        TerminalErrorRecovery::UserActionRequired
    );
    assert_eq!(
        dependency_error.class,
        TerminalErrorClass::DependencyMissing
    );
    assert_eq!(state_error.class, TerminalErrorClass::StateUnavailable);
    assert_eq!(state_error.recovery, TerminalErrorRecovery::Internal);
    assert_eq!(logging_error.class, TerminalErrorClass::LoggingFailure);
}

#[test]
fn terminal_output_error_event_carries_typed_pty_read_error_without_losing_message() {
    let event = TerminalOutputEvent::error("session-1", "read failed".to_owned());
    let serialized = serde_json::to_value(&event).unwrap();
    let error = event.error.expect("typed error");

    assert_eq!(event.data, "read failed");
    assert_eq!(error.class, TerminalErrorClass::PtyReadFailed);
    assert_eq!(error.recovery, TerminalErrorRecovery::Retryable);
    assert_eq!(error.operation, TerminalErrorOperation::ReadOutput);
    assert_eq!(serialized["error"]["class"], "ptyReadFailed");
    assert_eq!(serialized["data"], "read failed");
}
