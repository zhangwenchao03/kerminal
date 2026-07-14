//! 本地凭据存储服务。
//!
//! @author kongweiguang

use std::{fmt, sync::Arc};

use keyring::Entry;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE_NAME: &str = "Kerminal";

/// 凭据仓库抽象，生产使用 OS keychain，测试使用内存实现。
pub trait CredentialVault: Send + Sync {
    /// 保存 secret。
    fn set_secret(&self, credential_ref: &str, secret: &str) -> AppResult<()>;
    /// 读取 secret。
    fn get_secret(&self, credential_ref: &str) -> AppResult<Option<String>>;
    /// 删除 secret。
    fn delete_secret(&self, credential_ref: &str) -> AppResult<()>;
}

/// 凭据服务，负责生成引用并委托具体 vault。
#[derive(Clone)]
pub struct CredentialService {
    vault: Arc<dyn CredentialVault>,
}

impl fmt::Debug for CredentialService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CredentialService")
            .field("vault", &"<redacted>")
            .finish()
    }
}

impl Default for CredentialService {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialService {
    /// 创建使用 OS keychain 的凭据服务。
    pub fn new() -> Self {
        Self {
            vault: Arc::new(KeyringCredentialVault),
        }
    }

    /// 使用指定 vault 创建凭据服务，主要用于测试。
    pub fn with_vault(vault: Arc<dyn CredentialVault>) -> Self {
        Self { vault }
    }

    /// 保存 secret。
    pub fn set_secret(&self, credential_ref: &str, secret: &str) -> AppResult<()> {
        validate_credential_ref(credential_ref)?;
        if secret.trim().is_empty() {
            return Err(AppError::InvalidInput("凭据内容不能为空".to_string()));
        }
        self.vault.set_secret(credential_ref, secret)
    }

    /// 读取 secret。
    pub fn get_secret(&self, credential_ref: &str) -> AppResult<Option<String>> {
        validate_credential_ref(credential_ref)?;
        self.vault.get_secret(credential_ref)
    }

    /// 删除 secret。
    pub fn delete_secret(&self, credential_ref: &str) -> AppResult<()> {
        validate_credential_ref(credential_ref)?;
        self.vault.delete_secret(credential_ref)
    }
}

#[derive(Debug)]
struct KeyringCredentialVault;

impl CredentialVault for KeyringCredentialVault {
    fn set_secret(&self, credential_ref: &str, secret: &str) -> AppResult<()> {
        Entry::new(KEYRING_SERVICE_NAME, credential_ref)
            .map_err(keyring_error)?
            .set_password(secret)
            .map_err(keyring_error)
    }

    fn get_secret(&self, credential_ref: &str) -> AppResult<Option<String>> {
        let entry = Entry::new(KEYRING_SERVICE_NAME, credential_ref).map_err(keyring_error)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn delete_secret(&self, credential_ref: &str) -> AppResult<()> {
        Entry::new(KEYRING_SERVICE_NAME, credential_ref)
            .map_err(keyring_error)?
            .delete_credential()
            .map_err(keyring_error)
    }
}

fn validate_credential_ref(credential_ref: &str) -> AppResult<()> {
    if !credential_ref.starts_with("credential:") {
        return Err(AppError::InvalidInput("凭据引用格式不合法".to_string()));
    }
    if credential_ref.contains('\n') || credential_ref.contains('\r') {
        return Err(AppError::InvalidInput("凭据引用不能包含换行".to_string()));
    }
    Ok(())
}

fn keyring_error(error: keyring::Error) -> AppError {
    AppError::Credential(error.to_string())
}
