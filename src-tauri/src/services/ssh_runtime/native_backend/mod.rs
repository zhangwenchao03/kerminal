//! Native russh-backed managed SSH runtime backend.
//!
//! @author kongweiguang

mod connection;
mod forward;
mod shell;
mod streaming_exec;

use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use async_trait::async_trait;
use tokio::sync::Mutex;

pub use connection::should_clear_native_connection_after_channel_error;

use self::{
    connection::{clear_native_connection_if_current, native_connection_from_state},
    forward::{NativeDynamicForwardTask, NativeLocalForwardTask, NativeRemoteForwardTask},
    shell::NativeSshShellSession,
    streaming_exec::NativeStreamingExecSession,
};
use crate::{
    error::{AppError, AppResult},
    services::{
        ssh_command_service::native::{
            build_native_connection_execution_for_known_hosts,
            build_native_connection_execution_from_material, disconnect_native_connection_ref,
            execute_script_on_native_connection, open_sftp_on_native_connection,
            open_shell_on_native_connection, open_streaming_exec_on_native_connection,
            NativeHostKeyPolicy, NativeRemoteForwardRegistry, NativeSshCommandExecution,
            NativeSshConnectionChain,
        },
        ssh_runtime::{
            SshChannelKind, SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
            SshRuntimeDynamicForwardRequest, SshRuntimeExecRawOutput, SshRuntimeExecRequest,
            SshRuntimeForwardTask, SshRuntimeHostKeyPolicy, SshRuntimeLocalForwardRequest,
            SshRuntimeRemoteDynamicForwardRequest, SshRuntimeRemoteForwardRequest,
            SshRuntimeSftpStream, SshRuntimeShellRequest, SshRuntimeShellSession,
            SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
        },
    },
};

#[derive(Debug, Default)]
pub struct NativeSshRuntimeBackend;

impl NativeSshRuntimeBackend {
    pub fn new() -> Self {
        Self
    }
}

impl SshRuntimeBackend for NativeSshRuntimeBackend {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        let host = request
            .native_host()
            .ok_or_else(|| {
                AppError::SshCommand(
                    "managed SSH native backend requires connection material".to_owned(),
                )
            })?
            .clone();
        let known_hosts_path = request
            .native_known_hosts_path()
            .ok_or_else(|| {
                AppError::SshCommand(
                    "managed SSH native backend requires known_hosts material".to_owned(),
                )
            })?
            .to_path_buf();
        let connect_timeout_seconds = request.native_connect_timeout_seconds().unwrap_or(30);
        let keepalive_interval = request
            .native_keepalive_seconds()
            .filter(|seconds| *seconds > 0)
            .map(Duration::from_secs);
        let execution = match request.native_route_material() {
            Some(route_material) => build_native_connection_execution_from_material(
                route_material,
                known_hosts_path,
                connect_timeout_seconds,
            )?,
            None => build_native_connection_execution_for_known_hosts(
                &host,
                known_hosts_path,
                connect_timeout_seconds,
            )?,
        };
        Ok(Arc::new(NativeSshRuntimeConnection::new(
            execution,
            native_host_key_policy(request.native_host_key_policy()),
            keepalive_interval,
        )))
    }
}

fn native_host_key_policy(policy: Option<SshRuntimeHostKeyPolicy>) -> NativeHostKeyPolicy {
    match policy {
        Some(SshRuntimeHostKeyPolicy::TrustUnknown) => NativeHostKeyPolicy::TrustUnknown,
        Some(SshRuntimeHostKeyPolicy::RequireKnown) | None => NativeHostKeyPolicy::RequireKnown,
    }
}

struct NativeSshRuntimeConnection {
    channel_sequence: AtomicUsize,
    connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    execution: NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    keepalive_interval: Option<Duration>,
    remote_forwards: NativeRemoteForwardRegistry,
}

impl NativeSshRuntimeConnection {
    fn new(
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        keepalive_interval: Option<Duration>,
    ) -> Self {
        Self {
            channel_sequence: AtomicUsize::new(0),
            connection: Arc::new(Mutex::new(None)),
            execution,
            host_key_policy,
            keepalive_interval,
            remote_forwards: NativeRemoteForwardRegistry::default(),
        }
    }

