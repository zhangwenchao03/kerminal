//! Session-only secret broker for external launch requests.
//!
//! @author kongweiguang

use std::{
    collections::{BTreeSet, HashMap},
    fmt, fs,
    io::Read,
    path::{Component, Path},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use uuid::Uuid;
use zeroize::Zeroize;

use crate::error::{AppError, AppResult};

use super::model::{
    ExternalSecretKind, ExternalSecretMaterial, ExternalSecretSlot, ExternalSecretSource,
    ExternalSessionSecretRef, ExternalSshLaunchRequest,
};

const MAX_PASSWORD_FILE_BYTES: u64 = 64 * 1024;
const DEFAULT_SECRET_CAPACITY: usize = 256;
const DEFAULT_ORPHAN_SECRET_TTL: Duration = Duration::from_secs(10 * 60);
const CONSUMED_PASSWORD_FILE_MARKER: &str = "<consumed-password-file>";

/// Converts launch-carried secrets into session-only refs and owns cleanup.
#[derive(Clone)]
pub struct ExternalLaunchSecretBroker {
    inner: Arc<ExternalLaunchSecretBrokerInner>,
}

struct ExternalLaunchSecretBrokerInner {
    capacity: usize,
    secrets: Mutex<HashMap<String, ExternalLaunchSecretEntry>>,
    ttl: Duration,
}

impl Default for ExternalLaunchSecretBroker {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for ExternalLaunchSecretBroker {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchSecretBroker")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl ExternalLaunchSecretBroker {
    pub fn new() -> Self {
        Self::with_limits(DEFAULT_SECRET_CAPACITY, DEFAULT_ORPHAN_SECRET_TTL)
    }

    /// 创建带容量和 orphan TTL 的 broker，主要供策略接线与确定性边界测试使用。
    pub fn with_limits(capacity: usize, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(ExternalLaunchSecretBrokerInner {
                capacity: capacity.max(1),
                secrets: Mutex::new(HashMap::new()),
                ttl: ttl.max(Duration::from_millis(1)),
            }),
        }
    }

    /// Move all secret values in the request into session-only storage.
    pub fn protect_request(
        &self,
        request: ExternalSshLaunchRequest,
    ) -> AppResult<ExternalSshLaunchRequest> {
        self.protect_prepared_request(prepare_request_password_file(request)?)
    }

    /// 保护已经在有界 worker 中完成文件读取的请求；该阶段只写内存 broker。
    pub(crate) fn protect_prepared_request(
        &self,
        mut request: ExternalSshLaunchRequest,
    ) -> AppResult<ExternalSshLaunchRequest> {
        let launch_id = request.id.clone();
        if request
            .auth
            .password_file
            .as_deref()
            .is_some_and(|path| path != CONSUMED_PASSWORD_FILE_MARKER)
        {
            return Err(AppError::InvalidInput(
                "external SSH launch password file was not prepared".to_owned(),
            ));
        }
        let protected = (|| {
            request.auth.password = self.protect_slot(launch_id.as_str(), request.auth.password)?;
            request.auth.key_passphrase =
                self.protect_slot(launch_id.as_str(), request.auth.key_passphrase)?;
            Ok(request)
        })();
        if protected.is_err() {
            // 一个请求可能含两个 secret；任一步失败都回滚本 launch，避免部分保留。
            let _ = self.clear_launch(&launch_id);
        }
        protected
    }

    /// Resolve a session-only secret ref for the next runtime boundary.
    pub fn resolve_secret(
        &self,
        secret_ref: &ExternalSessionSecretRef,
    ) -> AppResult<Option<String>> {
        let mut secrets = self.secrets()?;
        purge_expired(&mut secrets, self.inner.ttl);
        Ok(secrets
            .get(&secret_ref.ref_id)
            .filter(|entry| {
                entry.secret_ref.kind == secret_ref.kind
                    && entry.secret_ref.launch_id == secret_ref.launch_id
            })
            .map(|entry| entry.value.clone()))
    }

    /// Acknowledging a consumed launch clears external-launch-owned secret copies.
    pub fn ack_launch(&self, launch_id: &str) -> AppResult<usize> {
        self.clear_launch(launch_id)
    }

    pub fn cancel_launch(&self, launch_id: &str) -> AppResult<usize> {
        self.clear_launch(launch_id)
    }

    pub fn close_launch(&self, launch_id: &str) -> AppResult<usize> {
        self.clear_launch(launch_id)
    }

    pub fn exit_launch(&self, launch_id: &str) -> AppResult<usize> {
        self.clear_launch(launch_id)
    }

    pub fn clear_all(&self) -> AppResult<usize> {
        let mut secrets = self.secrets()?;
        let removed = secrets.len();
        secrets.clear();
        Ok(removed)
    }

    pub fn snapshot(&self) -> AppResult<ExternalLaunchSecretBrokerSnapshot> {
        let mut secrets = self.secrets()?;
        purge_expired(&mut secrets, self.inner.ttl);
        let launch_ids = secrets
            .values()
            .map(|entry| entry.secret_ref.launch_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        Ok(ExternalLaunchSecretBrokerSnapshot {
            active_secret_count: secrets.len(),
            launch_ids,
        })
    }

    fn protect_slot(
        &self,
        launch_id: &str,
        slot: Option<ExternalSecretSlot>,
    ) -> AppResult<Option<ExternalSecretSlot>> {
        let Some(slot) = slot else {
            return Ok(None);
        };
        match slot {
            ExternalSecretSlot::Inline(material) => {
                let secret_ref = self.store_secret(launch_id, material)?;
                Ok(Some(ExternalSecretSlot::session_ref(secret_ref)))
            }
            ExternalSecretSlot::SessionRef(secret_ref) => {
                Ok(Some(ExternalSecretSlot::session_ref(secret_ref)))
            }
        }
    }

    fn store_secret(
        &self,
        launch_id: &str,
        material: ExternalSecretMaterial,
    ) -> AppResult<ExternalSessionSecretRef> {
        let ref_id = format!(
            "external-secret:{launch_id}:{}:{}",
            material.kind.as_str(),
            Uuid::new_v4()
        );
        let secret_ref = ExternalSessionSecretRef {
            ref_id: ref_id.clone(),
            launch_id: launch_id.to_owned(),
            kind: material.kind,
            source: material.source.clone(),
        };
        let entry = ExternalLaunchSecretEntry {
            created_at: Instant::now(),
            secret_ref: secret_ref.clone(),
            value: material.into_value(),
        };
        let mut secrets = self.secrets()?;
        purge_expired(&mut secrets, self.inner.ttl);
        if secrets.len() >= self.inner.capacity {
            return Err(AppError::InvalidInput(format!(
                "external launch secret capacity exceeded ({})",
                self.inner.capacity
            )));
        }
        secrets.insert(ref_id, entry);
        Ok(secret_ref)
    }

    fn clear_launch(&self, launch_id: &str) -> AppResult<usize> {
        let mut secrets = self.secrets()?;
        let before = secrets.len();
        secrets.retain(|_, entry| entry.secret_ref.launch_id != launch_id);
        Ok(before.saturating_sub(secrets.len()))
    }

    fn secrets(&self) -> AppResult<MutexGuard<'_, HashMap<String, ExternalLaunchSecretEntry>>> {
        self.inner
            .secrets
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external launch secrets"))
    }
}

/// 在 blocking worker 内读取 password file，并立即从请求中移除路径。
pub(crate) fn prepare_request_password_file(
    mut request: ExternalSshLaunchRequest,
) -> AppResult<ExternalSshLaunchRequest> {
    if request.auth.password.is_none() {
        if let Some(password_file) = request.auth.password_file.take() {
            let material = ExternalSecretMaterial::new(
                ExternalSecretKind::Password,
                ExternalSecretSource::PasswordFile,
                read_password_file(&password_file)?,
            )?;
            request.auth.password = Some(ExternalSecretSlot::Inline(material));
            request.auth.password_file = Some(CONSUMED_PASSWORD_FILE_MARKER.to_owned());
        }
    } else if request.auth.password_file.is_some() {
        request.auth.password_file = Some(CONSUMED_PASSWORD_FILE_MARKER.to_owned());
    }
    Ok(request)
}

struct ExternalLaunchSecretEntry {
    created_at: Instant,
    secret_ref: ExternalSessionSecretRef,
    value: String,
}

impl Drop for ExternalLaunchSecretEntry {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

impl fmt::Debug for ExternalLaunchSecretEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchSecretEntry")
            .field("secret_ref", &self.secret_ref)
            .field("value", &"<redacted>")
            .finish()
    }
}

