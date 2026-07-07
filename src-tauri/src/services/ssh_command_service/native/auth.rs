use crate::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions},
    services::{
        ssh_command_service::native::{NativeSshAuthMaterial, NativeSshPrivateKey},
        ssh_credential_resolver::{
            NativeSshAuthMaterial as RuntimeNativeSshAuthMaterial, NativeSshHopMaterial,
            ResolvedSshHopRole,
        },
        ssh_identity_file::resolve_identity_file_path,
    },
};

pub(crate) fn resolve_native_auth_material(host: &RemoteHost) -> AppResult<NativeSshAuthMaterial> {
    match host.auth_type {
        RemoteHostAuthType::Agent => Ok(NativeSshAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_credential_secret(host, "密码认证需要已保存 SSH 密码")?;
            Ok(NativeSshAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_credential_secret(host) {
                return Ok(NativeSshAuthMaterial::PrivateKey(
                    NativeSshPrivateKey::Pem {
                        content: secret.to_owned(),
                        passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
                    },
                ));
            }
            let credential_ref = required_credential_ref(host)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(
                    "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                        .to_owned(),
                ));
            }
            Ok(NativeSshAuthMaterial::PrivateKey(
                NativeSshPrivateKey::Path {
                    path: resolve_identity_file_path(credential_ref)?,
                    passphrase: normalized_key_passphrase_secret(host).map(ToOwned::to_owned),
                },
            ))
        }
    }
}

pub(super) fn resolve_native_jump_auth_material(
    jump: &SshJumpHostOptions,
    label: &str,
) -> AppResult<NativeSshAuthMaterial> {
    match jump.auth_type {
        RemoteHostAuthType::Agent => Ok(NativeSshAuthMaterial::Agent),
        RemoteHostAuthType::Password => {
            let password = required_jump_credential_secret(
                jump,
                &format!("{label} 密码认证需要已保存 SSH 密码"),
            )?;
            Ok(NativeSshAuthMaterial::Password(password))
        }
        RemoteHostAuthType::Key => {
            if let Some(secret) = normalized_jump_credential_secret(jump) {
                return Ok(NativeSshAuthMaterial::PrivateKey(
                    NativeSshPrivateKey::Pem {
                        content: secret.to_owned(),
                        passphrase: normalized_jump_key_passphrase_secret(jump)
                            .map(ToOwned::to_owned),
                    },
                ));
            }
            let credential_ref = required_jump_credential_ref(jump, label)?;
            if credential_ref.starts_with("credential:") {
                return Err(AppError::InvalidInput(format!(
                    "{label} 不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容"
                )));
            }
            Ok(NativeSshAuthMaterial::PrivateKey(
                NativeSshPrivateKey::Path {
                    path: resolve_identity_file_path(credential_ref)?,
                    passphrase: normalized_jump_key_passphrase_secret(jump).map(ToOwned::to_owned),
                },
            ))
        }
    }
}

pub(super) fn native_auth_material_from_runtime(
    material: &RuntimeNativeSshAuthMaterial,
) -> AppResult<NativeSshAuthMaterial> {
    match material {
        RuntimeNativeSshAuthMaterial::Agent { .. } => Ok(NativeSshAuthMaterial::Agent),
        RuntimeNativeSshAuthMaterial::Password { value, .. } => {
            Ok(NativeSshAuthMaterial::Password(value.clone()))
        }
        RuntimeNativeSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => Ok(NativeSshAuthMaterial::PrivateKey(
            NativeSshPrivateKey::Path {
                path: resolve_identity_file_path(&path.to_string_lossy())?,
                passphrase: passphrase.as_ref().map(|value| value.value.clone()),
            },
        )),
        RuntimeNativeSshAuthMaterial::PrivateKeyPem {
            content,
            passphrase,
            ..
        } => Ok(NativeSshAuthMaterial::PrivateKey(
            NativeSshPrivateKey::Pem {
                content: content.clone(),
                passphrase: passphrase.as_ref().map(|value| value.value.clone()),
            },
        )),
    }
}

pub(super) fn native_runtime_hop_label(hop: &NativeSshHopMaterial) -> String {
    match hop.role {
        ResolvedSshHopRole::Target => "目标主机".to_owned(),
        ResolvedSshHopRole::Jump { index } => format!("跳板主机 jump-{index}"),
    }
}

fn required_credential_ref(host: &RemoteHost) -> AppResult<&str> {
    host.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::InvalidInput("密钥认证需要保存私钥路径或明文私钥内容".to_owned()))
}

fn required_credential_secret(host: &RemoteHost, message: &str) -> AppResult<String> {
    normalized_credential_secret(host)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn normalized_key_passphrase_secret(host: &RemoteHost) -> Option<&str> {
    host.key_passphrase_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn required_jump_credential_ref<'a>(
    jump: &'a SshJumpHostOptions,
    label: &str,
) -> AppResult<&'a str> {
    jump.credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!("{label} 密钥认证需要保存私钥路径或明文私钥内容"))
        })
}

fn required_jump_credential_secret(jump: &SshJumpHostOptions, message: &str) -> AppResult<String> {
    normalized_jump_credential_secret(jump)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::InvalidInput(message.to_owned()))
}

fn normalized_jump_credential_secret(jump: &SshJumpHostOptions) -> Option<&str> {
    jump.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn normalized_jump_key_passphrase_secret(jump: &SshJumpHostOptions) -> Option<&str> {
    jump.key_passphrase_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

pub(super) fn required_native_text(value: &str, field: &str) -> AppResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        Err(AppError::InvalidInput(format!("{field} 不能为空")))
    } else {
        Ok(normalized.to_owned())
    }
}

pub(super) fn required_native_port(port: u16, field: &str) -> AppResult<u16> {
    if port == 0 {
        Err(AppError::InvalidInput(format!("{field} 必须大于 0")))
    } else {
        Ok(port)
    }
}
