//! Managed SSH authentication broker.
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use zeroize::Zeroize;

use crate::{
    error::{AppError, AppResult},
    services::{
        ssh_credential_resolver::{
            ResolvedSshAuthMaterial, ResolvedSshCredentialSource, ResolvedSshHopAuth,
            ResolvedSshHopRole, ResolvedSshRouteAuth, ResolvedSshRouteAuthSummary,
        },
        ssh_runtime::SshAuthSecretKind,
    },
};

/// In-memory broker for session-only SSH secrets.
///
/// The broker does not read terminal input or persist secrets. It only turns an
/// explicit UI prompt response into temporary auth material for the current app
/// lifetime, so later SSH capabilities can reuse the same session credential.
#[derive(Clone)]
pub struct SshAuthBroker {
    inner: Arc<SshAuthBrokerInner>,
}

struct SshAuthBrokerInner {
    next_generation: AtomicU64,
    session_secrets: Mutex<HashMap<SshSessionSecretKey, SshSessionSecretEntry>>,
}

impl fmt::Debug for SshAuthBroker {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshAuthBroker")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl Default for SshAuthBroker {
    fn default() -> Self {
        Self::new()
    }
}

impl SshAuthBroker {
    /// Create an empty auth broker.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(SshAuthBrokerInner {
                next_generation: AtomicU64::new(1),
                session_secrets: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Store a session-only secret returned by a trusted UI prompt.
    pub fn remember_session_secret(
        &self,
        input: SshSessionSecretInput,
    ) -> AppResult<SshSessionSecretReceipt> {
        validate_prompt_id(&input.prompt_id)?;
        if input.value.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "SSH session secret cannot be empty".to_owned(),
            ));
        }

        let key = SshSessionSecretKey {
            prompt_id: input.prompt_id.clone(),
            secret_kind: input.secret_kind,
        };
        let now = unix_timestamp();
        let generation = self.inner.next_generation.fetch_add(1, Ordering::Relaxed);
        let entry = SshSessionSecretEntry {
            created_at: now.clone(),
            generation,
            last_used_at: now,
            secret_kind: input.secret_kind,
            value: input.value,
        };

        self.session_secrets()?.insert(key, entry);
        Ok(SshSessionSecretReceipt {
            generation,
            prompt_id: input.prompt_id,
            secret_kind: input.secret_kind,
        })
    }

    /// 仅删除该 receipt 自己写入且仍为当前版本的 secret，避免旧会话清理误删并发新值。
    #[doc(hidden)]
    pub fn forget_session_secret_receipt(
        &self,
        receipt: &SshSessionSecretReceipt,
    ) -> AppResult<bool> {
        validate_prompt_id(&receipt.prompt_id)?;
        let key = SshSessionSecretKey {
            prompt_id: receipt.prompt_id.clone(),
            secret_kind: receipt.secret_kind,
        };
        let mut secrets = self.session_secrets()?;
        if secrets
            .get(&key)
            .is_some_and(|entry| entry.generation == receipt.generation)
        {
            secrets.remove(&key);
            return Ok(true);
        }
        Ok(false)
    }

    /// Remove one session-only secret from memory.
    pub fn forget_session_secret(
        &self,
        prompt_id: &str,
        secret_kind: SshAuthSecretKind,
    ) -> AppResult<bool> {
        validate_prompt_id(prompt_id)?;
        Ok(self
            .session_secrets()?
            .remove(&SshSessionSecretKey {
                prompt_id: prompt_id.to_owned(),
                secret_kind,
            })
            .is_some())
    }

    /// Clear every session-only secret. Use this on logout, app lock or session reset.
    pub fn clear_session_secrets(&self) -> AppResult<usize> {
        let mut secrets = self.session_secrets()?;
        let removed = secrets.len();
        secrets.clear();
        Ok(removed)
    }

    /// Resolve prompt-only hops using remembered session-only secrets.
    pub fn resolve_route_auth(
        &self,
        route: &ResolvedSshRouteAuth,
    ) -> AppResult<SshAuthBrokerResolution> {
        let mut prompts = Vec::new();
        let target = self.resolve_hop(&route.target, &mut prompts)?;
        let jumps = route
            .jumps
            .iter()
            .map(|hop| self.resolve_hop(hop, &mut prompts))
            .collect::<AppResult<Vec<_>>>()?;
        let resolved = ResolvedSshRouteAuth {
            summary: ResolvedSshRouteAuthSummary {
                target: target.summary.clone(),
                jumps: jumps.iter().map(|hop| hop.summary.clone()).collect(),
            },
            target,
            jumps,
        };

        if prompts.is_empty() {
            Ok(SshAuthBrokerResolution::Ready { auth: resolved })
        } else {
            Ok(SshAuthBrokerResolution::PromptRequired {
                partial_auth: resolved,
                prompt_plan: SshAuthPromptPlan { prompts },
            })
        }
    }

    /// Return a redacted snapshot for diagnostics.
    pub fn snapshot(&self) -> AppResult<SshAuthBrokerSnapshot> {
        let mut secrets = self
            .session_secrets()?
            .iter()
            .map(|(key, entry)| SshSessionSecretSnapshot {
                created_at: entry.created_at.clone(),
                last_used_at: entry.last_used_at.clone(),
                prompt_id: key.prompt_id.clone(),
                secret_kind: key.secret_kind,
            })
            .collect::<Vec<_>>();
        secrets.sort_by(|left, right| {
            left.prompt_id
                .cmp(&right.prompt_id)
                .then(left.secret_kind.as_str().cmp(right.secret_kind.as_str()))
        });
        Ok(SshAuthBrokerSnapshot {
            generated_at: unix_timestamp(),
            session_only_secret_count: secrets.len(),
            session_only_secrets: secrets,
        })
    }

    fn resolve_hop(
        &self,
        hop: &ResolvedSshHopAuth,
        prompts: &mut Vec<SshAuthPromptRequest>,
    ) -> AppResult<ResolvedSshHopAuth> {
        let ResolvedSshAuthMaterial::PromptOnly { reason, .. } = &hop.material else {
            return Ok(hop.clone());
        };

        let secret_kind = prompt_secret_kind(reason);
        let prompt_id =
            prompt_id_for_hop(hop.role, &hop.host, hop.port, &hop.username, secret_kind);
        let secret = self.take_session_secret(&prompt_id, secret_kind)?;
        if let Some(secret) = secret {
            let source = ResolvedSshCredentialSource::SessionOnly {
                prompt_id: prompt_id.clone(),
            };
            let material = match secret_kind {
                SshAuthSecretKind::Password => ResolvedSshAuthMaterial::Password {
                    value: secret,
                    source,
                },
                SshAuthSecretKind::PrivateKey => ResolvedSshAuthMaterial::PrivateKeyPem {
                    content: secret,
                    passphrase: None,
                    source,
                },
                SshAuthSecretKind::KeyPassphrase => {
                    return Err(AppError::InvalidInput(
                        "key passphrase prompt requires private key material".to_owned(),
                    ));
                }
            };
            return Ok(ResolvedSshHopAuth::from_material(
                hop.role,
                hop.host.clone(),
                hop.port,
                hop.username.clone(),
                material,
            ));
        }

        prompts.push(SshAuthPromptRequest {
            host: hop.host.clone(),
            port: hop.port,
            prompt_id,
            reason: reason.clone(),
            role: hop.role,
            secret_kind,
            username: hop.username.clone(),
        });
        Ok(hop.clone())
    }

    fn take_session_secret(
        &self,
        prompt_id: &str,
        secret_kind: SshAuthSecretKind,
    ) -> AppResult<Option<String>> {
        let mut secrets = self.session_secrets()?;
        let Some(entry) = secrets.get_mut(&SshSessionSecretKey {
            prompt_id: prompt_id.to_owned(),
            secret_kind,
        }) else {
            return Ok(None);
        };
        entry.last_used_at = unix_timestamp();
        Ok(Some(entry.value.clone()))
    }

    fn session_secrets(
        &self,
    ) -> AppResult<std::sync::MutexGuard<'_, HashMap<SshSessionSecretKey, SshSessionSecretEntry>>>
    {
        self.inner
            .session_secrets
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("ssh auth broker session secrets"))
    }
}

