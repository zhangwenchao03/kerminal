//! Session-only secret broker for external launch requests.
//!
//! @author kongweiguang

use std::{
    collections::{BTreeSet, HashMap},
    fmt, fs,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::model::{
    ExternalSecretKind, ExternalSecretMaterial, ExternalSecretSlot, ExternalSecretSource,
    ExternalSessionSecretRef, ExternalSshLaunchRequest,
};

const MAX_PASSWORD_FILE_BYTES: u64 = 64 * 1024;

/// Converts launch-carried secrets into session-only refs and owns cleanup.
#[derive(Clone)]
pub struct ExternalLaunchSecretBroker {
    inner: Arc<ExternalLaunchSecretBrokerInner>,
}

#[derive(Default)]
struct ExternalLaunchSecretBrokerInner {
    secrets: Mutex<HashMap<String, ExternalLaunchSecretEntry>>,
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
        Self {
            inner: Arc::new(ExternalLaunchSecretBrokerInner::default()),
        }
    }

    /// Move all secret values in the request into session-only storage.
    pub fn protect_request(
        &self,
        mut request: ExternalSshLaunchRequest,
    ) -> AppResult<ExternalSshLaunchRequest> {
        let launch_id = request.id.clone();
        if request.auth.password.is_none() {
            if let Some(password_file) = request.auth.password_file.as_deref() {
                let material = ExternalSecretMaterial::new(
                    ExternalSecretKind::Password,
                    ExternalSecretSource::PasswordFile,
                    read_password_file(password_file)?,
                )?;
                request.auth.password = Some(ExternalSecretSlot::Inline(material));
            }
        }
        request.auth.password = self.protect_slot(launch_id.as_str(), request.auth.password)?;
        request.auth.key_passphrase =
            self.protect_slot(launch_id.as_str(), request.auth.key_passphrase)?;
        Ok(request)
    }

    /// Resolve a session-only secret ref for the next runtime boundary.
    pub fn resolve_secret(
        &self,
        secret_ref: &ExternalSessionSecretRef,
    ) -> AppResult<Option<String>> {
        let secrets = self.secrets()?;
        Ok(secrets
            .get(&secret_ref.ref_id)
            .filter(|entry| entry.secret_ref.kind == secret_ref.kind)
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
        let secrets = self.secrets()?;
        let launch_ids = secrets
            .values()
            .map(|entry| entry.secret_ref.launch_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut secret_refs = secrets.keys().cloned().collect::<Vec<_>>();
        secret_refs.sort();
        Ok(ExternalLaunchSecretBrokerSnapshot {
            active_secret_count: secrets.len(),
            launch_ids,
            secret_refs,
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
            secret_ref: secret_ref.clone(),
            value: material.into_value(),
        };
        self.secrets()?.insert(ref_id, entry);
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

struct ExternalLaunchSecretEntry {
    secret_ref: ExternalSessionSecretRef,
    value: String,
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
    pub secret_refs: Vec<String>,
}

fn read_password_file(path: &str) -> AppResult<String> {
    let path = Path::new(path);
    let metadata = fs::metadata(path)?;
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
    let content = fs::read_to_string(path)?;
    let password = content.lines().next().unwrap_or_default();
    if password.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "external SSH launch password file is empty".to_owned(),
        ));
    }
    Ok(password.to_owned())
}
