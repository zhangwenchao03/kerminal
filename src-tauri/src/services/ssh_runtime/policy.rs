//! Managed SSH runtime policy decisions shared by capability services.
//!
//! @author kongweiguang

use crate::error::AppError;

use super::{
    SshRuntimeHostKeyPolicy, MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED, MANAGED_SSH_EXEC_UNSUPPORTED,
    MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED, MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED,
    MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED, MANAGED_SSH_SFTP_UNSUPPORTED,
    MANAGED_SSH_SHELL_UNSUPPORTED, MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED,
};

const EXTERNAL_TARGET_ID_PREFIX: &str = "external:";
const MANAGED_RUNTIME_UNWIRED: &str = "managed SSH runtime backend is not wired yet";

/// Managed SSH capability used for fallback and unsupported classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshRuntimeCapability {
    Shell,
    Exec,
    StreamingExec,
    Sftp,
    Forward,
}

/// Returns whether a host id refers to an external launch temporary target.
pub fn is_external_runtime_target_id(host_id: &str) -> bool {
    host_id.starts_with(EXTERNAL_TARGET_ID_PREFIX)
}

/// Host key policy shared by shell, exec, SFTP and forwarding.
pub fn runtime_host_key_policy_for_host_id(host_id: &str) -> SshRuntimeHostKeyPolicy {
    if is_external_runtime_target_id(host_id) {
        SshRuntimeHostKeyPolicy::TrustUnknown
    } else {
        SshRuntimeHostKeyPolicy::RequireKnown
    }
}

/// User-facing error for a missing external launch target.
pub fn external_target_not_available_error(host_id: &str) -> AppError {
    AppError::NotFound(format!("外部 SSH 临时目标不存在或已关闭: {host_id}"))
}

/// Whether a managed runtime backend is not connected yet.
pub fn is_managed_runtime_unwired(error: &AppError) -> bool {
    matches!(error, AppError::SshCommand(message) if message.contains(MANAGED_RUNTIME_UNWIRED))
}

/// Whether a managed runtime capability is unsupported by the active backend.
pub fn is_capability_unsupported(error: &AppError, capability: SshRuntimeCapability) -> bool {
    match capability {
        SshRuntimeCapability::Shell => {
            matches!(error, AppError::SshCommand(message) if message == MANAGED_SSH_SHELL_UNSUPPORTED)
        }
        SshRuntimeCapability::Exec => {
            matches!(error, AppError::SshCommand(message) if message == MANAGED_SSH_EXEC_UNSUPPORTED)
        }
        SshRuntimeCapability::StreamingExec => {
            matches!(error, AppError::SshCommand(message) if message == MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED)
        }
        SshRuntimeCapability::Sftp => error.to_string().contains(MANAGED_SSH_SFTP_UNSUPPORTED),
        SshRuntimeCapability::Forward => {
            let message = error.to_string();
            message.contains(MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED)
                || message.contains(MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED)
                || message.contains(MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED)
                || message.contains(MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED)
        }
    }
}

/// Whether a failed operation is a pre-command transient channel-open failure.
pub fn is_retryable_channel_open_error(error: &AppError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("failed to open channel")
        || message.contains("connectfailed")
        || (message.contains("open channel") && message.contains("failed"))
        || (message.contains("channel open") && message.contains("failed"))
}
