//! Managed SSH session runtime.
//!
//! @author kongweiguang

use std::{
    collections::{BTreeMap, HashMap},
    fmt,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::remote_host::RemoteHost,
};

pub mod auth_broker;
pub mod error_classification;
pub mod native_backend;
pub mod session_key;

/// SSH runtime channel categories opened from a managed session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshChannelKind {
    Shell,
    Exec,
    Sftp,
    DirectTcpIp,
    ForwardListener,
}

impl SshChannelKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shell => "shell",
            Self::Exec => "exec",
            Self::Sftp => "sftp",
            Self::DirectTcpIp => "direct-tcpip",
            Self::ForwardListener => "forward-listener",
        }
    }
}

/// Host key policy for a managed SSH connection attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshRuntimeHostKeyPolicy {
    RequireKnown,
    TrustUnknown,
}

/// Auth material identity used for session keying. This never stores secret values.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SshAuthIdentity {
    Agent,
    VaultRef {
        secret_kind: SshAuthSecretKind,
        ref_id: String,
    },
    KeyPath {
        fingerprint: String,
        passphrase_ref: Option<String>,
    },
    SessionOnly {
        prompt_id: String,
    },
    PromptOnly,
}

/// Secret type represented by a vault ref or session-only prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthSecretKind {
    Password,
    PrivateKey,
    KeyPassphrase,
}

impl SshAuthSecretKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::PrivateKey => "private-key",
            Self::KeyPassphrase => "key-passphrase",
        }
    }
}

/// Stable peer identity that participates in SSH session reuse.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionPeer {
    pub role: SshSessionPeerRole,
    pub host_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuthIdentity,
}

impl SshSessionPeer {
    pub fn target(
        host_id: impl Into<String>,
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        auth: SshAuthIdentity,
    ) -> Self {
        Self {
            role: SshSessionPeerRole::Target,
            host_id: Some(host_id.into()),
            host: host.into(),
            port,
            username: username.into(),
            auth,
        }
    }

    pub fn jump(
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        auth: SshAuthIdentity,
    ) -> Self {
        Self {
            role: SshSessionPeerRole::Jump,
            host_id: None,
            host: host.into(),
            port,
            username: username.into(),
            auth,
        }
    }

    fn label(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

/// Peer role inside a target route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshSessionPeerRole {
    Target,
    Jump,
}

/// Complete key for managed SSH session reuse.
///
/// The key intentionally contains fingerprints and refs only; passwords, private
/// key contents, passphrases and prompt responses are represented elsewhere.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionKey {
    pub target: SshSessionPeer,
    #[serde(default)]
    pub jumps: Vec<SshSessionPeer>,
    pub known_hosts_profile: String,
    pub proxy_profile: Option<String>,
    #[serde(default)]
    pub runtime_flags: Vec<String>,
}

impl SshSessionKey {
    pub fn new(target: SshSessionPeer) -> Self {
        Self {
            target,
            jumps: Vec::new(),
            known_hosts_profile: "default".to_owned(),
            proxy_profile: None,
            runtime_flags: Vec::new(),
        }
    }

    pub fn with_jump(mut self, jump: SshSessionPeer) -> Self {
        self.jumps.push(jump);
        self
    }

    pub fn with_known_hosts_profile(mut self, profile: impl Into<String>) -> Self {
        self.known_hosts_profile = profile.into();
        self
    }

    pub fn with_proxy_profile(mut self, profile: impl Into<String>) -> Self {
        self.proxy_profile = Some(profile.into());
        self
    }

    pub fn with_runtime_flag(mut self, flag: impl Into<String>) -> Self {
        self.runtime_flags.push(flag.into());
        self.runtime_flags.sort();
        self.runtime_flags.dedup();
        self
    }

    pub fn summary(&self) -> SshSessionKeySummary {
        SshSessionKeySummary {
            target: self.target.label(),
            jumps: self.jumps.iter().map(SshSessionPeer::label).collect(),
            known_hosts_profile: self.known_hosts_profile.clone(),
            proxy_profile: self.proxy_profile.clone(),
            runtime_flags: self.runtime_flags.clone(),
        }
    }
}

/// Redacted key summary for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionKeySummary {
    pub target: String,
    pub jumps: Vec<String>,
    pub known_hosts_profile: String,
    pub proxy_profile: Option<String>,
    pub runtime_flags: Vec<String>,
}

/// Runtime state for one managed session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ManagedSshSessionState {
    Ready,
    Closing,
    Failed,
}