/// Build the stable prompt id used by the session-only auth broker.
pub fn session_secret_prompt_id(
    role: ResolvedSshHopRole,
    host: &str,
    port: u16,
    username: &str,
    secret_kind: SshAuthSecretKind,
) -> String {
    prompt_id_for_hop(role, host, port, username, secret_kind)
}

/// Result of resolving auth material through the broker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshAuthBrokerResolution {
    Ready {
        auth: ResolvedSshRouteAuth,
    },
    PromptRequired {
        partial_auth: ResolvedSshRouteAuth,
        prompt_plan: SshAuthPromptPlan,
    },
}

/// Session-only secret returned by the UI prompt.
#[derive(Clone, PartialEq, Eq)]
pub struct SshSessionSecretInput {
    pub prompt_id: String,
    pub secret_kind: SshAuthSecretKind,
    pub value: String,
}

impl fmt::Debug for SshSessionSecretInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshSessionSecretInput")
            .field("prompt_id", &self.prompt_id)
            .field("secret_kind", &self.secret_kind)
            .field("value", &"<redacted>")
            .finish()
    }
}

/// Receipt for a remembered session-only secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionSecretReceipt {
    #[serde(skip)]
    generation: u64,
    pub prompt_id: String,
    pub secret_kind: SshAuthSecretKind,
}

