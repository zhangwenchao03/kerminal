//! Materializes external launch requests into temporary SSH runtime targets.
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex, MutexGuard},
};

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        RemoteHost, RemoteHostAuthType, RemoteHostCredentialStatus, SshJumpHostOptions, SshOptions,
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        ssh_credential_resolver::{ResolvedSshRouteAuth, SshCredentialResolver},
        ssh_runtime::{
            auth_broker::{
                session_secret_prompt_id, SshAuthBroker, SshAuthBrokerResolution,
                SshSessionSecretInput, SshSessionSecretReceipt,
            },
            SshAuthSecretKind,
        },
    },
};

use super::{
    intake::ExternalLaunchIntake,
    model::{ExternalSecretKind, ExternalSessionSecretRef, ExternalSshLaunchRequest},
};

pub const EXTERNAL_TARGET_PREFIX: &str = "external:";

/// Turns a trusted external launch request into a temporary SSH target.
#[derive(Clone)]
pub struct ExternalSessionMaterializer {
    inner: Arc<ExternalSessionMaterializerInner>,
}

struct ExternalSessionMaterializerInner {
    auth_broker: SshAuthBroker,
    intake: ExternalLaunchIntake,
    targets: Mutex<HashMap<String, ExternalMaterializedTarget>>,
}

