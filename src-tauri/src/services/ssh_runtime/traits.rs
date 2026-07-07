//! Managed SSH runtime backend and connection traits.
//!
//! @author kongweiguang

use std::{
    io::{Read, Write},
    sync::Arc,
};

use async_trait::async_trait;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::error::{AppError, AppResult};

use super::{
    SshChannelKind, SshRuntimeConnectRequest, SshRuntimeDynamicForwardRequest,
    SshRuntimeExecRawOutput, SshRuntimeExecRequest, SshRuntimeForwardTask,
    SshRuntimeLocalForwardRequest, SshRuntimeRemoteDynamicForwardRequest,
    SshRuntimeRemoteForwardRequest, SshRuntimeShellRequest, SshRuntimeShellSession,
    SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
    MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED, MANAGED_SSH_EXEC_UNSUPPORTED,
    MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED, MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED,
    MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED, MANAGED_SSH_SFTP_UNSUPPORTED,
    MANAGED_SSH_SHELL_UNSUPPORTED, MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED,
};

/// Backend hook used by real russh adapters and tests.
pub trait SshRuntimeBackend: Send + Sync {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>>;
}

/// Async byte stream for an SFTP subsystem opened from a managed SSH session.
pub trait SshRuntimeSftpStream: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T> SshRuntimeSftpStream for T where T: AsyncRead + AsyncWrite + Unpin + Send + 'static {}

/// Blocking reader bridged from a managed streaming exec channel.
pub trait SshRuntimeStreamingExecReader: Read + Send {}

impl<T> SshRuntimeStreamingExecReader for T where T: Read + Send + 'static {}

/// Blocking writer bridged to a managed streaming exec channel.
pub trait SshRuntimeStreamingExecWriter: Write + Send {}

impl<T> SshRuntimeStreamingExecWriter for T where T: Write + Send + 'static {}

/// One authenticated SSH transport. Opening channels is delegated to the backend.
#[async_trait]
pub trait SshRuntimeConnection: Send + Sync {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String>;

    fn supports_shell(&self) -> bool {
        false
    }

    async fn open_shell(
        &self,
        _request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_SHELL_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_exec(&self) -> bool {
        false
    }

    async fn execute_exec(
        &self,
        _request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        Err(AppError::SshCommand(
            MANAGED_SSH_EXEC_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_streaming_exec(&self) -> bool {
        false
    }

    async fn open_streaming_exec(
        &self,
        _request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_sftp(&self) -> bool {
        false
    }

    async fn open_sftp(&self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_SFTP_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_local_forward(&self) -> bool {
        false
    }

    fn start_local_forward(
        &self,
        _request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_dynamic_forward(&self) -> bool {
        false
    }

    fn start_dynamic_forward(
        &self,
        _request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_remote_forward(&self) -> bool {
        false
    }

    fn start_remote_forward(
        &self,
        _request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED.to_owned(),
        ))
    }

    fn supports_remote_dynamic_forward(&self) -> bool {
        false
    }

    fn start_remote_dynamic_forward(
        &self,
        _request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        Err(AppError::SshCommand(
            MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED.to_owned(),
        ))
    }

    fn disconnect(&self, reason: &str);
}