/// UI prompt plan for auth material that is not yet available.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptPlan {
    pub prompts: Vec<SshAuthPromptRequest>,
}

/// One prompt request. It contains routing context, never secret values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptRequest {
    pub prompt_id: String,
    pub role: ResolvedSshHopRole,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub secret_kind: SshAuthSecretKind,
    pub reason: String,
}

/// Redacted broker diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthBrokerSnapshot {
    pub generated_at: String,
    pub session_only_secret_count: usize,
    pub session_only_secrets: Vec<SshSessionSecretSnapshot>,
}

/// Redacted session-only secret metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionSecretSnapshot {
    pub prompt_id: String,
    pub secret_kind: SshAuthSecretKind,
    pub created_at: String,
    pub last_used_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SshSessionSecretKey {
    prompt_id: String,
    secret_kind: SshAuthSecretKind,
}

struct SshSessionSecretEntry {
    created_at: String,
    generation: u64,
    last_used_at: String,
    secret_kind: SshAuthSecretKind,
    value: String,
}

impl Drop for SshSessionSecretEntry {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

impl fmt::Debug for SshSessionSecretEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshSessionSecretEntry")
            .field("created_at", &self.created_at)
            .field("last_used_at", &self.last_used_at)
            .field("secret_kind", &self.secret_kind)
            .field("value", &"<redacted>")
            .finish()
    }
}

fn prompt_id_for_hop(
    role: ResolvedSshHopRole,
    host: &str,
    port: u16,
    username: &str,
    secret_kind: SshAuthSecretKind,
) -> String {
    format!(
        "ssh-auth:{}:{}@{}:{}:{}",
        role_key(role),
        username,
        host,
        port,
        secret_kind.as_str()
    )
}

fn prompt_secret_kind(reason: &str) -> SshAuthSecretKind {
    if reason.contains("private key") {
        SshAuthSecretKind::PrivateKey
    } else if reason.contains("passphrase") {
        SshAuthSecretKind::KeyPassphrase
    } else {
        SshAuthSecretKind::Password
    }
}

fn role_key(role: ResolvedSshHopRole) -> String {
    match role {
        ResolvedSshHopRole::Target => "target".to_owned(),
        ResolvedSshHopRole::Jump { index } => format!("jump-{index}"),
    }
}

fn validate_prompt_id(prompt_id: &str) -> AppResult<()> {
    if prompt_id.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "SSH auth prompt id cannot be empty".to_owned(),
        ));
    }
    if prompt_id.contains('\n') || prompt_id.contains('\r') {
        return Err(AppError::InvalidInput(
            "SSH auth prompt id cannot contain newline".to_owned(),
        ));
    }
    Ok(())
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
