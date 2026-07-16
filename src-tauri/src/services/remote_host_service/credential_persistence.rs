//! 远程主机凭据引用的 vault 持久化边界。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    models::remote_host::{build_vault_secret_ref, parse_vault_secret_ref},
    services::encrypted_vault_service::{EncryptedVaultService, VaultUnitOfWork},
};

use super::normalize_optional_text;

pub(super) fn password_required_message(secret_kind: &str) -> String {
    if secret_kind == "rdp-host" {
        "RDP 密码认证需要填写明文密码".to_owned()
    } else {
        "密码认证需要填写明文 SSH 密码".to_owned()
    }
}

pub(super) fn reusable_secret_ref_for_kind(
    secret_ref: Option<String>,
    expected_kind: &str,
) -> Option<String> {
    let secret_ref = secret_ref?;
    match parse_vault_secret_ref(&secret_ref) {
        Ok(parsed) if parsed.kind == expected_kind => Some(secret_ref),
        Ok(_) | Err(_) => None,
    }
}

/// 单个主机凭据材料的持久化意图。
#[derive(Debug)]
pub(super) struct SecretPersistenceInput<'a> {
    pub(super) host_id: &'a str,
    pub(super) kind: &'a str,
    pub(super) scope: String,
    pub(super) material: &'a str,
    pub(super) plaintext: Option<String>,
    pub(super) existing_secret_ref: Option<String>,
}

/// 在共享 vault 工作单元内新增或复用凭据引用，不提前产生文件副作用。
pub(super) fn persist_secret_ref(
    vault: &EncryptedVaultService,
    unit: &mut VaultUnitOfWork,
    input: SecretPersistenceInput<'_>,
) -> AppResult<Option<String>> {
    let SecretPersistenceInput {
        host_id,
        kind,
        scope,
        material,
        plaintext,
        existing_secret_ref,
    } = input;
    let existing_secret_ref = existing_secret_ref.filter(|value| !value.trim().is_empty());
    let secret_ref = existing_secret_ref
        .clone()
        .unwrap_or_else(|| build_vault_secret_ref(kind, host_id, &scope, material));
    let Some(plaintext) = normalize_optional_text(plaintext) else {
        return Ok(existing_secret_ref);
    };
    vault.upsert_secret_in_unit(
        unit,
        &secret_ref,
        kind,
        secret_ref.as_bytes(),
        plaintext.as_bytes(),
    )?;
    Ok(Some(secret_ref))
}
