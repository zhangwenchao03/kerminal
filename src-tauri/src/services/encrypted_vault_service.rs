//! Kerminal encrypted workspace vault primitives.
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
};

pub const VAULT_KEY_SCHEMA_VERSION: u32 = 1;
pub const VAULT_SCHEMA_VERSION: u32 = 1;
pub const WORKSPACE_DEFAULT_KEY_ID: &str = "workspace-default";
pub const VAULT_ALGORITHM_XCHACHA20POLY1305: &str = "xchacha20poly1305";
const MASTER_KEY_BYTES: usize = 32;
const XCHACHA20_NONCE_BYTES: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultKeyFile {
    pub schema_version: u32,
    pub key_id: String,
    pub algorithm: String,
    pub created_at: String,
    pub master_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultFile {
    pub schema_version: u32,
    #[serde(default)]
    pub entries: Vec<VaultEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultEntry {
    pub id: String,
    pub kind: String,
    pub algorithm: String,
    pub key_id: String,
    #[serde(default)]
    pub associated_data: String,
    pub nonce: String,
    pub ciphertext: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct EncryptedVaultService {
    paths: KerminalPaths,
}

impl EncryptedVaultService {
    pub fn new(paths: KerminalPaths) -> Self {
        Self { paths }
    }

    pub fn paths(&self) -> &KerminalPaths {
        &self.paths
    }

    pub fn ensure_workspace_key_if_safe(&self) -> AppResult<Option<VaultKeyFile>> {
        if self.paths.vault_key_file().is_file() {
            return Ok(self.read_key().ok());
        }
        if self.paths.vault_file().is_file() {
            return Ok(None);
        }
        self.create_workspace_key().map(Some)
    }

    pub fn create_workspace_key(&self) -> AppResult<VaultKeyFile> {
        fs::create_dir_all(&self.paths.secrets)?;
        let key = self.new_workspace_key()?;
        write_toml_atomically(&self.paths.vault_key_file(), &key)?;
        Ok(key)
    }

    pub fn read_key(&self) -> AppResult<VaultKeyFile> {
        read_toml_file(&self.paths.vault_key_file())
    }

    pub fn read_vault(&self) -> AppResult<VaultFile> {
        if !self.paths.vault_file().is_file() {
            return Ok(VaultFile {
                schema_version: VAULT_SCHEMA_VERSION,
                entries: Vec::new(),
            });
        }
        read_toml_file(&self.paths.vault_file())
    }

    pub fn vault_has_entries(&self) -> AppResult<bool> {
        Ok(!self.read_vault()?.entries.is_empty())
    }

    pub fn entry_count(&self) -> AppResult<usize> {
        Ok(self.read_vault()?.entries.len())
    }

    pub fn entry_by_id(&self, entry_id: &str) -> AppResult<Option<VaultEntry>> {
        Ok(self
            .read_vault()?
            .entries
            .into_iter()
            .find(|entry| entry.id == entry_id))
    }

    pub fn upsert_secret(
        &self,
        entry_id: &str,
        kind: &str,
        associated_data: &[u8],
        plaintext: &[u8],
    ) -> AppResult<VaultEntry> {
        let key = self
            .ensure_workspace_key_if_safe()?
            .ok_or_else(|| AppError::Credential("vault key is missing".to_owned()))?;
        let mut vault = self.read_vault()?;
        let previous_created_at = vault
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .map(|entry| entry.created_at.clone());
        let mut next_entry =
            self.encrypt_secret(&key, entry_id, kind, associated_data, plaintext)?;
        if let Some(created_at) = previous_created_at {
            next_entry.created_at = created_at;
        }
        vault.entries.retain(|entry| entry.id != entry_id);
        vault.entries.push(next_entry.clone());
        vault.entries.sort_by(|left, right| left.id.cmp(&right.id));
        self.write_vault(&vault)?;
        Ok(next_entry)
    }

    pub fn write_vault(&self, vault: &VaultFile) -> AppResult<()> {
        write_toml_atomically(&self.paths.vault_file(), vault)
    }

    pub fn encrypt_secret(
        &self,
        key: &VaultKeyFile,
        entry_id: &str,
        kind: &str,
        associated_data: &[u8],
        plaintext: &[u8],
    ) -> AppResult<VaultEntry> {
        validate_key(key)?;
        let key_bytes = BASE64
            .decode(&key.master_key)
            .map_err(|error| AppError::Credential(format!("vault key base64 invalid: {error}")))?;
        let nonce_bytes: [u8; XCHACHA20_NONCE_BYTES] = random_bytes(XCHACHA20_NONCE_BYTES)?
            .try_into()
            .map_err(|_| AppError::Credential("vault nonce length invalid".to_owned()))?;
        let cipher = XChaCha20Poly1305::new_from_slice(&key_bytes)
            .map_err(|_| AppError::Credential("vault key length invalid".to_owned()))?;
        let nonce = XNonce::from(nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad: associated_data,
                },
            )
            .map_err(|_| AppError::Credential("vault encryption failed".to_owned()))?;
        let timestamp = current_unix_timestamp_string();
        Ok(VaultEntry {
            id: entry_id.to_owned(),
            kind: kind.to_owned(),
            algorithm: key.algorithm.clone(),
            key_id: key.key_id.clone(),
            associated_data: BASE64.encode(associated_data),
            nonce: BASE64.encode(nonce),
            ciphertext: BASE64.encode(ciphertext),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        })
    }

    pub fn decrypt_secret(
        &self,
        key: &VaultKeyFile,
        entry: &VaultEntry,
        associated_data: &[u8],
    ) -> AppResult<Vec<u8>> {
        validate_key(key)?;
        if entry.algorithm != key.algorithm || entry.key_id != key.key_id {
            return Err(AppError::Credential(
                "vault entry key metadata does not match".to_owned(),
            ));
        }
        if !entry.associated_data.is_empty() {
            let stored_associated_data =
                BASE64.decode(&entry.associated_data).map_err(|error| {
                    AppError::Credential(format!("vault associated data base64 invalid: {error}"))
                })?;
            if stored_associated_data != associated_data {
                return Err(AppError::Credential(
                    "vault associated data does not match".to_owned(),
                ));
            }
        }
        let key_bytes = BASE64
            .decode(&key.master_key)
            .map_err(|error| AppError::Credential(format!("vault key base64 invalid: {error}")))?;
        let nonce_bytes = BASE64.decode(&entry.nonce).map_err(|error| {
            AppError::Credential(format!("vault nonce base64 invalid: {error}"))
        })?;
        if nonce_bytes.len() != XCHACHA20_NONCE_BYTES {
            return Err(AppError::Credential(format!(
                "vault nonce must be {XCHACHA20_NONCE_BYTES} bytes"
            )));
        }
        let nonce_bytes: [u8; XCHACHA20_NONCE_BYTES] = nonce_bytes
            .try_into()
            .map_err(|_| AppError::Credential("vault nonce length invalid".to_owned()))?;
        let ciphertext = BASE64.decode(&entry.ciphertext).map_err(|error| {
            AppError::Credential(format!("vault ciphertext base64 invalid: {error}"))
        })?;
        let cipher = XChaCha20Poly1305::new_from_slice(&key_bytes)
            .map_err(|_| AppError::Credential("vault key length invalid".to_owned()))?;
        let nonce = XNonce::from(nonce_bytes);
        cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext.as_slice(),
                    aad: associated_data,
                },
            )
            .map_err(|_| AppError::Credential("vault decryption failed".to_owned()))
    }

    pub fn export_key_toml(&self) -> AppResult<String> {
        let key = self.read_key()?;
        validate_key(&key)?;
        toml::to_string_pretty(&key).map_err(|error| {
            AppError::Credential(format!("vault key TOML serialize failed: {error}"))
        })
    }

    pub fn read_key_toml_source(&self) -> AppResult<String> {
        let source = fs::read_to_string(self.paths.vault_key_file())?;
        let key: VaultKeyFile = toml::from_str(&source).map_err(|error| {
            AppError::Credential(format!("vault key TOML parse failed: {error}"))
        })?;
        validate_key(&key)?;
        Ok(source)
    }

    pub fn save_key_toml(&self, source: &str) -> AppResult<VaultKeyOperationResult> {
        self.import_key_toml(source, false)
    }

    pub fn import_key_toml(
        &self,
        source: &str,
        dry_run: bool,
    ) -> AppResult<VaultKeyOperationResult> {
        let key: VaultKeyFile = toml::from_str(source).map_err(|error| {
            AppError::Credential(format!("vault key TOML parse failed: {error}"))
        })?;
        validate_key(&key)?;
        let entry_count = self.validate_key_against_existing_vault(&key)?;
        let backup_created = !dry_run && self.paths.vault_key_file().is_file();
        if !dry_run {
            self.write_key_with_backup(&key)?;
        }
        Ok(VaultKeyOperationResult {
            key_id: key.key_id,
            dry_run,
            entry_count,
            backup_created,
        })
    }

    pub fn rotate_workspace_key(&self, dry_run: bool) -> AppResult<VaultKeyOperationResult> {
        let current_key = self.read_key()?;
        validate_key(&current_key)?;
        let vault = self.read_vault()?;
        let mut plaintext_entries = Vec::with_capacity(vault.entries.len());
        for entry in &vault.entries {
            let associated_data = entry_associated_data(entry)?;
            let plaintext = self.decrypt_secret(&current_key, entry, &associated_data)?;
            plaintext_entries.push((entry.clone(), associated_data, plaintext));
        }

        let next_key = self.new_workspace_key()?;
        let mut next_entries = Vec::with_capacity(plaintext_entries.len());
        for (previous_entry, associated_data, plaintext) in plaintext_entries {
            let mut next_entry = self.encrypt_secret(
                &next_key,
                &previous_entry.id,
                &previous_entry.kind,
                &associated_data,
                &plaintext,
            )?;
            next_entry.created_at = previous_entry.created_at;
            next_entries.push(next_entry);
        }
        if !dry_run {
            self.write_vault_with_backup(&VaultFile {
                schema_version: vault.schema_version,
                entries: next_entries,
            })?;
            self.write_key_with_backup(&next_key)?;
        }
        Ok(VaultKeyOperationResult {
            key_id: next_key.key_id,
            dry_run,
            entry_count: vault.entries.len(),
            backup_created: !dry_run,
        })
    }

    fn new_workspace_key(&self) -> AppResult<VaultKeyFile> {
        Ok(VaultKeyFile {
            schema_version: VAULT_KEY_SCHEMA_VERSION,
            key_id: WORKSPACE_DEFAULT_KEY_ID.to_owned(),
            algorithm: VAULT_ALGORITHM_XCHACHA20POLY1305.to_owned(),
            created_at: current_unix_timestamp_string(),
            master_key: BASE64.encode(random_bytes(MASTER_KEY_BYTES)?),
        })
    }

    fn validate_key_against_existing_vault(&self, key: &VaultKeyFile) -> AppResult<usize> {
        let vault = self.read_vault()?;
        for entry in &vault.entries {
            let associated_data = entry_associated_data(entry)?;
            let _ = self.decrypt_secret(key, entry, &associated_data)?;
        }
        Ok(vault.entries.len())
    }

    fn write_key_with_backup(&self, key: &VaultKeyFile) -> AppResult<()> {
        backup_file_if_present(&self.paths.vault_key_file())?;
        write_toml_atomically(&self.paths.vault_key_file(), key)
    }

    fn write_vault_with_backup(&self, vault: &VaultFile) -> AppResult<()> {
        backup_file_if_present(&self.paths.vault_file())?;
        write_toml_atomically(&self.paths.vault_file(), vault)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKeyOperationResult {
    pub key_id: String,
    pub dry_run: bool,
    pub entry_count: usize,
    pub backup_created: bool,
}

pub fn validate_key(key: &VaultKeyFile) -> AppResult<()> {
    if key.schema_version != VAULT_KEY_SCHEMA_VERSION {
        return Err(AppError::Credential(format!(
            "unsupported vault key schema version {}",
            key.schema_version
        )));
    }
    if key.algorithm != VAULT_ALGORITHM_XCHACHA20POLY1305 {
        return Err(AppError::Credential(format!(
            "unsupported vault algorithm {}",
            key.algorithm
        )));
    }
    let decoded = BASE64
        .decode(&key.master_key)
        .map_err(|error| AppError::Credential(format!("vault key base64 invalid: {error}")))?;
    if decoded.len() != MASTER_KEY_BYTES {
        return Err(AppError::Credential(format!(
            "vault key must be {MASTER_KEY_BYTES} bytes"
        )));
    }
    Ok(())
}

fn random_bytes(len: usize) -> AppResult<Vec<u8>> {
    let mut bytes = vec![0_u8; len];
    getrandom::fill(&mut bytes)
        .map_err(|error| AppError::Credential(format!("random generation failed: {error}")))?;
    Ok(bytes)
}

fn read_toml_file<T>(path: &Path) -> AppResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let source = fs::read_to_string(path)?;
    toml::from_str(&source)
        .map_err(|error| AppError::Credential(format!("vault TOML parse failed: {error}")))
}

pub fn write_toml_atomically<T>(path: &Path, value: &T) -> AppResult<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let source = toml::to_string_pretty(value)
        .map_err(|error| AppError::Credential(format!("vault TOML serialize failed: {error}")))?;
    let temp_path = atomic_temp_path(path);
    fs::write(&temp_path, source)?;
    replace_file(&temp_path, path)?;
    Ok(())
}