pub const MANAGED_SSH_EXEC_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support exec channels yet";
pub const MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support streaming exec channels yet";
pub const MANAGED_SSH_SFTP_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support SFTP channels yet";
pub const MANAGED_SSH_SHELL_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support shell channels yet";
pub const MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support local port forwarding yet";
pub const MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support remote port forwarding yet";
pub const MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support dynamic port forwarding yet";
pub const MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support remote dynamic port forwarding yet";
pub const MANAGED_SSH_CAPABILITY_RUNTIME_FLAG: &str = "capability";
pub const MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG: &str = "bulk-transfer";

const DEFAULT_MAX_CONCURRENT_EXEC_CHANNELS: usize = 4;
const MAX_RECENT_LEGACY_FALLBACKS: usize = 20;

/// Connection request passed to a managed SSH backend.
///
/// `key` remains the only value used for cache lookup and diagnostics. Native
/// connection material is carried separately so secrets never become part of
/// `SshSessionKey`.
#[derive(Clone)]
pub struct SshRuntimeConnectRequest {
    key: SshSessionKey,
    material: SshRuntimeConnectMaterial,
}

#[derive(Clone)]
enum SshRuntimeConnectMaterial {
    KeyOnly,
    Native {
        connect_timeout_seconds: u64,
        host: Box<RemoteHost>,
        host_key_policy: SshRuntimeHostKeyPolicy,
        keepalive_seconds: Option<u64>,
        known_hosts_path: PathBuf,
    },
}

impl fmt::Debug for SshRuntimeConnectRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut debug = formatter.debug_struct("SshRuntimeConnectRequest");
        debug.field("key", &self.key.summary());
        match &self.material {
            SshRuntimeConnectMaterial::KeyOnly => {
                debug.field("material", &"key-only");
            }
            SshRuntimeConnectMaterial::Native {
                connect_timeout_seconds,
                host,
                host_key_policy,
                keepalive_seconds,
                known_hosts_path,
            } => {
                debug
                    .field("material", &"native")
                    .field("host_id", &host.id)
                    .field("host", &host.host)
                    .field("port", &host.port)
                    .field("username", &host.username)
                    .field("auth_type", &host.auth_type)
                    .field("host_key_policy", host_key_policy)
                    .field("known_hosts_path", &redacted_path(known_hosts_path))
                    .field("connect_timeout_seconds", connect_timeout_seconds)
                    .field("keepalive_seconds", keepalive_seconds);
            }
        }
        debug.finish()
    }
}

impl SshRuntimeConnectRequest {
    pub fn key_only(key: SshSessionKey) -> Self {
        Self {
            key,
            material: SshRuntimeConnectMaterial::KeyOnly,
        }
    }

    pub fn native(
        key: SshSessionKey,
        host: RemoteHost,
        known_hosts_path: PathBuf,
        connect_timeout_seconds: u64,
    ) -> Self {
        Self {
            key,
            material: SshRuntimeConnectMaterial::Native {
                connect_timeout_seconds,
                host: Box::new(host),
                host_key_policy: SshRuntimeHostKeyPolicy::RequireKnown,
                keepalive_seconds: None,
                known_hosts_path,
            },
        }
    }

    pub fn key(&self) -> &SshSessionKey {
        &self.key
    }

    pub fn with_runtime_flag(mut self, flag: impl Into<String>) -> Self {
        self.key = self.key.with_runtime_flag(flag);
        self
    }

    pub fn with_host_key_policy(mut self, policy: SshRuntimeHostKeyPolicy) -> Self {
        if let SshRuntimeConnectMaterial::Native {
            host_key_policy, ..
        } = &mut self.material
        {
            *host_key_policy = policy;
        }
        self
    }

    pub fn with_keepalive_seconds(mut self, seconds: u64) -> Self {
        if let SshRuntimeConnectMaterial::Native {
            keepalive_seconds, ..
        } = &mut self.material
        {
            *keepalive_seconds = Some(seconds);
        }
        self
    }

    pub fn native_host(&self) -> Option<&RemoteHost> {
        match &self.material {
            SshRuntimeConnectMaterial::Native { host, .. } => Some(host.as_ref()),
            SshRuntimeConnectMaterial::KeyOnly => None,
        }
    }

    pub fn native_host_key_policy(&self) -> Option<SshRuntimeHostKeyPolicy> {
        match &self.material {
            SshRuntimeConnectMaterial::Native {
                host_key_policy, ..
            } => Some(*host_key_policy),
            SshRuntimeConnectMaterial::KeyOnly => None,
        }
    }

