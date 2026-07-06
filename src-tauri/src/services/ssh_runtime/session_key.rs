//! Shared SSH session key construction.
//!
//! @author kongweiguang

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::{
    error::AppResult,
    models::remote_host::{RemoteHost, SshProxyProtocol},
    services::{
        ssh_credential_resolver::{
            ResolvedSshAuthMaterial, ResolvedSshCredentialSource, ResolvedSshRouteAuth,
        },
        ssh_runtime::{SshAuthIdentity, SshAuthSecretKind, SshSessionKey, SshSessionPeer},
    },
};

/// Build the base session key shared by shell, SFTP, exec and forwarding
/// capabilities for the same authenticated SSH route.
pub fn ssh_session_key_for_route(
    host: &RemoteHost,
    route_auth: &ResolvedSshRouteAuth,
    known_hosts_path: &Path,
) -> AppResult<SshSessionKey> {
    let mut key = SshSessionKey::new(SshSessionPeer::target(
        host.id.clone(),
        route_auth.target.host.clone(),
        route_auth.target.port,
        route_auth.target.username.clone(),
        auth_identity_from_material(&route_auth.target.material),
    ))
    .with_known_hosts_profile(format!(
        "known-hosts:{}",
        redacted_fingerprint_text(known_hosts_path.to_string_lossy().as_ref())
    ));

    if let Some(proxy_profile) = proxy_profile(host) {
        key = key.with_proxy_profile(proxy_profile);
    }

    for jump in &route_auth.jumps {
        key = key.with_jump(SshSessionPeer::jump(
            jump.host.clone(),
            jump.port,
            jump.username.clone(),
            auth_identity_from_material(&jump.material),
        ));
    }

    Ok(key)
}

#[doc(hidden)]
pub fn redacted_fingerprint_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn auth_identity_from_material(material: &ResolvedSshAuthMaterial) -> SshAuthIdentity {
    match material {
        ResolvedSshAuthMaterial::Agent { .. } => SshAuthIdentity::Agent,
        ResolvedSshAuthMaterial::Password { source, .. } => {
            auth_identity_from_source(source, SshAuthSecretKind::Password)
        }
        ResolvedSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => SshAuthIdentity::KeyPath {
            fingerprint: format!(
                "path:{}",
                redacted_fingerprint_text(path.to_string_lossy().as_ref())
            ),
            passphrase_ref: passphrase
                .as_ref()
                .and_then(|secret| credential_source_ref(&secret.source)),
        },
        ResolvedSshAuthMaterial::PrivateKeyPem { source, .. } => {
            auth_identity_from_source(source, SshAuthSecretKind::PrivateKey)
        }
        ResolvedSshAuthMaterial::PromptOnly { .. } => SshAuthIdentity::PromptOnly,
    }
}

fn auth_identity_from_source(
    source: &ResolvedSshCredentialSource,
    secret_kind: SshAuthSecretKind,
) -> SshAuthIdentity {
    match source {
        ResolvedSshCredentialSource::Agent => SshAuthIdentity::Agent,
        ResolvedSshCredentialSource::SessionOnly { prompt_id } => SshAuthIdentity::SessionOnly {
            prompt_id: prompt_id.clone(),
        },
        ResolvedSshCredentialSource::Vault(source) => SshAuthIdentity::VaultRef {
            secret_kind,
            ref_id: source.entry_id.clone(),
        },
        ResolvedSshCredentialSource::ConfigPath => SshAuthIdentity::KeyPath {
            fingerprint: "config-path".to_owned(),
            passphrase_ref: None,
        },
        ResolvedSshCredentialSource::PromptOnly => SshAuthIdentity::PromptOnly,
    }
}

fn credential_source_ref(source: &ResolvedSshCredentialSource) -> Option<String> {
    match source {
        ResolvedSshCredentialSource::SessionOnly { prompt_id } => Some(prompt_id.clone()),
        ResolvedSshCredentialSource::Vault(source) => Some(source.entry_id.clone()),
        ResolvedSshCredentialSource::Agent
        | ResolvedSshCredentialSource::ConfigPath
        | ResolvedSshCredentialSource::PromptOnly => None,
    }
}

fn proxy_profile(host: &RemoteHost) -> Option<String> {
    let proxy = &host.ssh_options.proxy;
    if matches!(proxy.protocol, SshProxyProtocol::None) {
        return None;
    }
    Some(format!(
        "{:?}:{}:{}:{}",
        proxy.protocol,
        proxy.host.as_deref().unwrap_or_default(),
        proxy.port.unwrap_or_default(),
        proxy.username.as_deref().unwrap_or_default()
    ))
}
