//! Managed SSH session runtime.
//!
//! @author kongweiguang

use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    future::Future,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

pub mod auth_broker;
pub mod connect;
pub mod entry;
pub mod error_classification;
pub mod exec;
pub mod facade;
pub mod forward;
pub mod leases;
pub mod native_backend;
pub mod policy;
pub mod session_key;
pub mod shell;
pub mod snapshot;
pub mod traits;
pub mod types;
pub mod unavailable;
pub mod utils;

use entry::ManagedSshSessionEntry;
use unavailable::UnavailableSshRuntimeBackend;
use utils::{missing_session_error, truncate_diagnostic_text, unix_timestamp};

pub use connect::*;
pub use exec::*;
pub use forward::*;
pub use leases::*;
pub use shell::*;
pub use snapshot::*;
pub use traits::*;
pub use types::*;

const DEFAULT_MAX_CONCURRENT_EXEC_CHANNELS: usize = 4;
const MAX_RECENT_LEGACY_FALLBACKS: usize = 20;

/// Global manager for authenticated SSH sessions.
#[derive(Clone)]
pub struct ManagedSshSessionManager {
    inner: Arc<ManagedSshSessionManagerInner>,
}

struct ManagedSshSessionManagerInner {
    backend: Arc<dyn SshRuntimeBackend>,
    channel_open_semaphores: Mutex<HashMap<SshSessionKey, Arc<Semaphore>>>,
    exec_semaphores: Mutex<HashMap<SshSessionKey, Arc<Semaphore>>>,
    legacy_fallbacks: Mutex<Vec<ManagedSshLegacyFallbackSnapshot>>,
    max_concurrent_exec_channels: usize,
    sessions: Mutex<HashMap<SshSessionKey, ManagedSshSessionEntry>>,
}

const MANAGED_CHANNEL_OPEN_RETRY_DELAYS_MS: [u64; 3] = [200, 500, 1000];

impl fmt::Debug for ManagedSshSessionManager {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshSessionManager")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl Default for ManagedSshSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ManagedSshSessionManager {
    /// Create a manager with a placeholder backend. Real adapters will replace
    /// this once session-backed SFTP/terminal migration starts.
    pub fn new() -> Self {
        Self::with_backend(Arc::new(UnavailableSshRuntimeBackend))
    }

    pub fn with_backend<B>(backend: Arc<B>) -> Self
    where
        B: SshRuntimeBackend + 'static,
    {
        Self::with_backend_and_limits(backend, DEFAULT_MAX_CONCURRENT_EXEC_CHANNELS)
    }