    pub fn native_known_hosts_path(&self) -> Option<&Path> {
        match &self.material {
            SshRuntimeConnectMaterial::Native {
                known_hosts_path, ..
            } => Some(known_hosts_path),
            SshRuntimeConnectMaterial::KeyOnly => None,
        }
    }

    pub fn native_keepalive_seconds(&self) -> Option<u64> {
        match &self.material {
            SshRuntimeConnectMaterial::Native {
                keepalive_seconds, ..
            } => *keepalive_seconds,
            SshRuntimeConnectMaterial::KeyOnly => None,
        }
    }

    pub fn native_connect_timeout_seconds(&self) -> Option<u64> {
        match &self.material {
            SshRuntimeConnectMaterial::Native {
                connect_timeout_seconds,
                ..
            } => Some(*connect_timeout_seconds),
            SshRuntimeConnectMaterial::KeyOnly => None,
        }
    }
}

/// Request for an interactive shell channel on an authenticated session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshRuntimeShellRequest {
    pub cols: u16,
    pub env: BTreeMap<String, String>,
    pub pixel_height: u32,
    pub pixel_width: u32,
    pub rows: u16,
    pub term: String,
}

impl SshRuntimeShellRequest {
    pub fn new(term: impl Into<String>, cols: u16, rows: u16) -> Self {
        Self {
            cols: cols.max(1),
            env: BTreeMap::new(),
            pixel_height: 0,
            pixel_width: 0,
            rows: rows.max(1),
            term: term.into(),
        }
    }

    pub fn with_env(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(name.into(), value.into());
        self
    }

    pub fn with_pixel_size(mut self, pixel_width: u32, pixel_height: u32) -> Self {
        self.pixel_width = pixel_width;
        self.pixel_height = pixel_height;
        self
    }
}

/// Interactive shell channel events emitted by an SSH backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshRuntimeShellEvent {
    Data(Vec<u8>),
    ExtendedData {
        data: Vec<u8>,
        ext: u32,
    },
    Eof,
    ExitSignal {
        error_message: String,
        signal_name: String,
    },
    ExitStatus(i32),
    Closed,
}

#[async_trait]
pub trait SshRuntimeShellSession: Send + Sync + fmt::Debug {
    async fn read_event(&self) -> AppResult<SshRuntimeShellEvent>;

    async fn write(&self, data: Vec<u8>) -> AppResult<()>;

    async fn resize(&self, cols: u16, rows: u16) -> AppResult<()>;

    async fn close(&self) -> AppResult<()>;
}

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

/// Global manager for authenticated SSH sessions.
#[derive(Clone)]
pub struct ManagedSshSessionManager {
    inner: Arc<ManagedSshSessionManagerInner>,
}

