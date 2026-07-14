//! SSH 非交互命令服务集成测试。
//!
//! @author kongweiguang

use async_trait::async_trait;
use kerminal_lib::{
    error::{AppError, AppResult},
    models::{
        remote_host::{
            RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, SshJumpHostOptions,
        },
        ssh_command::SshCommandRequest,
    },
    paths::KerminalPaths,
    services::external_launch::{
        ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchIntake,
        ExternalSessionMaterializer,
    },
    services::ssh_command_service::{
        build_ssh_command_plan_with_executable,
        rules::{self, LimitedOutputSummary, NativeAuthMaterialSummary},
        SshCommandService,
    },
    services::ssh_runtime::{
        auth_broker::{SshAuthBroker, SshSessionSecretInput},
        native_backend::NativeSshRuntimeBackend,
        ManagedSshSessionManager, SshAuthIdentity, SshAuthSecretKind, SshChannelKind,
        SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection, SshRuntimeExecRawOutput,
        SshRuntimeExecRequest, SshRuntimeStreamingExecExit, SshRuntimeStreamingExecReader,
        SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
        SshRuntimeStreamingExecWriter, SshSessionKey,
    },
    state::AppState,
    storage::config_file_store::ConfigFileStore,
};
use russh::{
    keys::{self, PrivateKey, PublicKey},
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId,
};
use std::{
    io::Cursor,
    net::SocketAddr,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tempfile::{tempdir, TempDir};
use tokio::{io, net::TcpListener};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use support::test_state;

#[path = "ssh_command_service/execution.rs"]
mod execution;
#[path = "ssh_command_service/host_key.rs"]
mod host_key;
#[path = "ssh_command_service/plan_rules.rs"]
mod plan_rules;
#[path = "ssh_command_service/rules.rs"]
mod rules_tests;
#[path = "ssh_command_service/support.rs"]
mod support;

#[test]
fn external_runtime_host_metadata_without_materialized_target_does_not_read_host_toml_path() {
    let (_home, state) = test_state();

    let error = state
        .ssh_commands()
        .resolve_native_runtime_host_metadata(state.paths(), "external:missing-launch")
        .expect_err("missing external target should fail before file store");

    let message = error.to_string();
    assert!(matches!(error, AppError::NotFound(_)));
    assert!(message.contains("外部 SSH 临时目标不存在或已关闭"));
    assert!(!message.contains("invalid remote host id"));
    assert!(!message.contains("invalid file store path"));
}