impl fmt::Debug for ExternalSessionMaterializer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalSessionMaterializer")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl ExternalSessionMaterializer {
    pub fn new(intake: ExternalLaunchIntake, auth_broker: SshAuthBroker) -> Self {
        Self {
            inner: Arc::new(ExternalSessionMaterializerInner {
                auth_broker,
                intake,
                targets: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn materialize(
        &self,
        paths: &KerminalPaths,
        launch_id: &str,
        username_override: Option<String>,
    ) -> AppResult<ExternalMaterializedTarget> {
        tauri_plugin_log::log::info!(
            target: "external_launch.materializer",
            "materialize requested launch_id={} username_override_present={}",
            launch_id,
            username_override
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        );
        let request = self
            .inner
            .intake
            .active_request(launch_id)?
            .ok_or_else(|| AppError::NotFound(format!("外部 SSH 启动请求不存在: {launch_id}")))?;
        let target = self.materialize_request(paths, request, username_override)?;
        tauri_plugin_log::log::info!(
            target: "external_launch.materializer",
            "materialized launch_id={} target_id={} target={}@{}:{} auth_type={:?} route_hops={}",
            target.launch_id,
            target.host_id,
            redacted_external_username(&target.host.username),
            target.host.host,
            target.host.port,
            target.host.auth_type,
            target.route_auth.jumps.len()
        );
        self.targets()?
            .insert(target.host_id.clone(), target.clone());
        Ok(target)
    }

    pub fn resolve_target(&self, host_id: &str) -> AppResult<Option<ExternalMaterializedTarget>> {
        if !is_external_target_id(host_id) {
            return Ok(None);
        }
        Ok(self.targets()?.get(host_id).cloned())
    }

    pub fn forget_launch(&self, launch_id: &str) -> AppResult<bool> {
        let host_id = external_target_id(launch_id);
        let removed = self.targets()?.remove(&host_id);
        if let Some(target) = &removed {
            for receipt in &target.session_secret_receipts {
                self.inner
                    .auth_broker
                    .forget_session_secret(&receipt.prompt_id, receipt.secret_kind)?;
            }
        }
        self.inner.intake.forget_active(launch_id)?;
        Ok(removed.is_some())
    }

    pub fn snapshot(&self) -> AppResult<ExternalMaterializerSnapshot> {
        let mut target_ids = self.targets()?.keys().cloned().collect::<Vec<_>>();
        target_ids.sort();
        Ok(ExternalMaterializerSnapshot { target_ids })
    }

    fn materialize_request(
        &self,
        paths: &KerminalPaths,
        request: ExternalSshLaunchRequest,
        username_override: Option<String>,
    ) -> AppResult<ExternalMaterializedTarget> {
        let username = resolve_username(&request, username_override)?;
        let mut receipts = Vec::new();
        let mut host = request_to_remote_host(&request, &username);

        if let Some(password) = request.auth.password.as_ref() {
            let secret_ref = password.as_session_ref().ok_or_else(|| {
                AppError::Credential("external password was not protected".to_owned())
            })?;
            if secret_ref.kind != ExternalSecretKind::Password {
                return Err(AppError::Credential(
                    "external password secret ref has unexpected kind".to_owned(),
                ));
            }
            let password = self
                .inner
                .intake
                .secret_broker()
                .resolve_secret(secret_ref)?
                .ok_or_else(|| external_secret_expired_error(secret_ref))?;
            let prompt_id = session_secret_prompt_id(
                crate::services::ssh_credential_resolver::ResolvedSshHopRole::Target,
                &host.host,
                host.port,
                &host.username,
                SshAuthSecretKind::Password,
            );
            let receipt =
                self.inner
                    .auth_broker
                    .remember_session_secret(SshSessionSecretInput {
                        prompt_id,
                        secret_kind: SshAuthSecretKind::Password,
                        value: password,
                    })?;
            receipts.push(receipt);
        }
        if let Some(passphrase) = request.auth.key_passphrase.as_ref() {
            let secret_ref = passphrase.as_session_ref().ok_or_else(|| {
                AppError::Credential("external key passphrase was not protected".to_owned())
            })?;
            if secret_ref.kind != ExternalSecretKind::KeyPassphrase {
                return Err(AppError::Credential(
                    "external key passphrase secret ref has unexpected kind".to_owned(),
                ));
            }
            let passphrase = self
                .inner
                .intake
                .secret_broker()
                .resolve_secret(secret_ref)?
                .ok_or_else(|| external_secret_expired_error(secret_ref))?;
            let prompt_id = session_secret_prompt_id(
                crate::services::ssh_credential_resolver::ResolvedSshHopRole::Target,
                &host.host,
                host.port,
                &host.username,
                SshAuthSecretKind::KeyPassphrase,
            );
            let receipt =
                self.inner
                    .auth_broker
                    .remember_session_secret(SshSessionSecretInput {
                        prompt_id,
                        secret_kind: SshAuthSecretKind::KeyPassphrase,
                        value: passphrase.clone(),
                    })?;
            host.key_passphrase_secret = Some(passphrase);
            receipts.push(receipt);
        }

        let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
        let resolved_auth = resolver.resolve_host(&host)?;
        let resolved_auth = match self.inner.auth_broker.resolve_route_auth(&resolved_auth)? {
            SshAuthBrokerResolution::Ready { auth } => auth,
            SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                return Err(AppError::Credential(format!(
                    "external SSH launch still requires authentication: {}",
                    prompt_plan
                        .prompts
                        .iter()
                        .map(|prompt| format!(
                            "{}@{}:{} {}",
                            prompt.username,
                            prompt.host,
                            prompt.port,
                            prompt.secret_kind.as_str()
                        ))
                        .collect::<Vec<_>>()
                        .join(", ")
                )));
            }
        };
        let runtime_host =
            SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved_auth);
        Ok(ExternalMaterializedTarget {
            display_name: display_name(&request, &runtime_host),
            host: runtime_host,
            host_id: external_target_id(&request.id),
            launch_id: request.id,
            route_auth: resolved_auth,
            session_secret_receipts: receipts,
        })
    }

    fn targets(&self) -> AppResult<MutexGuard<'_, HashMap<String, ExternalMaterializedTarget>>> {
        self.inner
            .targets
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("external materialized targets"))
    }
}

/// A temporary SSH target generated from an external launch.
#[derive(Clone, PartialEq, Eq)]
pub struct ExternalMaterializedTarget {
    pub display_name: String,
    pub host: RemoteHost,
    pub host_id: String,
    pub launch_id: String,
    pub route_auth: ResolvedSshRouteAuth,
    pub session_secret_receipts: Vec<SshSessionSecretReceipt>,
}