struct ManagedSshSessionManagerInner {
    backend: Arc<dyn SshRuntimeBackend>,
    exec_semaphores: Mutex<HashMap<SshSessionKey, Arc<Semaphore>>>,
    legacy_fallbacks: Mutex<Vec<ManagedSshLegacyFallbackSnapshot>>,
    max_concurrent_exec_channels: usize,
    sessions: Mutex<HashMap<SshSessionKey, ManagedSshSessionEntry>>,
}

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
            if let Some(entry) = sessions.get_mut(&key) {
                entry.ref_count = entry.ref_count.saturating_add(1);
                entry.last_used_at = unix_timestamp();
                return Ok(self.handle_for(&key, entry));
            }
        }

        let connection = self.inner.backend.connect(request)?;
        let mut sessions = self.sessions()?;
        if let Some(entry) = sessions.get_mut(&key) {
            entry.ref_count = entry.ref_count.saturating_add(1);
            entry.last_used_at = unix_timestamp();
            return Ok(self.handle_for(&key, entry));
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
        let connection = {
            let mut sessions = lock_sessions(inner)?;
            let entry = sessions
                .get_mut(key)
                .filter(|entry| entry.session_id == session_id)
                .ok_or_else(|| missing_session_error(session_id))?;
            entry.active_channels = entry.active_channels.saturating_add(1);
            entry.opened_channels = entry.opened_channels.saturating_add(1);
            entry.last_used_at = unix_timestamp();
            *entry.channel_counts.entry(kind).or_insert(0) += 1;
            Arc::clone(&entry.connection)
        };

        match connection.open_channel(kind) {
            Ok(channel_id) => Ok(ManagedSshChannel {
                channel_id,
                inner: Arc::clone(inner),
                key: key.clone(),
                kind,
                session_id: session_id.to_owned(),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
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
        let connection = begin_channel_operation(inner, key, session_id, SshChannelKind::Shell)?;
        if !connection.supports_shell() {
            release_channel(inner, key, session_id, None);
            return Err(AppError::SshCommand(
                MANAGED_SSH_SHELL_UNSUPPORTED.to_owned(),
            ));
        }

        match connection.open_shell(request).await {
            Ok(shell) => Ok(ManagedSshShellSession {
                inner: Arc::clone(inner),
                key: key.clone(),
                released: false,
                session_id: session_id.to_owned(),
                shell: Some(shell),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
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
        let connection = begin_channel_operation(inner, key, session_id, SshChannelKind::Sftp)?;

        match connection.open_sftp().await {
            Ok(stream) => Ok(ManagedSshSftpChannel {
                inner: Arc::clone(inner),
                key: key.clone(),
                released: false,
                session_id: session_id.to_owned(),
                stream: Some(stream),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
    }

    fn start_local_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection =
            begin_channel_operation(inner, key, session_id, SshChannelKind::DirectTcpIp)?;
        if !connection.supports_local_forward() {
            release_channel(inner, key, session_id, None);
            return Err(AppError::SshCommand(
                MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        match connection.start_local_forward(request) {
            Ok(task) => Ok(ManagedSshForwardTunnel {
                inner: Arc::clone(inner),
                key: key.clone(),
                kind: SshChannelKind::DirectTcpIp,
                session_id: session_id.to_owned(),
                task: Some(task),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
    }

    fn start_dynamic_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection =
            begin_channel_operation(inner, key, session_id, SshChannelKind::DirectTcpIp)?;
        if !connection.supports_dynamic_forward() {
            release_channel(inner, key, session_id, None);
            return Err(AppError::SshCommand(
                MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        match connection.start_dynamic_forward(request) {
            Ok(task) => Ok(ManagedSshForwardTunnel {
                inner: Arc::clone(inner),
                key: key.clone(),
                kind: SshChannelKind::DirectTcpIp,
                session_id: session_id.to_owned(),
                task: Some(task),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
    }

    fn start_remote_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection =
            begin_channel_operation(inner, key, session_id, SshChannelKind::ForwardListener)?;
        if !connection.supports_remote_forward() {
            release_channel(inner, key, session_id, None);
            return Err(AppError::SshCommand(
                MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        match connection.start_remote_forward(request) {
            Ok(task) => Ok(ManagedSshForwardTunnel {
                inner: Arc::clone(inner),
                key: key.clone(),
                kind: SshChannelKind::ForwardListener,
                session_id: session_id.to_owned(),
                task: Some(task),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
    }

    fn start_remote_dynamic_forward(
        inner: &Arc<ManagedSshSessionManagerInner>,
        key: &SshSessionKey,
        session_id: &str,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        let connection =
            begin_channel_operation(inner, key, session_id, SshChannelKind::ForwardListener)?;
        if !connection.supports_remote_dynamic_forward() {
            release_channel(inner, key, session_id, None);
            return Err(AppError::SshCommand(
                MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED.to_owned(),
            ));
        }

        match connection.start_remote_dynamic_forward(request) {
            Ok(task) => Ok(ManagedSshForwardTunnel {
                inner: Arc::clone(inner),
                key: key.clone(),
                kind: SshChannelKind::ForwardListener,
                session_id: session_id.to_owned(),
                task: Some(task),
            }),
            Err(error) => {
                release_channel(inner, key, session_id, Some(error.to_string()));
                Err(error)
            }
        }
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

/// Handle representing one logical user of a managed SSH session.
pub struct ManagedSshSessionHandle {
    inner: Arc<ManagedSshSessionManagerInner>,
    key: SshSessionKey,
    session_id: String,
}

impl fmt::Debug for ManagedSshSessionHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshSessionHandle")
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl ManagedSshSessionHandle {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn open_channel(&self, kind: SshChannelKind) -> AppResult<ManagedSshChannel> {
        ManagedSshSessionManager::open_channel(&self.inner, &self.key, &self.session_id, kind)
    }

    pub async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecOutput> {
        ManagedSshSessionManager::execute_exec(&self.inner, &self.key, &self.session_id, request)
            .await
    }

    pub async fn open_streaming_exec(
        &self,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<ManagedSshStreamingExecSession> {
        ManagedSshSessionManager::open_streaming_exec(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
        .await
    }

    pub async fn open_shell(
        &self,
        request: SshRuntimeShellRequest,
    ) -> AppResult<ManagedSshShellSession> {
        ManagedSshSessionManager::open_shell(&self.inner, &self.key, &self.session_id, request)
            .await
    }

    pub async fn open_sftp(&self) -> AppResult<ManagedSshSftpChannel> {
        ManagedSshSessionManager::open_sftp(&self.inner, &self.key, &self.session_id).await
    }

    pub fn start_local_forward(
        &self,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_local_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }

    pub fn start_dynamic_forward(
        &self,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_dynamic_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }

    pub fn start_remote_forward(
        &self,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_remote_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }

    pub fn start_remote_dynamic_forward(
        &self,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_remote_dynamic_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }
}

impl Drop for ManagedSshSessionHandle {
    fn drop(&mut self) {
        ManagedSshSessionManager::release_session(&self.inner, &self.key, &self.session_id);
    }
}

/// Managed interactive shell with an active diagnostics channel lease.
pub struct ManagedSshShellSession {
    inner: Arc<ManagedSshSessionManagerInner>,
    key: SshSessionKey,
    released: bool,
    session_id: String,
    shell: Option<Box<dyn SshRuntimeShellSession>>,
}

impl fmt::Debug for ManagedSshShellSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshShellSession")
            .field("released", &self.released)
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl ManagedSshShellSession {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub async fn read_event(&self) -> AppResult<SshRuntimeShellEvent> {
        self.shell()?.read_event().await
    }

    pub async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        self.shell()?.write(data).await
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        self.shell()?.resize(cols, rows).await
    }

    pub async fn close(&mut self) -> AppResult<()> {
        if self.released {
            return Ok(());
        }
        let result = match self.shell.as_ref() {
            Some(shell) => shell.close().await,
            None => Ok(()),
        };
        self.shell = None;
        self.release(result.as_ref().err().map(ToString::to_string));
        result
    }

    fn shell(&self) -> AppResult<&dyn SshRuntimeShellSession> {
        self.shell
            .as_deref()
            .ok_or_else(|| AppError::SshCommand("managed SSH shell channel is closed".to_owned()))
    }

    fn release(&mut self, error: Option<String>) {
        if self.released {
            return;
        }
        self.released = true;
        release_channel(&self.inner, &self.key, &self.session_id, error);
    }
}

impl Drop for ManagedSshShellSession {
    fn drop(&mut self) {
        self.shell = None;
        self.release(None);
    }
}

/// Managed streaming exec channel with an active diagnostics lease.
pub struct ManagedSshStreamingExecSession {
    inner: Arc<ManagedSshSessionManagerInner>,
    key: SshSessionKey,
    permit: Option<OwnedSemaphorePermit>,
    released: bool,
    session: Option<Box<dyn SshRuntimeStreamingExecSession>>,
    session_id: String,
    timeout: Duration,
}

impl fmt::Debug for ManagedSshStreamingExecSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshStreamingExecSession")
            .field("released", &self.released)
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl ManagedSshStreamingExecSession {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        self.session_mut()?.take_stdin()
    }

    pub fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.session_mut()?.take_stdout()
    }

    pub fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.session_mut()?.take_stderr()
    }

    pub fn close_stdin(&mut self) -> AppResult<()> {
        self.session_mut()?.close_stdin()
    }

    pub fn wait(&mut self) -> AppResult<SshRuntimeStreamingExecExit> {
        let timeout = self.timeout;
        let result = self.session_mut()?.wait(timeout);
        if result.is_ok() {
            self.session = None;
        }
        self.release(result.as_ref().err().map(ToString::to_string));
        result
    }

    pub fn kill(&mut self) -> AppResult<()> {
        self.session_mut()?.kill()
    }

    fn session_mut(&mut self) -> AppResult<&mut (dyn SshRuntimeStreamingExecSession + '_)> {
        match self.session.as_mut() {
            Some(session) => Ok(session.as_mut()),
            None => Err(AppError::SshCommand(
                "managed SSH streaming exec channel is closed".to_owned(),
            )),
        }
    }

    fn release(&mut self, error: Option<String>) {
        if self.released {
            return;
        }
        self.released = true;
        self.permit = None;
        release_channel(&self.inner, &self.key, &self.session_id, error);
    }
}

impl Drop for ManagedSshStreamingExecSession {
    fn drop(&mut self) {
        if let Some(session) = self.session.as_mut() {
            let _ = session.kill();
        }
        self.session = None;
        self.release(None);
    }
}

/// Managed SFTP subsystem stream with an active diagnostics channel lease.
pub struct ManagedSshSftpChannel {
    inner: Arc<ManagedSshSessionManagerInner>,
    key: SshSessionKey,
    released: bool,
    session_id: String,
    stream: Option<Box<dyn SshRuntimeSftpStream>>,
}

impl fmt::Debug for ManagedSshSftpChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshSftpChannel")
            .field("released", &self.released)
            .field("session_id", &self.session_id)
            .field("stream_taken", &self.stream.is_none())
            .finish_non_exhaustive()
    }
}

impl ManagedSshSftpChannel {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn take_stream(&mut self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        self.stream
            .take()
            .ok_or_else(|| AppError::Sftp("managed SSH SFTP stream is already taken".to_owned()))
    }

    fn release(&mut self, error: Option<String>) {
        if self.released {
            return;
        }
        self.released = true;
        release_channel(&self.inner, &self.key, &self.session_id, error);
    }
}

impl Drop for ManagedSshSftpChannel {
    fn drop(&mut self) {
        self.stream = None;
        self.release(None);
    }
}

/// Lease for one channel opened on a managed SSH session.
pub struct ManagedSshChannel {
    channel_id: String,
    inner: Arc<ManagedSshSessionManagerInner>,
    key: SshSessionKey,
    kind: SshChannelKind,
    session_id: String,
}

impl fmt::Debug for ManagedSshChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshChannel")
            .field("channel_id", &self.channel_id)
            .field("kind", &self.kind)
            .field("session_id", &self.session_id)
            .finish()
    }
}

impl ManagedSshChannel {
    pub fn channel_id(&self) -> &str {
        &self.channel_id
    }

    pub fn kind(&self) -> SshChannelKind {
        self.kind
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl Drop for ManagedSshChannel {
    fn drop(&mut self) {
        release_channel(&self.inner, &self.key, &self.session_id, None);
    }
}

/// Request for local SSH port forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeLocalForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

impl SshRuntimeLocalForwardRequest {
    pub fn new(
        bind_host: impl Into<String>,
        bind_port: u16,
        target_host: impl Into<String>,
        target_port: u16,
    ) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
            target_host: target_host.into(),
            target_port,
        }
    }
}

/// Request for local dynamic SOCKS forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeDynamicForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
}

impl SshRuntimeDynamicForwardRequest {
    pub fn new(bind_host: impl Into<String>, bind_port: u16) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
        }
    }
}

/// Request for remote dynamic SOCKS forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeRemoteDynamicForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
}

impl SshRuntimeRemoteDynamicForwardRequest {
    pub fn new(bind_host: impl Into<String>, bind_port: u16) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
        }
    }
}

/// Request for remote SSH port forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeRemoteForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

impl SshRuntimeRemoteForwardRequest {
    pub fn new(
        bind_host: impl Into<String>,
        bind_port: u16,
        target_host: impl Into<String>,
        target_port: u16,
    ) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
            target_host: target_host.into(),
            target_port,
        }
    }
}

/// Runtime-owned forwarding task. Implementations must not expose credentials in Debug.
pub trait SshRuntimeForwardTask: Send + fmt::Debug {
    fn id(&self) -> Option<String>;

    fn try_wait(&mut self) -> AppResult<Option<String>>;

    fn kill(&mut self) -> AppResult<()>;

    fn wait(&mut self);
}

/// Managed local forwarding tunnel with an active diagnostics channel lease.
pub struct ManagedSshForwardTunnel {
    inner: Arc<ManagedSshSessionManagerInner>,
    key: SshSessionKey,
    kind: SshChannelKind,
    session_id: String,
    task: Option<Box<dyn SshRuntimeForwardTask>>,
}

impl fmt::Debug for ManagedSshForwardTunnel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshForwardTunnel")
            .field("kind", &self.kind)
            .field("session_id", &self.session_id)
            .field("task", &self.task.as_ref().map(|task| task.id()))
            .finish()
    }
}

impl ManagedSshForwardTunnel {
    pub fn id(&self) -> Option<String> {
        self.task.as_ref().and_then(|task| task.id())
    }

    pub fn kind(&self) -> SshChannelKind {
        self.kind
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn try_wait(&mut self) -> AppResult<Option<String>> {
        let Some(task) = self.task.as_mut() else {
            return Ok(Some("managed SSH forward task already stopped".to_owned()));
        };
        match task.try_wait()? {
            Some(status) => {
                task.wait();
                self.task = None;
                Ok(Some(status))
            }
            None => Ok(None),
        }
    }

    pub fn kill(&mut self) -> AppResult<()> {
        if let Some(task) = self.task.as_mut() {
            task.kill()?;
        }
        Ok(())
    }

    pub fn wait(&mut self) {
        if let Some(mut task) = self.task.take() {
            task.wait();
        }
    }
}

impl Drop for ManagedSshForwardTunnel {
    fn drop(&mut self) {
        if let Some(task) = self.task.as_mut() {
            let _ = task.kill();
            task.wait();
        }
        self.task = None;
        release_channel(&self.inner, &self.key, &self.session_id, None);
    }
}

struct ManagedSshSessionEntry {
    active_channels: u64,
    channel_counts: BTreeMap<SshChannelKind, u64>,
    connection: Arc<dyn SshRuntimeConnection>,
    created_at: String,
    last_error: Option<String>,
    last_used_at: String,
    opened_channels: u64,
    pending_exec_requests: u64,
    ref_count: u64,
    session_id: String,
    state: ManagedSshSessionState,
}

impl ManagedSshSessionEntry {
    fn snapshot(
        &self,
        key: &SshSessionKey,
        max_concurrent_exec_channels: usize,
    ) -> ManagedSshSessionSnapshot {
        ManagedSshSessionSnapshot {
            active_channels: self.active_channels,
            channel_counts: self.channel_counts.clone(),
            created_at: self.created_at.clone(),
            key: key.summary(),
            last_error: self.last_error.clone(),
            last_used_at: self.last_used_at.clone(),
            max_concurrent_exec_channels,
            opened_channels: self.opened_channels,
            pending_exec_requests: self.pending_exec_requests,
            ref_count: self.ref_count,
            session_id: self.session_id.clone(),
            state: self.state,
        }
    }
}

/// Snapshot for all managed SSH sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSshRuntimeSnapshot {
    pub active_channels: u64,
    pub active_sessions: usize,
    pub generated_at: String,
    pub recent_legacy_fallbacks: Vec<ManagedSshLegacyFallbackSnapshot>,
    pub sessions: Vec<ManagedSshSessionSnapshot>,
}

/// Recent intentional legacy fallback diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSshLegacyFallbackSnapshot {
    pub capability: String,
    pub count: u64,
    pub last_at: String,
    pub reason: String,
    pub target: Option<String>,
}

/// Redacted session diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSshSessionSnapshot {
    pub active_channels: u64,
    pub channel_counts: BTreeMap<SshChannelKind, u64>,
    pub created_at: String,
    pub key: SshSessionKeySummary,
    pub last_error: Option<String>,
    pub last_used_at: String,
    pub max_concurrent_exec_channels: usize,
    pub opened_channels: u64,
    pub pending_exec_requests: u64,
    pub ref_count: u64,
    pub session_id: String,
    pub state: ManagedSshSessionState,
}

/// Request for a non-interactive exec channel on an authenticated session.
#[derive(Clone, Debug)]
pub struct SshRuntimeExecRequest {
    pub cancel_token: CancellationToken,
    pub max_output_bytes: usize,
    pub script: String,
    pub timeout_seconds: u64,
}

impl SshRuntimeExecRequest {
    pub fn new(script: String, timeout_seconds: u64, max_output_bytes: usize) -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            max_output_bytes,
            script,
            timeout_seconds,
        }
    }

    pub fn with_cancel_token(mut self, cancel_token: CancellationToken) -> Self {
        self.cancel_token = cancel_token;
        self
    }
}

/// Request for a long-running exec channel that streams stdin/stdout/stderr.
#[derive(Clone, Debug)]
pub struct SshRuntimeStreamingExecRequest {
    pub cancel_token: CancellationToken,
    pub command: String,
    pub timeout_seconds: u64,
}

impl SshRuntimeStreamingExecRequest {
    pub fn new(command: String, timeout_seconds: u64) -> Self {
        Self {
            cancel_token: CancellationToken::new(),
            command,
            timeout_seconds,
        }
    }

    pub fn with_cancel_token(mut self, cancel_token: CancellationToken) -> Self {
        self.cancel_token = cancel_token;
        self
    }
}

/// Exit result for a streaming exec channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeStreamingExecExit {
    pub exit_code: Option<i32>,
}

/// Runtime-owned streaming exec channel.
pub trait SshRuntimeStreamingExecSession: Send + fmt::Debug {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>>;

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>>;

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>>;

    fn close_stdin(&mut self) -> AppResult<()>;

    fn wait(&mut self, timeout: Duration) -> AppResult<SshRuntimeStreamingExecExit>;

    fn kill(&mut self) -> AppResult<()>;
}

/// Raw exec output returned by a backend before the manager applies output limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeExecRawOutput {
    pub exit_code: Option<i32>,
    pub stderr: Vec<u8>,
    pub stdout: Vec<u8>,
}

/// Bounded exec output safe for diagnostics and command callers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeExecOutput {
    pub duration_ms: u128,
    pub exit_code: Option<i32>,
    pub max_output_bytes: usize,
    pub stderr: String,
    pub stderr_bytes: usize,
    pub stderr_truncated: bool,
    pub stdout: String,
    pub stdout_bytes: usize,
    pub stdout_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LimitedExecOutput {
    captured_bytes: usize,
    text: String,
    truncated: bool,
}

impl SshRuntimeExecOutput {
    fn from_raw(raw: SshRuntimeExecRawOutput, max_output_bytes: usize, duration_ms: u128) -> Self {
        let stdout = limit_exec_output(raw.stdout, max_output_bytes);
        let stderr = limit_exec_output(raw.stderr, max_output_bytes);
        Self {
            duration_ms,
            exit_code: raw.exit_code,
            max_output_bytes,
            stderr: stderr.text,
            stderr_bytes: stderr.captured_bytes,
            stderr_truncated: stderr.truncated,
            stdout: stdout.text,
            stdout_bytes: stdout.captured_bytes,
            stdout_truncated: stdout.truncated,
        }
    }
}

#[derive(Debug)]
struct UnavailableSshRuntimeBackend;

impl SshRuntimeBackend for UnavailableSshRuntimeBackend {
    fn connect(
        &self,
        _request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        Err(AppError::SshCommand(
            "managed SSH runtime backend is not wired yet".to_owned(),
        ))
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
    let connection = begin_channel_operation(inner, key, session_id, SshChannelKind::Exec)?;
    if !connection.supports_exec() {
        release_channel(inner, key, session_id, None);
        return Err(AppError::SshCommand(
            MANAGED_SSH_EXEC_UNSUPPORTED.to_owned(),
        ));
    }

    let started = Instant::now();
    let timeout = Duration::from_secs(request.timeout_seconds);
    let cancel_token = request.cancel_token.clone();
    let max_output_bytes = request.max_output_bytes;
    let result = tokio::select! {
        _ = cancel_token.cancelled() => Err(exec_cancelled_error()),
        result = tokio::time::timeout(timeout, connection.execute_exec(request)) => {
            match result {
                Ok(result) => result.map(|raw| {
                    SshRuntimeExecOutput::from_raw(raw, max_output_bytes, started.elapsed().as_millis())
                }),
                Err(_) => Err(AppError::SshCommand(format!(
                    "远程命令执行超时（{} 秒）",
                    timeout.as_secs()
                ))),
            }
        }
    };
    let error = result.as_ref().err().map(ToString::to_string);
    release_channel(inner, key, session_id, error);
    result
}

async fn open_streaming_exec_with_permit(
    inner: &Arc<ManagedSshSessionManagerInner>,
    key: &SshSessionKey,
    session_id: &str,
    request: SshRuntimeStreamingExecRequest,
    permit: OwnedSemaphorePermit,
) -> AppResult<ManagedSshStreamingExecSession> {
    let connection = begin_channel_operation(inner, key, session_id, SshChannelKind::Exec)?;
    if !connection.supports_streaming_exec() {
        release_channel(inner, key, session_id, None);
        return Err(AppError::SshCommand(
            MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED.to_owned(),
        ));
    }

    let timeout = Duration::from_secs(request.timeout_seconds);
    match connection.open_streaming_exec(request).await {
        Ok(session) => Ok(ManagedSshStreamingExecSession {
            inner: Arc::clone(inner),
            key: key.clone(),
            permit: Some(permit),
            released: false,
            session: Some(session),
            session_id: session_id.to_owned(),
            timeout,
        }),
        Err(error) => {
            release_channel(inner, key, session_id, Some(error.to_string()));
            Err(error)
        }
    }
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

fn remove_exec_semaphore(inner: &Arc<ManagedSshSessionManagerInner>, key: &SshSessionKey) {
    let Ok(mut semaphores) = inner.exec_semaphores.lock() else {
        return;
    };
    semaphores.remove(key);
}

fn limit_exec_output(bytes: Vec<u8>, max_bytes: usize) -> LimitedExecOutput {
    let visible = bytes.len().min(max_bytes);
    LimitedExecOutput {
        captured_bytes: visible,
        text: String::from_utf8_lossy(&bytes[..visible]).into_owned(),
        truncated: bytes.len() > visible,
    }
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

fn missing_session_error(session_id: &str) -> AppError {
    AppError::SshCommand(format!("managed SSH session not found: {session_id}"))
}

fn redacted_path(path: &Path) -> String {
    format!(
        "<path:{}>",
        session_key::redacted_fingerprint_text(path.to_string_lossy().as_ref())
    )
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn truncate_diagnostic_text(value: String, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value;
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}
