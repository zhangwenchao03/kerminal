//! Managed SSH runtime connection requests.
//!
//! @author kongweiguang

use std::{
    fmt,
    path::{Path, PathBuf},
};

use crate::{
    models::remote_host::RemoteHost,
    services::{
        ssh_credential_resolver::NativeSshRouteMaterial,
        ssh_runtime::{session_key, SshRuntimeHostKeyPolicy, SshSessionKey},
    },
};

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
        route_material: Option<Box<NativeSshRouteMaterial>>,
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
                route_material,
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
                    .field("keepalive_seconds", keepalive_seconds)
                    .field(
                        "route_material",
                        &route_material.as_ref().map(|_| "<runtime-material>"),
                    );
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
                route_material: None,
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

    pub fn with_native_route_material(mut self, route_material: NativeSshRouteMaterial) -> Self {
        if let SshRuntimeConnectMaterial::Native {
            route_material: material,
            ..
        } = &mut self.material
        {
            *material = Some(Box::new(route_material));
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

    pub fn native_route_material(&self) -> Option<&NativeSshRouteMaterial> {
        match &self.material {
            SshRuntimeConnectMaterial::Native { route_material, .. } => route_material.as_deref(),
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

fn redacted_path(path: &Path) -> String {
    format!(
        "<path:{}>",
        session_key::redacted_fingerprint_text(path.to_string_lossy().as_ref())
    )
}
