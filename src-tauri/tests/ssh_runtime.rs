//! Managed SSH runtime tests.
//!
//! @author kongweiguang

use std::{
    collections::VecDeque,
    fs,
    io::{Cursor, Read, Write},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use async_trait::async_trait;
use kerminal_lib::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHost, RemoteHostAuthType},
    paths::KerminalPaths,
    services::{
        ssh_credential_resolver::{
            NativeSshAuthMaterial, NativeSshHopMaterial, NativeSshRouteMaterial,
            ResolvedSshCredentialSource, ResolvedSshHopRole, ResolvedSshSecretValue,
        },
        ssh_runtime::{
            error_classification::{
                classify_ssh_runtime_app_error, classify_ssh_runtime_failure,
                SshRuntimeFailureClass,
            },
            facade::{SshRuntimeFacade, SshRuntimeSessionLane, SshRuntimeTargetContext},
            native_backend::{
                should_clear_native_connection_after_channel_error, NativeSshRuntimeBackend,
            },
            policy::{
                external_target_not_available_error, is_capability_unsupported,
                is_external_runtime_target_id, is_managed_runtime_unwired,
                is_retryable_channel_open_error, known_hosts_revokes_key,
                runtime_host_key_policy_for_host_id, SshRuntimeCapability,
            },
            ManagedSshSessionManager, ManagedSshSessionState, ManagedSshShellSession,
            SshAuthIdentity, SshAuthSecretKind, SshChannelKind, SshRuntimeBackend,
            SshRuntimeConnectRequest, SshRuntimeConnection, SshRuntimeExecRawOutput,
            SshRuntimeExecRequest, SshRuntimeHostKeyPolicy, SshRuntimeSftpStream,
            SshRuntimeShellEvent, SshRuntimeShellRequest, SshRuntimeShellSession,
            SshRuntimeStreamingExecExit, SshRuntimeStreamingExecReader,
            SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
            SshRuntimeStreamingExecWriter, SshSessionKey, SshSessionPeer,
            MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG, MANAGED_SSH_CAPABILITY_RUNTIME_FLAG,
            MANAGED_SSH_EXEC_UNSUPPORTED, MANAGED_SSH_SFTP_UNSUPPORTED,
            MANAGED_SSH_SHELL_UNSUPPORTED,
        },
    },
};
use tempfile::tempdir;
use tokio::{sync::Notify, time::Duration};
use tokio_util::sync::CancellationToken;

mod support;

use support::ssh_terminal_smoke::{
    trust_loopback_host_key, LoopbackTerminalServer, COMMAND_MARKER, LOOPBACK_PASSWORD,
    LOOPBACK_READY_MARKER, LOOPBACK_USER,
};

#[path = "ssh_runtime/fixtures.rs"]
mod fixtures;
#[path = "ssh_runtime/native_shell.rs"]
mod native_shell;
#[path = "ssh_runtime/policy.rs"]
mod policy;
#[path = "ssh_runtime/session.rs"]
mod session;