fn entry_associated_data(entry: &VaultEntry) -> AppResult<Vec<u8>> {
    if entry.associated_data.is_empty() {
        return Err(AppError::Credential(format!(
            "vault entry {} is missing associated data",
            entry.id
        )));
    }
    BASE64.decode(&entry.associated_data).map_err(|error| {
        AppError::Credential(format!("vault associated data base64 invalid: {error}"))
    })
}

fn backup_file_if_present(path: &Path) -> AppResult<Option<PathBuf>> {
    if !path.is_file() {
        return Ok(None);
    }
    let backup_path = backup_path(path);
    fs::copy(path, &backup_path)?;
    Ok(Some(backup_path))
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("vault")
        .to_owned();
    name.push_str(".bak.");
    name.push_str(&current_unix_timestamp_string());
    path.with_file_name(name)
}

fn replace_file(temp_path: &Path, path: &Path) -> AppResult<()> {
    match fs::rename(temp_path, path) {
        Ok(()) => Ok(()),
        Err(_) if path.exists() => {
            fs::remove_file(path)?;
            fs::rename(temp_path, path).map_err(Into::into)
        }
        Err(error) => Err(error.into()),
    }
}

fn atomic_temp_path(path: &Path) -> PathBuf {
    let mut temp_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("vault")
        .to_owned();
    temp_name.push_str(".tmp");
    path.with_file_name(temp_name)
}

fn current_unix_timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
