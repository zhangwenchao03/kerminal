//! 远程主机业务服务。
//!
//! @author kongweiguang

use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{
        RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest, RemoteHostGroup,
        RemoteHostGroupCreateRequest, RemoteHostGroupUpdateRequest, RemoteHostGroupWithHosts,
        RemoteHostUpdateRequest, SshOptions, SshProxyProtocol, SshTunnelKind,
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};

/// 远程主机业务入口。
#[derive(Debug, Clone)]
pub struct RemoteHostService {
    config: ConfigFileStore,
}

impl RemoteHostService {
    /// 创建远程主机服务。
    pub fn new(config: ConfigFileStore) -> Self {
        Self { config }
    }

    /// 列出远程主机分组。
    pub fn list_groups(&self) -> AppResult<Vec<RemoteHostGroup>> {
        self.config
            .list_remote_host_groups()
            .map_err(config_file_error)
    }

    /// 列出远程主机树。
    pub fn list_tree(&self) -> AppResult<Vec<RemoteHostGroupWithHosts>> {
        self.config
            .list_remote_host_tree()
            .map_err(config_file_error)
    }

    /// 根据 id 读取远程主机。返回的 runtime model 已合并 secrets。
    pub fn host_by_id(&self, host_id: &str) -> AppResult<Option<RemoteHost>> {
        self.config
            .remote_host_by_id(host_id)
            .map_err(config_file_error)
    }