impl fmt::Debug for ExternalMaterializedTarget {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalMaterializedTarget")
            .field("display_name", &self.display_name)
            .field("host_id", &self.host_id)
            .field("launch_id", &self.launch_id)
            .field("host", &self.host.host)
            .field("port", &self.host.port)
            .field("username", &redacted_external_username(&self.host.username))
            .field("auth_type", &self.host.auth_type)
            .field("route_summary", &self.route_auth.summary)
            .field(
                "session_secret_receipts",
                &self.session_secret_receipts.len(),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalMaterializerSnapshot {
    pub target_ids: Vec<String>,
}

pub fn external_target_id(launch_id: &str) -> String {
    format!("{EXTERNAL_TARGET_PREFIX}{launch_id}")
}

pub fn is_external_target_id(host_id: &str) -> bool {
    host_id.starts_with(EXTERNAL_TARGET_PREFIX)
}

fn resolve_username(
    request: &ExternalSshLaunchRequest,
    username_override: Option<String>,
) -> AppResult<String> {
    username_override
        .or_else(|| request.target.username.clone())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput("external SSH launch username is required".to_owned())
        })
}

fn request_to_remote_host(request: &ExternalSshLaunchRequest, username: &str) -> RemoteHost {
    let auth_type = if request.auth.password.is_some() {
        RemoteHostAuthType::Password
    } else if request.auth.identity_file.is_some() {
        RemoteHostAuthType::Key
    } else {
        RemoteHostAuthType::Agent
    };
    let credential_status = match auth_type {
        RemoteHostAuthType::Agent => RemoteHostCredentialStatus::Agent,
        RemoteHostAuthType::Password | RemoteHostAuthType::Key => {
            RemoteHostCredentialStatus::Missing
        }
    };
    RemoteHost {
        auth_type,
        created_at: request.received_at.clone(),
        credential_ref: request.auth.identity_file.clone(),
        credential_secret: None,
        credential_status,
        group_id: None,
        host: request.target.host.clone(),
        id: external_target_id(&request.id),
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        name: display_name_from_request(request),
        port: request.target.port,
        production: false,
        secret_ref: None,
        sort_order: 0,
        ssh_options: request_ssh_options(request, username),
        tags: vec![
            "external".to_owned(),
            request.source.tool.as_str().to_owned(),
        ],
        updated_at: request.received_at.clone(),
        username: username.to_owned(),
    }
}

fn request_ssh_options(request: &ExternalSshLaunchRequest, username: &str) -> SshOptions {
    SshOptions {
        jump_hosts: request
            .target
            .route
            .iter()
            .enumerate()
            .map(|(index, hop)| SshJumpHostOptions {
                auth_type: RemoteHostAuthType::Agent,
                credential_ref: None,
                credential_secret: None,
                credential_status: RemoteHostCredentialStatus::Agent,
                host: hop.host.clone(),
                key_passphrase_ref: None,
                key_passphrase_secret: None,
                name: format!("External jump {}", index + 1),
                port: hop.port,
                secret_ref: None,
                username: hop.username.clone().unwrap_or_else(|| username.to_owned()),
            })
            .collect(),
        ..Default::default()
    }
}

fn redacted_external_username(username: &str) -> String {
    if username
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
    {
        "b64>><redacted>".to_owned()
    } else {
        username.to_owned()
    }
}

fn display_name(request: &ExternalSshLaunchRequest, host: &RemoteHost) -> String {
    request
        .options
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| host.name.clone())
}

fn display_name_from_request(request: &ExternalSshLaunchRequest) -> String {
    request
        .options
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| request.target.display_name())
}

fn external_secret_expired_error(secret_ref: &ExternalSessionSecretRef) -> AppError {
    AppError::Credential(format!(
        "外部 SSH 启动凭据已过期或不可用，请从外部 SSH 客户端重新发起连接。launch_id={} secret_kind={}",
        secret_ref.launch_id,
        secret_ref.kind.as_str()
    ))
}