    pub fn with_backend_and_limits<B>(backend: Arc<B>, max_concurrent_exec_channels: usize) -> Self
    where
        B: SshRuntimeBackend + 'static,
    {
        Self {
            inner: Arc::new(ManagedSshSessionManagerInner {
                backend,
                channel_open_semaphores: Mutex::new(HashMap::new()),
                exec_semaphores: Mutex::new(HashMap::new()),
                legacy_fallbacks: Mutex::new(Vec::new()),
                max_concurrent_exec_channels: max_concurrent_exec_channels.max(1),
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Acquire or create an authenticated session for the given key.
    pub fn acquire_session(&self, key: SshSessionKey) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_session_with_request(SshRuntimeConnectRequest::key_only(key))
    }

    /// Acquire or create an authenticated session with backend connection material.
    pub fn acquire_session_with_request(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<ManagedSshSessionHandle> {
        let key = request.key().clone();
        {
            let mut sessions = self.sessions()?;
            match sessions.get(&key).map(|entry| entry.state) {
                Some(ManagedSshSessionState::Failed) => {
                    if let Some(failed_entry) = sessions.remove(&key) {
                        evict_failed_session_entry(
                            &self.inner,
                            &key,
                            failed_entry,
                            "failed session evicted before reacquire",
                        );
                    }
                }
                Some(_) => {
                    let entry = sessions.get_mut(&key).expect("existing ready session");
                    entry.ref_count = entry.ref_count.saturating_add(1);
                    entry.last_used_at = unix_timestamp();
                    return Ok(self.handle_for(&key, entry));
                }
                None => {}
            }
        }

        let connection = self.inner.backend.connect(request)?;
        let mut sessions = self.sessions()?;
        match sessions.get(&key).map(|entry| entry.state) {
            Some(ManagedSshSessionState::Failed) => {
                if let Some(failed_entry) = sessions.remove(&key) {
                    evict_failed_session_entry(
                        &self.inner,
                        &key,
                        failed_entry,
                        "failed session evicted after reconnect race",
                    );
                }
            }
            Some(_) => {
                let entry = sessions.get_mut(&key).expect("existing ready session");
                entry.ref_count = entry.ref_count.saturating_add(1);
                entry.last_used_at = unix_timestamp();
                return Ok(self.handle_for(&key, entry));
            }
            None => {}
        }

        let now = unix_timestamp();
        let mut entry = ManagedSshSessionEntry {
            active_channels: 0,
            channel_counts: BTreeMap::new(),
            connection,
            created_at: now.clone(),
            last_error: None,
            last_used_at: now,
            opened_channels: 0,
            pending_exec_requests: 0,
            ref_count: 1,
            session_id: Uuid::new_v4().to_string(),
            state: ManagedSshSessionState::Ready,
        };
        let handle = self.handle_for(&key, &mut entry);
        sessions.insert(key, entry);
        Ok(handle)
    }

    /// Acquire a latency-isolated session for bulk transfer work.
    ///
    /// The auth material and target identity are still the same as the
    /// interactive session, but the runtime registry key carries a separate
    /// lane flag so large SFTP/container streams can use another SSH transport
    /// instead of competing with the user's interactive shell.
    pub fn acquire_bulk_transfer_session(
        &self,
        key: SshSessionKey,
    ) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_bulk_transfer_session_with_request(SshRuntimeConnectRequest::key_only(key))
    }

    pub fn acquire_bulk_transfer_session_with_request(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_session_with_request(
            request.with_runtime_flag(MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG),
        )
    }

    /// Acquire a tool/capability session for chains that cannot safely share
    /// the user's interactive shell transport, notably external bastion targets.
    pub fn acquire_capability_session_with_request(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<ManagedSshSessionHandle> {
        self.acquire_session_with_request(
            request.with_runtime_flag(MANAGED_SSH_CAPABILITY_RUNTIME_FLAG),
        )
    }

    /// Close idle sessions that are not currently referenced by a caller or channel.
    pub fn close_idle_sessions(&self) -> AppResult<usize> {
        let mut sessions = self.sessions()?;
        let idle_keys = sessions
            .iter()
            .filter_map(|(key, entry)| {
                if entry.ref_count == 0 && entry.active_channels == 0 {
                    Some(key.clone())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let closed = idle_keys.len();
        for key in idle_keys {
            if let Some(entry) = sessions.remove(&key) {
                entry.connection.disconnect("idle session closed");
            }
            remove_channel_open_semaphore(&self.inner, &key);
            remove_exec_semaphore(&self.inner, &key);
        }
        Ok(closed)
    }

    /// Return a redacted runtime snapshot for diagnostics.
    pub fn snapshot(&self) -> AppResult<ManagedSshRuntimeSnapshot> {
        let sessions = self.sessions()?;
        let mut session_summaries = sessions
            .iter()
            .map(|(key, entry)| entry.snapshot(key, self.inner.max_concurrent_exec_channels))
            .collect::<Vec<_>>();
        session_summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));

        Ok(ManagedSshRuntimeSnapshot {
            active_channels: session_summaries
                .iter()
                .map(|session| session.active_channels)
                .sum(),
            active_sessions: session_summaries.len(),
            generated_at: unix_timestamp(),
            recent_legacy_fallbacks: self.recent_legacy_fallbacks(),
            sessions: session_summaries,
        })
    }

    /// Number of sessions currently kept in the registry.
    pub fn active_session_count(&self) -> AppResult<usize> {
        Ok(self.sessions()?.len())
    }

    /// Record an intentional legacy fallback for diagnostics.
    ///
    /// This is only for migration gaps such as an unwired backend or a request
    /// shape that the managed runtime explicitly does not support yet.
    pub fn record_legacy_fallback(
        &self,
        capability: impl Into<String>,
        reason: impl Into<String>,
        target: Option<String>,
    ) {
        let Ok(mut fallbacks) = self.inner.legacy_fallbacks.lock() else {
            return;
        };
        let now = unix_timestamp();
        let capability = truncate_diagnostic_text(capability.into(), 80);
        let reason = truncate_diagnostic_text(reason.into(), 160);
        let target = target.map(|value| truncate_diagnostic_text(value, 160));
        if let Some(existing) = fallbacks.iter_mut().find(|event| {
            event.capability == capability && event.reason == reason && event.target == target
        }) {
            existing.count = existing.count.saturating_add(1);
            existing.last_at = now;
            return;
        }
        fallbacks.push(ManagedSshLegacyFallbackSnapshot {
            capability,
            count: 1,
            last_at: now,
            reason,
            target,
        });
        if fallbacks.len() > MAX_RECENT_LEGACY_FALLBACKS {
            let overflow = fallbacks.len() - MAX_RECENT_LEGACY_FALLBACKS;
            fallbacks.drain(0..overflow);
        }
    }

    fn handle_for(
        &self,
        key: &SshSessionKey,
        entry: &mut ManagedSshSessionEntry,
    ) -> ManagedSshSessionHandle {
        ManagedSshSessionHandle {
            inner: Arc::clone(&self.inner),
            key: key.clone(),
            session_id: entry.session_id.clone(),
        }
    }

    fn open_channel(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        kind: SshChannelKind,
    ) -> AppResult<ManagedSshChannel> {
        retry_sync_channel_operation(inner, key, session_id, kind, true, |connection| {
            connection.open_channel(kind)
        })
        .map(|channel_id| ManagedSshChannel {
            channel_id,
            inner: Arc::clone(inner),
            key: key.clone(),
            kind,
            session_id: session_id.to_owned(),
        })
    }

    async fn execute_exec(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecOutput> {
        let semaphore = exec_semaphore_for(inner, key)?;
        let permit =
            acquire_exec_permit(inner, key, session_id, semaphore, &request.cancel_token).await?;
        let result = execute_exec_with_permit(inner, key, session_id, request, permit).await;
        result
    }

    async fn open_streaming_exec(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<ManagedSshStreamingExecSession> {
        let semaphore = exec_semaphore_for(inner, key)?;
        let permit =
            acquire_exec_permit(inner, key, session_id, semaphore, &request.cancel_token).await?;
        let result = open_streaming_exec_with_permit(inner, key, session_id, request, permit).await;
        result
    }

    async fn open_shell(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeShellRequest,
    ) -> AppResult<ManagedSshShellSession> {
        let connection = session_connection(inner, key, session_id)?;
        if !connection.supports_shell() {
            return Err(AppError::SshCommand(
                MANAGED_SSH_SHELL_UNSUPPORTED.to_owned(),
            ));
        }

        retry_async_channel_operation(
            inner,
            key,
            session_id,
            SshChannelKind::Shell,
            true,
            None,
            |connection| {
                let request = request.clone();
                async move { connection.open_shell(request).await }
            },
        )
        .await
        .map(|shell| ManagedSshShellSession {
            inner: Arc::clone(inner),
            key: key.clone(),
            released: false,
            session_id: session_id.to_owned(),
            shell: Some(shell),
        })
    }

    async fn open_sftp(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
    ) -> AppResult<ManagedSshSftpChannel> {
        let connection = session_connection(inner, key, session_id)?;
        if !connection.supports_sftp() {
            return Err(AppError::SshCommand(
                MANAGED_SSH_SFTP_UNSUPPORTED.to_owned(),
            ));
        }
        retry_async_channel_operation(
            inner,
            key,
            session_id,
            SshChannelKind::Sftp,
            true,
            None,
            |connection| async move { connection.open_sftp().await },
        )
        .await
        .map(|stream| ManagedSshSftpChannel {
            inner: Arc::clone(inner),
            key: key.clone(),
            released: false,
            session_id: session_id.to_owned(),
            stream: Some(stream),
        })
    }

    fn start_local_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection = session_connection(inner, key, session_id)?;
        if !connection.supports_local_forward() {
            return Err(AppError::SshCommand(
                MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        retry_sync_channel_operation(
            inner,
            key,
            session_id,
            SshChannelKind::DirectTcpIp,
            true,
            |connection| connection.start_local_forward(request.clone()),
        )
        .map(|task| ManagedSshForwardTunnel {
            inner: Arc::clone(inner),
            key: key.clone(),
            kind: SshChannelKind::DirectTcpIp,
            session_id: session_id.to_owned(),
            task: Some(task),
        })
    }

    fn start_dynamic_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection = session_connection(inner, key, session_id)?;
        if !connection.supports_dynamic_forward() {
            return Err(AppError::SshCommand(
                MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        retry_sync_channel_operation(
            inner,
            key,
            session_id,
            SshChannelKind::DirectTcpIp,
            true,
            |connection| connection.start_dynamic_forward(request.clone()),
        )
        .map(|task| ManagedSshForwardTunnel {
            inner: Arc::clone(inner),
            key: key.clone(),
            kind: SshChannelKind::DirectTcpIp,
            session_id: session_id.to_owned(),
            task: Some(task),
        })
    }

    fn start_remote_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection = session_connection(inner, key, session_id)?;
        if !connection.supports_remote_forward() {
            return Err(AppError::SshCommand(
                MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        retry_sync_channel_operation(
            inner,
            key,
            session_id,
            SshChannelKind::ForwardListener,
            true,
            |connection| connection.start_remote_forward(request.clone()),
        )
        .map(|task| ManagedSshForwardTunnel {
            inner: Arc::clone(inner),
            key: key.clone(),
            kind: SshChannelKind::ForwardListener,
            session_id: session_id.to_owned(),
            task: Some(task),
        })
    }

    fn start_remote_dynamic_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection = session_connection(inner, key, session_id)?;
        if !connection.supports_remote_dynamic_forward() {
            return Err(AppError::SshCommand(
                MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        retry_sync_channel_operation(
            inner,
            key,
            session_id,
            SshChannelKind::ForwardListener,
            true,
            |connection| connection.start_remote_dynamic_forward(request.clone()),
        )
        .map(|task| ManagedSshForwardTunnel {
            inner: Arc::clone(inner),
            key: key.clone(),
            kind: SshChannelKind::ForwardListener,
            session_id: session_id.to_owned(),
            task: Some(task),
        })
    }

    fn release_session(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
    ) {
        let Ok(mut sessions) = lock_sessions(inner) else {
            return;
        };
        let Some(entry) = sessions.get_mut(key) else {
            return;
        };
        if entry.session_id != session_id {
            return;
        }
        entry.ref_count = entry.ref_count.saturating_sub(1);
        entry.last_used_at = unix_timestamp();
        if entry.ref_count == 0
            && entry.active_channels == 0
            && entry.state == ManagedSshSessionState::Failed
        {
            if let Some(entry) = sessions.remove(key) {
                entry.connection.disconnect("last handle released");
            }
            remove_exec_semaphore(inner, key);
        }
    }

    fn sessions(
        &self,
    ) -> AppResult<MutexGuard<'_, HashMap<SshSessionKey, ManagedSshSessionEntry>>> {
        lock_sessions(&self.inner)
    }

    fn recent_legacy_fallbacks(&self) -> Vec<ManagedSshLegacyFallbackSnapshot> {
        self.inner
            .legacy_fallbacks
            .lock()
            .map(|fallbacks| fallbacks.clone())
            .unwrap_or_default()
    }
}

async fn acquire_exec_permit(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    semaphore: Arc<Semaphore>,
    cancel_token: &CancellationToken,
) -> AppResult<OwnedSemaphorePermit> {
    match semaphore.clone().try_acquire_owned() {
        Ok(permit) => Ok(permit),
        Err(TryAcquireError::Closed) => Err(AppError::SshCommand(
            "managed SSH exec queue is closed".to_owned(),
        )),
        Err(TryAcquireError::NoPermits) => {
            adjust_pending_exec_requests(inner, key, session_id, 1);
            let acquired = tokio::select! {
                _ = cancel_token.cancelled() => Err(exec_cancelled_error()),
                permit = semaphore.acquire_owned() => permit.map_err(|_| {
                    AppError::SshCommand("managed SSH exec queue is closed".to_owned())
                }),
            };
            adjust_pending_exec_requests(inner, key, session_id, -1);
            acquired
        }
    }
}

async fn execute_exec_with_permit(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    request: SshRuntimeExecRequest,
    _permit: OwnedSemaphorePermit,
) -> AppResult<SshRuntimeExecOutput> {
    let connection = session_connection(inner, key, session_id)?;
    if !connection.supports_exec() {
        return Err(AppError::SshCommand(
            MANAGED_SSH_EXEC_UNSUPPORTED.to_owned(),
        ));
    }

    let started = Instant::now();
    let cancel_token = request.cancel_token.clone();

    retry_async_channel_operation(
        inner,
        key,
        session_id,
        SshChannelKind::Exec,
        false,
        Some(&cancel_token),
        |connection| {
            let request = request.clone();
            async move {
                let timeout = Duration::from_secs(request.timeout_seconds);
                let cancel_token = request.cancel_token.clone();
                let max_output_bytes = request.max_output_bytes;
                tokio::select! {
                    _ = cancel_token.cancelled() => Err(exec_cancelled_error()),
                    result = tokio::time::timeout(timeout, connection.execute_exec(request)) => {
                        match result {
                            Ok(result) => result.map(|raw| {
                                SshRuntimeExecOutput::from_raw(
                                    raw,
                                    max_output_bytes,
                                    started.elapsed().as_millis(),
                                )
                            }),
                            Err(_) => Err(AppError::SshCommand(format!(
                                "远程命令执行超时（{} 秒）",
                                timeout.as_secs()
                            ))),
                        }
                    }
                }
            }
        },
    )
    .await
}

async fn open_streaming_exec_with_permit(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    request: SshRuntimeStreamingExecRequest,
    permit: OwnedSemaphorePermit,
) -> AppResult<ManagedSshStreamingExecSession> {
    let connection = session_connection(inner, key, session_id)?;
    if !connection.supports_streaming_exec() {
        return Err(AppError::SshCommand(
            MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED.to_owned(),
        ));
    }

    let timeout = Duration::from_secs(request.timeout_seconds);
    retry_async_channel_operation(
        inner,
        key,
        session_id,
        SshChannelKind::Exec,
        true,
        Some(&request.cancel_token),
        |connection| {
            let request = request.clone();
            async move { connection.open_streaming_exec(request).await }
        },
    )
    .await
    .map(|session| ManagedSshStreamingExecSession {
        inner: Arc::clone(inner),
        key: key.clone(),
        permit: Some(permit),
        released: false,
        session: Some(session),
        session_id: session_id.to_owned(),
        timeout,
    })
}

fn session_connection(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
) -> AppResult<Arc<dyn SshRuntimeConnection>> {
    let mut sessions = lock_sessions(inner)?;
    let entry = sessions
        .get_mut(key)
        .filter(|entry| entry.session_id == session_id)
        .ok_or_else(|| missing_session_error(session_id))?;
    entry.last_used_at = unix_timestamp();
    Ok(Arc::clone(&entry.connection))
}

fn begin_channel_operation(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    kind: SshChannelKind,
) -> AppResult<Arc<dyn SshRuntimeConnection>> {
    let mut sessions = lock_sessions(inner)?;
    let entry = sessions
        .get_mut(key)
        .filter(|entry| entry.session_id == session_id)
        .ok_or_else(|| missing_session_error(session_id))?;
    entry.active_channels = entry.active_channels.saturating_add(1);
    entry.opened_channels = entry.opened_channels.saturating_add(1);
    entry.last_used_at = unix_timestamp();
    *entry.channel_counts.entry(kind).or_insert(0) += 1;
    Ok(Arc::clone(&entry.connection))
}

fn retry_sync_channel_operation<T>(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    kind: SshChannelKind,
    retain_channel_on_success: bool,
    mut operation: impl FnMut(Arc<dyn SshRuntimeConnection>) -> AppResult<T>,
) -> AppResult<T> {
    let _permit = acquire_channel_open_permit_blocking(inner, key)?;
    let mut retry_index = 0;

    loop {
        let connection = begin_channel_operation(inner, key, session_id, kind)?;
        match operation(connection) {
            Ok(value) => {
                if !retain_channel_on_success {
                    release_channel(inner, key, session_id, None);
                }
                return Ok(value);
            }
            Err(error)
                if policy::is_retryable_channel_open_error(&error)
                    && retry_index < MANAGED_CHANNEL_OPEN_RETRY_DELAYS_MS.len() =>
            {
                release_channel(inner, key, session_id, None);
                std::thread::sleep(channel_open_retry_delay(retry_index));
                retry_index += 1;
            }
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                return Err(error);
            }
        }
    }
}

async fn retry_async_channel_operation<T, F, Fut>(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    kind: SshChannelKind,
    retain_channel_on_success: bool,
    cancel_token: Option<&CancellationToken>,
    mut operation: F,
) -> AppResult<T>
where
    F: FnMut(Arc<dyn SshRuntimeConnection>) -> Fut,
    Fut: Future<Output = AppResult<T>>,
{
    let _permit = acquire_channel_open_permit(inner, key).await?;
    let mut retry_index = 0;

    loop {
        let connection = begin_channel_operation(inner, key, session_id, kind)?;
        match operation(connection).await {
            Ok(value) => {
                if !retain_channel_on_success {
                    release_channel(inner, key, session_id, None);
                }
                return Ok(value);
            }
            Err(error)
                if policy::is_retryable_channel_open_error(&error)
                    && retry_index < MANAGED_CHANNEL_OPEN_RETRY_DELAYS_MS.len() =>
            {
                release_channel(inner, key, session_id, None);
                wait_channel_open_retry(cancel_token, channel_open_retry_delay(retry_index))
                    .await?;
                retry_index += 1;
            }
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                return Err(error);
            }
        }
    }
}

async fn wait_channel_open_retry(
    cancel_token: Option<&CancellationToken>,
    delay: Duration,
) -> AppResult<()> {
    if let Some(cancel_token) = cancel_token {
        tokio::select! {
            _ = cancel_token.cancelled() => Err(exec_cancelled_error()),
            _ = tokio::time::sleep(delay) => Ok(()),
        }
    } else {
        tokio::time::sleep(delay).await;
        Ok(())
    }
}

fn channel_open_retry_delay(retry_index: usize) -> Duration {
    Duration::from_millis(
        MANAGED_CHANNEL_OPEN_RETRY_DELAYS_MS
            .get(retry_index)
            .copied()
            .unwrap_or_else(|| *MANAGED_CHANNEL_OPEN_RETRY_DELAYS_MS.last().unwrap_or(&1000)),
    )
}

fn exec_cancelled_error() -> AppError {
    AppError::SshCommand("远程命令已取消".to_owned())
}

fn adjust_pending_exec_requests(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    delta: i64,
) {
    let Ok(mut sessions) = lock_sessions(inner) else {
        return;
    };
    let Some(entry) = sessions.get_mut(key) else {
        return;
    };
    if entry.session_id != session_id {
        return;
    }
    if delta >= 0 {
        entry.pending_exec_requests = entry.pending_exec_requests.saturating_add(delta as u64);
    } else {
        entry.pending_exec_requests = entry
            .pending_exec_requests
            .saturating_sub(delta.unsigned_abs());
    }
    entry.last_used_at = unix_timestamp();
}

fn exec_semaphore_for(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
) -> AppResult<Arc<Semaphore>> {
    let mut semaphores = inner
        .exec_semaphores
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("managed ssh exec queues"))?;
    Ok(Arc::clone(semaphores.entry(key.clone()).or_insert_with(
        || Arc::new(Semaphore::new(inner.max_concurrent_exec_channels)),
    )))
}

fn channel_open_semaphore_for(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
) -> AppResult<Arc<Semaphore>> {
    let mut semaphores = inner
        .channel_open_semaphores
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("managed ssh channel open gates"))?;
    Ok(Arc::clone(
        semaphores
            .entry(key.clone())
            .or_insert_with(|| Arc::new(Semaphore::new(1))),
    ))
}

async fn acquire_channel_open_permit(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
) -> AppResult<OwnedSemaphorePermit> {
    channel_open_semaphore_for(inner, key)?
        .acquire_owned()
        .await
        .map_err(|_| AppError::SshCommand("managed SSH channel open gate is closed".to_owned()))
}

fn acquire_channel_open_permit_blocking(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
) -> AppResult<OwnedSemaphorePermit> {
    let semaphore = channel_open_semaphore_for(inner, key)?;
    loop {
        match Arc::clone(&semaphore).try_acquire_owned() {
            Ok(permit) => return Ok(permit),
            Err(TryAcquireError::NoPermits) => std::thread::sleep(Duration::from_millis(10)),
            Err(TryAcquireError::Closed) => {
                return Err(AppError::SshCommand(
                    "managed SSH channel open gate is closed".to_owned(),
                ));
            }
        }
    }
}

fn remove_channel_open_semaphore(inner: &Arc<ManagedSshSessionManagerInner>, key: &SshSessionKey) {
    let Ok(mut semaphores) = inner.channel_open_semaphores.lock() else {
        return;
    };
    semaphores.remove(key);
}

fn remove_exec_semaphore(inner: &Arc<ManagedSshSessionManagerInner>, key: &SshSessionKey) {
    let Ok(mut semaphores) = inner.exec_semaphores.lock() else {
        return;
    };
    semaphores.remove(key);
}

fn evict_failed_session_entry(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    entry: ManagedSshSessionEntry,
    reason: &str,
) {
    if entry.active_channels == 0 {
        entry.connection.disconnect(reason);
    }
    remove_channel_open_semaphore(inner, key);
    remove_exec_semaphore(inner, key);
}

fn release_channel(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    error: Option<String>,
) {
    let Ok(mut sessions) = lock_sessions(inner) else {
        return;
    };
    let Some(entry) = sessions.get_mut(key) else {
        return;
    };
    if entry.session_id != session_id {
        return;
    }
    entry.active_channels = entry.active_channels.saturating_sub(1);
    entry.last_used_at = unix_timestamp();
    if let Some(error) = error {
        entry.last_error = Some(error);
        entry.state = ManagedSshSessionState::Failed;
    }
    if entry.ref_count == 0
        && entry.active_channels == 0
        && entry.state == ManagedSshSessionState::Failed
    {
        if let Some(entry) = sessions.remove(key) {
            entry.connection.disconnect("last channel released");
        }
        remove_channel_open_semaphore(inner, key);
        remove_exec_semaphore(inner, key);
    }
}

fn lock_sessions(
    inner: &Arc<ManagedSshSessionManagerInner>,
) -> AppResult<MutexGuard<'_, HashMap<SshSessionKey, ManagedSshSessionEntry>>> {
    inner
        .sessions
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("managed ssh sessions"))
}