/// Redacted snapshot for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalLaunchSecretBrokerSnapshot {
    pub active_secret_count: usize,
    pub launch_ids: Vec<String>,
}

fn purge_expired(secrets: &mut HashMap<String, ExternalLaunchSecretEntry>, ttl: Duration) -> usize {
    let now = Instant::now();
    let before = secrets.len();
    secrets.retain(|_, entry| now.saturating_duration_since(entry.created_at) < ttl);
    before.saturating_sub(secrets.len())
}

fn read_password_file(path: &str) -> AppResult<String> {
    let path = Path::new(path);
    reject_unsafe_password_file_path(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::InvalidInput(
            "external SSH launch password file must not be a symbolic link".to_owned(),
        ));
    }
    if !metadata.is_file() {
        return Err(AppError::InvalidInput(
            "external SSH launch password file must be a regular file".to_owned(),
        ));
    }
    if metadata.len() > MAX_PASSWORD_FILE_BYTES {
        return Err(AppError::InvalidInput(format!(
            "external SSH launch password file exceeds {MAX_PASSWORD_FILE_BYTES} bytes"
        )));
    }
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(metadata.len().min(MAX_PASSWORD_FILE_BYTES) as usize);
    file.by_ref()
        .take(MAX_PASSWORD_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PASSWORD_FILE_BYTES {
        bytes.zeroize();
        return Err(AppError::InvalidInput(format!(
            "external SSH launch password file exceeds {MAX_PASSWORD_FILE_BYTES} bytes"
        )));
    }
    let mut content = String::from_utf8(bytes).map_err(|error| {
        let mut bytes = error.into_bytes();
        bytes.zeroize();
        AppError::InvalidInput("external SSH launch password file must be UTF-8".to_owned())
    })?;
    let password = content.lines().next().unwrap_or_default().to_owned();
    content.zeroize();
    if password.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "external SSH launch password file is empty".to_owned(),
        ));
    }
    Ok(password)
}

/// 拒绝 UNC、Win32 device namespace 和保留设备名，避免凭据读取落到网络或设备句柄。
fn reject_unsafe_password_file_path(path: &Path) -> AppResult<()> {
    let raw = path.to_string_lossy();
    let normalized = raw.replace('/', "\\");
    if normalized.starts_with("\\\\")
        || normalized.starts_with("\\?\\")
        || normalized.starts_with("\\.\\")
    {
        return Err(AppError::InvalidInput(
            "external SSH launch password file cannot use UNC or device paths".to_owned(),
        ));
    }
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if path.components().any(|component| {
        let Component::Normal(value) = component else {
            return false;
        };
        let name = value.to_string_lossy();
        let stem = name.split('.').next().unwrap_or_default();
        reserved
            .iter()
            .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    }) {
        return Err(AppError::InvalidInput(
            "external SSH launch password file cannot use a reserved device name".to_owned(),
        ));
    }
    Ok(())
}