    /// 根据 id 读取远程主机，缺失时报 NotFound。
    pub fn require_host(&self, host_id: &str) -> AppResult<RemoteHost> {
        self.host_by_id(host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
    }

    /// 创建远程主机分组。
    pub fn create_group(
        &self,
        request: RemoteHostGroupCreateRequest,
    ) -> AppResult<RemoteHostGroup> {
        let timestamp = timestamp_now();
        let group = RemoteHostGroup {
            id: Uuid::new_v4().to_string(),
            name: normalize_required_text("分组名称", request.name)?,
            sort_order: self
                .config
                .next_remote_host_group_sort_order()
                .map_err(config_file_error)?,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };

        let mut groups = self.list_groups()?;
        groups.push(group.clone());
        self.config
            .apply_remote_host_change_set(Some(&groups), &[], &[])
            .map_err(config_file_error)?;
        Ok(group)
    }

    /// 更新远程主机分组。
    pub fn update_group(
        &self,
        request: RemoteHostGroupUpdateRequest,
    ) -> AppResult<RemoteHostGroup> {
        let id = normalize_required_text("分组 ID", request.id)?;
        let mut groups = self.list_groups()?;
        let Some(group) = groups.iter_mut().find(|group| group.id == id) else {
            return Err(AppError::NotFound(format!("远程主机分组不存在: {id}")));
        };
        group.name = normalize_required_text("分组名称", request.name)?;
        group.sort_order = request.sort_order;
        group.updated_at = timestamp_now();
        let updated = group.clone();

        self.config
            .apply_remote_host_change_set(Some(&groups), &[], &[])
            .map_err(config_file_error)?;
        Ok(updated)
    }

    /// 删除远程主机分组；分组内主机会移动到未分组。
    pub fn delete_group(&self, group_id: &str) -> AppResult<bool> {
        let group_id = normalize_required_text("分组 ID", group_id.to_owned())?;
        let mut groups = self.list_groups()?;
        let before_len = groups.len();
        groups.retain(|group| group.id != group_id);
        if groups.len() == before_len {
            return Ok(false);
        }

        let timestamp = timestamp_now();
        let mut hosts_to_write = self
            .config
            .list_remote_hosts()
            .map_err(config_file_error)?
            .into_iter()
            .filter(|host| host.group_id.as_deref() == Some(group_id.as_str()))
            .collect::<Vec<_>>();
        for host in &mut hosts_to_write {
            host.group_id = None;
            host.updated_at = timestamp.clone();
        }

        self.config
            .apply_remote_host_change_set(Some(&groups), &hosts_to_write, &[])
            .map_err(config_file_error)?;
        Ok(true)
    }

    /// 创建远程主机配置。
    pub fn create_host(&self, request: RemoteHostCreateRequest) -> AppResult<RemoteHost> {
        let group_id = normalize_optional_text(request.group_id);
        ensure_group_exists(self, group_id.as_deref())?;
        let sort_order = self
            .config
            .next_remote_host_sort_order(group_id.as_deref())
            .map_err(config_file_error)?;
        let id = Uuid::new_v4().to_string();
        let tags = normalize_tags(request.tags);
        let credential = normalize_ssh_credential(
            request.auth_type,
            request.credential_ref,
            request.credential_secret,
        )?;
        let timestamp = timestamp_now();
        let host = RemoteHost {
            id,
            group_id,
            name: normalize_required_text("主机名称", request.name)?,
            host: normalize_host(request.host)?,
            port: normalize_port(request.port)?,
            username: normalize_username(request.username, &tags)?,
            auth_type: request.auth_type,
            credential_ref: credential.credential_ref,
            credential_secret: credential.credential_secret,
            tags,
            production: request.production,
            ssh_options: normalize_ssh_options(request.ssh_options)?,
            sort_order,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };

        self.config
            .apply_remote_host_change_set(None, std::slice::from_ref(&host), &[])
            .map_err(config_file_error)?;
        Ok(host)
    }

    /// 更新远程主机配置。
    pub fn update_host(&self, request: RemoteHostUpdateRequest) -> AppResult<RemoteHost> {
        let group_id = normalize_optional_text(request.group_id);
        ensure_group_exists(self, group_id.as_deref())?;
        let id = normalize_required_text("主机 ID", request.id)?;
        let existing = self
            .host_by_id(&id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {id}")))?;
        let tags = normalize_tags(request.tags);
        let credential = normalize_ssh_credential(
            request.auth_type,
            request.credential_ref,
            request.credential_secret,
        )?;
        let host = RemoteHost {
            id,
            group_id,
            name: normalize_required_text("主机名称", request.name)?,
            host: normalize_host(request.host)?,
            port: normalize_port(request.port)?,
            username: normalize_username(request.username, &tags)?,
            auth_type: request.auth_type,
            credential_ref: credential.credential_ref,
            credential_secret: credential.credential_secret,
            tags,
            production: request.production,
            ssh_options: normalize_ssh_options(request.ssh_options)?,
            sort_order: request.sort_order,
            created_at: existing.created_at,
            updated_at: timestamp_now(),
        };

        self.config
            .apply_remote_host_change_set(None, std::slice::from_ref(&host), &[])
            .map_err(config_file_error)?;
        Ok(host)
    }

    /// 删除远程主机配置。
    pub fn delete_host(&self, host_id: &str) -> AppResult<bool> {
        if self.host_by_id(host_id)?.is_none() {
            return Ok(false);
        }
        self.config
            .apply_remote_host_change_set(None, &[], &[host_id.to_owned()])
            .map_err(config_file_error)?;
        Ok(true)
    }
}

fn ensure_group_exists(service: &RemoteHostService, group_id: Option<&str>) -> AppResult<()> {
    let Some(group_id) = group_id else {
        return Ok(());
    };

    if service
        .config
        .remote_host_group_by_id(group_id)
        .map_err(config_file_error)?
        .is_none()
    {
        return Err(AppError::NotFound(format!(
            "远程主机分组不存在: {group_id}"
        )));
    }
    Ok(())
}

fn normalize_required_text(field: &str, value: String) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    Ok(value)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
}

fn normalize_username(value: String, tags: &[String]) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() && !allows_empty_username(tags) {
        return Err(AppError::InvalidInput("用户名不能为空".to_owned()));
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSshCredential {
    credential_ref: Option<String>,
    credential_secret: Option<String>,
}

fn normalize_ssh_credential(
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> AppResult<NormalizedSshCredential> {
    let credential_ref = normalize_optional_text(credential_ref);
    let credential_secret = credential_secret.filter(|secret| !secret.trim().is_empty());

    match auth_type {
        RemoteHostAuthType::Agent => {
            if credential_ref.is_some() || credential_secret.is_some() {
                return Err(AppError::InvalidInput(
                    "SSH Agent 认证不需要密码、私钥路径或私钥内容".to_owned(),
                ));
            }
            Ok(NormalizedSshCredential {
                credential_ref: None,
                credential_secret: None,
            })
        }
        RemoteHostAuthType::Password => {
            if credential_ref.is_some() {
                return Err(AppError::InvalidInput(
                    "密码认证不再使用凭据引用，请直接填写明文密码".to_owned(),
                ));
            }

            let Some(secret) = credential_secret else {
                return Err(AppError::InvalidInput(
                    "密码认证需要填写明文 SSH 密码".to_owned(),
                ));
            };

            Ok(NormalizedSshCredential {
                credential_ref: None,
                credential_secret: Some(secret),
            })
        }
        RemoteHostAuthType::Key => {
            if credential_ref
                .as_deref()
                .is_some_and(|value| value.starts_with("credential:"))
            {
                return Err(AppError::InvalidInput(
                    "密钥认证不再支持 credential: 凭据引用，请填写私钥路径或直接粘贴私钥内容"
                        .to_owned(),
                ));
            }

            match (credential_ref, credential_secret) {
                (Some(_), Some(_)) => Err(AppError::InvalidInput(
                    "密钥认证的私钥路径和私钥内容只能填写一项".to_owned(),
                )),
                (Some(path), None) => Ok(NormalizedSshCredential {
                    credential_ref: Some(path),
                    credential_secret: None,
                }),
                (None, Some(secret)) => Ok(NormalizedSshCredential {
                    credential_ref: None,
                    credential_secret: Some(secret),
                }),
                (None, None) => Err(AppError::InvalidInput(
                    "密钥认证需要填写私钥路径或直接粘贴私钥内容".to_owned(),
                )),
            }
        }
    }
}

fn normalize_host(value: String) -> AppResult<String> {
    let host = normalize_required_text("主机地址", value)?;
    if host.chars().any(char::is_whitespace) {
        return Err(AppError::InvalidInput(
            "主机地址不能包含空白字符".to_owned(),
        ));
    }
    Ok(host)
}

fn normalize_port(port: u16) -> AppResult<u16> {
    if port == 0 {
        return Err(AppError::InvalidInput("SSH 端口必须大于 0".to_owned()));
    }
    Ok(port)
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for tag in tags {
        let tag = tag.trim().to_owned();
        if tag.is_empty() || !seen.insert(tag.to_lowercase()) {
            continue;
        }
        normalized.push(tag);
    }

    normalized
}

fn allows_empty_username(tags: &[String]) -> bool {
    has_tag(tags, "telnet") || has_tag(tags, "serial")
}

fn has_tag(tags: &[String], expected: &str) -> bool {
    tags.iter()
        .any(|tag| tag.trim().eq_ignore_ascii_case(expected))
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}

fn timestamp_now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn normalize_ssh_options(mut options: SshOptions) -> AppResult<SshOptions> {
    options.proxy.host = normalize_optional_text(options.proxy.host);
    options.proxy.username = normalize_optional_text(options.proxy.username);
    options.proxy.credential_ref = normalize_optional_text(options.proxy.credential_ref);
    if matches!(options.proxy.protocol, SshProxyProtocol::None) {
        options.proxy.host = None;
        options.proxy.port = None;
        options.proxy.username = None;
        options.proxy.credential_ref = None;
    }

    options.tunnels = options
        .tunnels
        .into_iter()
        .map(|mut tunnel| {
            tunnel.name = tunnel.name.trim().to_owned();
            tunnel.bind_host = tunnel.bind_host.trim().to_owned();
            tunnel.target_host = tunnel.target_host.trim().to_owned();
            tunnel
        })
        .filter(|tunnel| {
            tunnel.bind_port.is_some()
                || !tunnel.bind_host.is_empty()
                || !tunnel.target_host.is_empty()
                || tunnel.target_port.is_some()
                || !tunnel.name.is_empty()
        })
        .filter(|tunnel| {
            matches!(tunnel.kind, SshTunnelKind::Dynamic)
                || !tunnel.target_host.is_empty()
                || tunnel.target_port.is_some()
        })
        .collect();

    options.jump_hosts = options
        .jump_hosts
        .into_iter()
        .map(|mut jump_host| {
            jump_host.name = jump_host.name.trim().to_owned();
            jump_host.host = jump_host.host.trim().to_owned();
            jump_host.username = jump_host.username.trim().to_owned();
            jump_host.credential_ref = normalize_optional_text(jump_host.credential_ref);
            jump_host.credential_secret = jump_host
                .credential_secret
                .filter(|secret| !secret.trim().is_empty());
            match jump_host.auth_type {
                RemoteHostAuthType::Agent => {
                    jump_host.credential_ref = None;
                    jump_host.credential_secret = None;
                }
                RemoteHostAuthType::Password => {
                    jump_host.credential_ref = None;
                }
                RemoteHostAuthType::Key => {
                    if jump_host.credential_secret.is_some() {
                        jump_host.credential_ref = None;
                    }
                }
            }
            jump_host
        })
        .map(|jump_host| {
            if jump_host
                .credential_ref
                .as_deref()
                .is_some_and(|value| value.starts_with("credential:"))
            {
                return Err(AppError::InvalidInput(
                    "跳板机密钥认证不再支持 credential: 凭据引用".to_owned(),
                ));
            }
            Ok(jump_host)
        })
        .collect::<AppResult<Vec<_>>>()?
        .into_iter()
        .filter(|jump_host| !jump_host.host.is_empty())
        .collect();

    options.terminal.encoding = options.terminal.encoding.trim().to_owned();
    options.terminal.terminal_type = options.terminal.terminal_type.trim().to_owned();
    options.terminal.keyboard_profile = options.terminal.keyboard_profile.trim().to_owned();
    options.terminal.alt_modifier = options.terminal.alt_modifier.trim().to_owned();
    options.terminal.backspace_key = options.terminal.backspace_key.trim().to_owned();
    options.terminal.delete_key = options.terminal.delete_key.trim().to_owned();
    options.terminal.startup_command = options.terminal.startup_command.trim().to_owned();
    options.terminal.environment = options.terminal.environment.trim().to_owned();
    options.terminal.login_script = options.terminal.login_script.trim().to_owned();

    options.transfer.remote_start_directory =
        options.transfer.remote_start_directory.trim().to_owned();
    options.transfer.local_start_directory =
        options.transfer.local_start_directory.trim().to_owned();
    options.transfer.max_concurrent_transfers =
        options.transfer.max_concurrent_transfers.clamp(1, 16);

    Ok(options)
}