    async fn connection(&self) -> AppResult<Arc<NativeSshConnectionChain>> {
        native_connection_from_state(
            &self.connection,
            &self.execution,
            self.host_key_policy,
            self.remote_forwards.clone(),
            self.keepalive_interval,
        )
        .await
    }
}

#[async_trait]
impl SshRuntimeConnection for NativeSshRuntimeConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(format!("native-russh-{}-{next}", kind.as_str()))
    }

    fn supports_shell(&self) -> bool {
        true
    }

    async fn open_shell(
        &self,
        request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        let connection = self.connection().await?;
        let channel = match open_shell_on_native_connection(&connection, request.clone()).await {
            Ok(channel) => channel,
            Err(error) => {
                if !should_clear_native_connection_after_channel_error(&error) {
                    return Err(error);
                }
                let reason = format!("managed SSH shell channel failed: {error}");
                clear_native_connection_if_current(&self.connection, &connection, &reason).await;
                let retry_connection = self.connection().await?;
                open_shell_on_native_connection(&retry_connection, request).await?
            }
        };
        Ok(Box::new(NativeSshShellSession::new(channel)))
    }

    fn supports_exec(&self) -> bool {
        true
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        let connection = self.connection().await?;
        let result = execute_script_on_native_connection(
            &connection,
            request.script,
            request.max_output_bytes.saturating_add(1),
        )
        .await;
        if let Err(error) = &result {
            if !should_clear_native_connection_after_channel_error(error) {
                return result;
            }
            clear_native_connection_if_current(
                &self.connection,
                &connection,
                &format!("managed SSH exec channel failed: {error}"),
            )
            .await;
        }
        result
    }

    fn supports_streaming_exec(&self) -> bool {
        true
    }

    async fn open_streaming_exec(
        &self,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        let command = request.command;
        let connection = self.connection().await?;
        let channel = match open_streaming_exec_on_native_connection(&connection, command.clone())
            .await
        {
            Ok(channel) => channel,
            Err(error) => {
                if !should_clear_native_connection_after_channel_error(&error) {
                    return Err(error);
                }
                let reason = format!("managed SSH streaming exec channel failed: {error}");
                clear_native_connection_if_current(&self.connection, &connection, &reason).await;
                let retry_connection = self.connection().await?;
                open_streaming_exec_on_native_connection(&retry_connection, command).await?
            }
        };
        Ok(Box::new(NativeStreamingExecSession::new(channel)))
    }

    fn supports_sftp(&self) -> bool {
        true
    }

    async fn open_sftp(&self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        let connection = self.connection().await?;
        match open_sftp_on_native_connection(&connection).await {
            Ok(stream) => Ok(stream),
            Err(error) => {
                if !should_clear_native_connection_after_channel_error(&error) {
                    return Err(error);
                }
                let reason = format!("managed SSH SFTP channel failed: {error}");
                clear_native_connection_if_current(&self.connection, &connection, &reason).await;
                let retry_connection = self.connection().await?;
                open_sftp_on_native_connection(&retry_connection).await
            }
        }
    }

    fn supports_local_forward(&self) -> bool {
        true
    }

    fn start_local_forward(
        &self,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeLocalForwardTask::start(
            format!("native-russh-local-forward-{next}"),
            Arc::new(Mutex::new(None)),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn supports_dynamic_forward(&self) -> bool {
        true
    }

    fn start_dynamic_forward(
        &self,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeDynamicForwardTask::start(
            format!("native-russh-dynamic-forward-{next}"),
            Arc::new(Mutex::new(None)),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn supports_remote_forward(&self) -> bool {
        true
    }

    fn start_remote_forward(
        &self,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeRemoteForwardTask::start(
            format!("native-russh-remote-forward-{next}"),
            Arc::new(Mutex::new(None)),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn supports_remote_dynamic_forward(&self) -> bool {
        true
    }

    fn start_remote_dynamic_forward(
        &self,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeRemoteForwardTask::start_dynamic(
            format!("native-russh-remote-dynamic-forward-{next}"),
            Arc::new(Mutex::new(None)),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn disconnect(&self, reason: &str) {
        let reason = reason.to_owned();
        let connection = Arc::clone(&self.connection);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let mut guard = connection.lock().await;
                if let Some(connection) = guard.take() {
                    disconnect_native_connection_ref(&connection, &reason).await;
                }
            });
        }
    }
}
