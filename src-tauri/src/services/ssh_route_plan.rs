//! SSH 跳板链纯路由规划模型。
//!
//! @author kongweiguang

use std::{
    fmt,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType, SshJumpHostOptions},
        terminal::{TerminalSecretInputEntry, TerminalSecretInputPlan},
    },
    paths::KerminalPaths,
    services::{
        ssh_credential_resolver::{
            ResolvedSshAuthMaterial, ResolvedSshHopAuth, ResolvedSshRouteAuth,
        },
        ssh_identity_file::resolve_identity_file_path,
    },
};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use uuid::Uuid;

const OPENSSH_ROUTE_CONFIG_DIR_NAME: &str = "ssh-route-configs";
const OPENSSH_ROUTE_KEY_DIR_NAME: &str = "ssh-route-keys";
const OPENSSH_ROUTE_CONFIG_PREFIX: &str = "config-";
const OPENSSH_ROUTE_CONFIG_SUFFIX: &str = ".conf";
const OPENSSH_ROUTE_KEY_PREFIX: &str = "identity-";
const OPENSSH_ROUTE_KEY_SUFFIX: &str = ".key";
const OPENSSH_TARGET_ALIAS: &str = "kerminal-target";
const OPENSSH_HOP_ALIAS_PREFIX: &str = "kerminal-hop-";

/// 从远程主机配置构建 SSH 跳板链纯规划。
///
/// 该函数只做数据归一化、认证材料分类和脱敏摘要生成，不创建临时文件、不启动
/// OpenSSH/russh，也不把密码或内联私钥写入命令行形态。
pub fn build_ssh_route_plan(remote_host: &RemoteHost) -> AppResult<SshRoutePlan> {
    let jumps = remote_host
        .ssh_options
        .jump_hosts
        .iter()
        .enumerate()
        .map(|(index, jump)| build_jump_hop(index, jump))
        .collect::<AppResult<Vec<_>>>()?;
    let target = build_target_hop(remote_host)?;
    let known_hosts = build_known_hosts(&jumps, &target);
    let secret_plan = build_secret_plan(&jumps, &target);

    Ok(SshRoutePlan {
        target,
        jumps,
        known_hosts,
        secret_plan,
        cleanup_paths: Vec::new(),
    })
}

/// Builds a route plan from already-resolved SSH auth material.
///
/// This is the preferred runtime path for terminal launches that have already
/// passed through `SshCredentialResolver`: vault errors and prompt-only states
/// are resolved before OpenSSH args or PTY secret input plans are created.
pub fn build_ssh_route_plan_from_resolved(
    resolved_auth: &ResolvedSshRouteAuth,
) -> AppResult<SshRoutePlan> {
    let jumps = resolved_auth
        .jumps
        .iter()
        .enumerate()
        .map(|(index, jump)| build_resolved_hop(format!("jump-{index}"), jump))
        .collect::<AppResult<Vec<_>>>()?;
    let target = build_resolved_hop("target".to_owned(), &resolved_auth.target)?;
    let known_hosts = build_known_hosts(&jumps, &target);
    let secret_plan = build_secret_plan(&jumps, &target);

    Ok(SshRoutePlan {
        target,
        jumps,
        known_hosts,
        secret_plan,
        cleanup_paths: Vec::new(),
    })
}

/// 物化 OpenSSH 可消费的临时 ssh config、host alias 和清理路径。
///
/// 该函数只把内联私钥写入临时权限文件，并把路径写入 config；密码和私钥内容不会
/// 进入 config、命令参数或 `Debug` 摘要。调用方必须把 `cleanup_paths` 交给终端会话
/// 生命周期清理。
pub fn materialize_openssh_route_plan(
    route: &SshRoutePlan,
    paths: &KerminalPaths,
    known_hosts_path: impl AsRef<Path>,
) -> AppResult<OpenSshRoutePlan> {
    if route.jumps.is_empty() {
        return Err(AppError::InvalidInput(
            "OpenSSH 跳板路由必须至少包含一个 jump host".to_owned(),
        ));
    }

    fs::create_dir_all(openssh_route_config_directory(paths))?;
    let config_path = openssh_route_config_directory(paths).join(format!(
        "{OPENSSH_ROUTE_CONFIG_PREFIX}{}{OPENSSH_ROUTE_CONFIG_SUFFIX}",
        Uuid::new_v4()
    ));
    let mut cleanup_paths = vec![config_path.clone()];

    let result = (|| {
        let config = render_openssh_route_config(
            route,
            paths,
            &config_path,
            known_hosts_path.as_ref(),
            &mut cleanup_paths,
        )?;
        write_restricted_file(&config_path, &config)?;

        Ok(OpenSshRoutePlan {
            target_alias: OPENSSH_TARGET_ALIAS.to_owned(),
            config_path,
            args: vec![
                "-F".to_owned(),
                display_path_arg(cleanup_paths[0].as_path()),
                OPENSSH_TARGET_ALIAS.to_owned(),
            ],
            cleanup_paths: cleanup_paths.clone(),
            secret_input_plan: route.secret_plan.to_terminal_secret_input_plan(),
        })
    })();

    if result.is_err() {
        cleanup_registered_paths(&cleanup_paths);
    }

    result
}

/// SSH 跳板链的完整纯规划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRoutePlan {
    /// 最终目标主机。
    pub target: SshHopPlan,
    /// 从本机到目标主机之间的跳板链，顺序即连接顺序。
    pub jumps: Vec<SshHopPlan>,
    /// 每一跳和目标主机都需要校验的 known_hosts 入口。
    pub known_hosts: Vec<SshKnownHostPlan>,
    /// password / keyboard-interactive 认证的安全应答规划。
    pub secret_plan: SshRouteSecretInputPlan,
    /// 后续执行适配器物化临时私钥或配置后登记的清理路径。
    pub cleanup_paths: Vec<PathBuf>,
}

/// OpenSSH 临时 config/alias 路由规划。
#[derive(Clone, PartialEq, Eq)]
pub struct OpenSshRoutePlan {
    /// 最终目标别名。
    pub target_alias: String,
    /// 临时 ssh config 路径。
    pub config_path: PathBuf,
    /// 传给 OpenSSH 的参数，形如 `-F <temp-config> kerminal-target`。
    pub args: Vec<String>,
    /// 会话结束或启动失败时必须清理的临时 config 和内联私钥文件。
    pub cleanup_paths: Vec<PathBuf>,
    /// 多 password hop 的终端敏感输入计划。
    pub secret_input_plan: TerminalSecretInputPlan,
}

impl fmt::Debug for OpenSshRoutePlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OpenSshRoutePlan")
            .field("target_alias", &self.target_alias)
            .field("config_path", &self.config_path)
            .field("args", &self.args)
            .field("cleanup_paths", &self.cleanup_paths)
            .field("secret_entry_count", &self.secret_input_plan.entries.len())
            .finish()
    }
}

impl SshRoutePlan {
    /// 生成不含密码和私钥内容的日志/审计摘要。
    pub fn summary(&self) -> SshRoutePlanSummary {
        SshRoutePlanSummary {
            target: self.target.summary(),
            jumps: self.jumps.iter().map(SshHopPlan::summary).collect(),
            known_hosts: self.known_hosts.clone(),
            secret_entry_count: self.secret_plan.entries.len(),
            cleanup_path_count: self.cleanup_paths.len(),
        }
    }

    /// 返回需要加入日志脱敏集合的所有敏感值。
    pub fn redact_values(&self) -> Vec<&str> {
        self.jumps
            .iter()
            .chain(std::iter::once(&self.target))
            .flat_map(SshHopPlan::redact_values)
            .collect()
    }
}

/// 单个 SSH hop 的规划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshHopPlan {
    /// 稳定 hop id，用于日志、prompt responder 和后续执行适配器。
    pub id: String,
    /// 用户可读标签，不含 secret。
    pub label: String,
    /// SSH host。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 该 hop 的认证规划。
    pub auth: SshRouteAuthPlan,
}

impl SshHopPlan {
    /// 生成不含 secret 的 hop 摘要。
    pub fn summary(&self) -> SshHopPlanSummary {
        SshHopPlanSummary {
            id: self.id.clone(),
            label: self.label.clone(),
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            auth: self.auth.summary(),
        }
    }

    fn redact_values(&self) -> Vec<&str> {
        self.auth.redact_values()
    }
}

/// SSH hop 的认证规划。
#[derive(Clone, PartialEq, Eq)]
pub enum SshRouteAuthPlan {
    /// 密码认证；密码只通过 secret responder 使用。
    Password {
        /// 明文 secret，Debug 会自动脱敏。
        secret: SshSecret,
    },
    /// 私钥认证；支持文件路径或内联私钥内容。
    Key {
        /// 私钥材料，内联内容 Debug 会自动脱敏。
        material: SshRouteKeyMaterial,
    },
    /// 使用系统 SSH agent。
    Agent,
}

impl fmt::Debug for SshRouteAuthPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Password { secret } => formatter
                .debug_struct("Password")
                .field("secret", secret)
                .finish(),
            Self::Key { material } => formatter
                .debug_struct("Key")
                .field("material", material)
                .finish(),
            Self::Agent => formatter.write_str("Agent"),
        }
    }
}

impl SshRouteAuthPlan {
    /// 返回认证方式摘要。
    pub fn method(&self) -> SshRouteAuthMethod {
        match self {
            Self::Password { .. } => SshRouteAuthMethod::Password,
            Self::Key { .. } => SshRouteAuthMethod::Key,
            Self::Agent => SshRouteAuthMethod::Agent,
        }
    }

    /// 返回不含 secret 的认证摘要。
    pub fn summary(&self) -> SshRouteAuthSummary {
        match self {
            Self::Password { .. } => SshRouteAuthSummary {
                method: SshRouteAuthMethod::Password,
                key_material: None,
            },
            Self::Key { material } => SshRouteAuthSummary {
                method: SshRouteAuthMethod::Key,
                key_material: Some(material.summary()),
            },
            Self::Agent => SshRouteAuthSummary {
                method: SshRouteAuthMethod::Agent,
                key_material: None,
            },
        }
    }

    /// 返回需要加入脱敏集合的敏感值。
    pub fn redact_values(&self) -> Vec<&str> {
        match self {
            Self::Password { secret } => vec![secret.expose_secret()],
            Self::Key {
                material: SshRouteKeyMaterial::InlinePrivateKey { content },
            } => vec![content.expose_secret()],
            Self::Key {
                material: SshRouteKeyMaterial::Path(_),
            }
            | Self::Agent => Vec::new(),
        }
    }
}

/// SSH 认证方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshRouteAuthMethod {
    /// 密码认证。
    Password,
    /// 私钥认证。
    Key,
    /// SSH agent 认证。
    Agent,
}

/// 私钥材料来源。
#[derive(Clone, PartialEq, Eq)]
pub enum SshRouteKeyMaterial {
    /// 已存在的私钥文件路径。
    Path(PathBuf),
    /// 随远程主机记录保存的内联私钥内容。
    InlinePrivateKey {
        /// 明文内联私钥，Debug 会自动脱敏。
        content: SshSecret,
    },
}

impl fmt::Debug for SshRouteKeyMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Path(path) => formatter.debug_tuple("Path").field(path).finish(),
            Self::InlinePrivateKey { content } => formatter
                .debug_struct("InlinePrivateKey")
                .field("content", content)
                .finish(),
        }
    }
}

impl SshRouteKeyMaterial {
    /// 返回不含私钥内容的来源摘要。
    pub fn summary(&self) -> SshRouteKeyMaterialSummary {
        match self {
            Self::Path(_) => SshRouteKeyMaterialSummary::Path,
            Self::InlinePrivateKey { .. } => SshRouteKeyMaterialSummary::InlinePrivateKey,
        }
    }
}

/// 可安全打印的私钥来源摘要。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshRouteKeyMaterialSummary {
    /// 私钥来自文件路径。
    Path,
    /// 私钥来自内联内容，摘要不包含内容本身。
    InlinePrivateKey,
}

/// 明文 SSH secret 的受控容器。
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct SshSecret {
    value: String,
}

impl SshSecret {
    /// 创建明文 secret 容器。
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }

    /// 显式暴露 secret，仅供执行适配器或测试断言使用。
    pub fn expose_secret(&self) -> &str {
        &self.value
    }
}

impl fmt::Debug for SshSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<redacted>")
    }
}

/// known_hosts 校验规划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshKnownHostPlan {
    /// 对应 hop id。
    pub hop_id: String,
    /// 需要校验的 SSH host。
    pub host: String,
    /// 需要校验的 SSH port。
    pub port: u16,
}

/// password / keyboard-interactive 的 secret responder 规划。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SshRouteSecretInputPlan {
    /// 每个需要应答的 password hop。
    pub entries: Vec<SshRouteSecretInputEntry>,
}

impl SshRouteSecretInputPlan {
    /// 转为终端 PTY 自动应答所需的多 secret plan。
    pub fn to_terminal_secret_input_plan(&self) -> TerminalSecretInputPlan {
        TerminalSecretInputPlan {
            entries: self
                .entries
                .iter()
                .map(|entry| TerminalSecretInputEntry {
                    id: entry.id.clone(),
                    label: entry.label.clone(),
                    prompt_markers: entry.prompt_markers.clone(),
                    response: entry.response.expose_secret().to_owned(),
                    redact_values: entry
                        .redact_values
                        .iter()
                        .map(|secret| secret.expose_secret().to_owned())
                        .collect(),
                    max_responses: entry.max_responses,
                })
                .collect(),
        }
    }
}

/// 单个 password hop 的 secret responder 条目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRouteSecretInputEntry {
    /// 条目 id。
    pub id: String,
    /// 对应 hop id。
    pub hop_id: String,
    /// 用户可读标签。
    pub label: String,
    /// 允许匹配的 OpenSSH prompt marker。
    pub prompt_markers: Vec<String>,
    /// 需要写回 PTY 的 secret，Debug 会自动脱敏。
    pub response: SshSecret,
    /// 单个 hop 最多自动应答次数。
    pub max_responses: usize,
    /// 需要加入日志脱敏集合的值。
    pub redact_values: Vec<SshSecret>,
}

/// 不含 secret 的 route plan 摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRoutePlanSummary {
    /// 目标 hop 摘要。
    pub target: SshHopPlanSummary,
    /// 跳板 hop 摘要。
    pub jumps: Vec<SshHopPlanSummary>,
    /// known_hosts 校验摘要。
    pub known_hosts: Vec<SshKnownHostPlan>,
    /// password secret responder 条目数量。
    pub secret_entry_count: usize,
    /// 后续执行适配器登记的清理路径数量。
    pub cleanup_path_count: usize,
}

/// 不含 secret 的 hop 摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshHopPlanSummary {
    /// hop id。
    pub id: String,
    /// hop 标签。
    pub label: String,
    /// SSH host。
    pub host: String,
    /// SSH port。
    pub port: u16,
    /// SSH username。
    pub username: String,
    /// 认证摘要。
    pub auth: SshRouteAuthSummary,
}

/// 不含 secret 的认证摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRouteAuthSummary {
    /// 认证方式。
    pub method: SshRouteAuthMethod,
    /// 私钥来源摘要。
    pub key_material: Option<SshRouteKeyMaterialSummary>,
}

fn build_jump_hop(index: usize, jump: &SshJumpHostOptions) -> AppResult<SshHopPlan> {
    let id = format!("jump-{index}");
    let host = required_text(&jump.host, "跳板主机 host", &id)?;
    let username = required_text(&jump.username, "跳板主机 username", &id)?;
    let port = required_port(jump.port, "跳板主机 port", &id)?;
    let label = optional_text(jump.name.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{username}@{host}:{port}"));
    let auth = build_auth_plan(
        &id,
        &label,
        jump.auth_type,
        jump.credential_ref.as_deref(),
        jump.credential_secret.as_deref(),
    )?;

    Ok(SshHopPlan {
        id,
        label,
        host,
        port,
        username,
        auth,
    })
}

fn build_target_hop(remote_host: &RemoteHost) -> AppResult<SshHopPlan> {
    let id = "target".to_owned();
    let host = required_text(&remote_host.host, "目标主机 host", &id)?;
    let username = required_text(&remote_host.username, "目标主机 username", &id)?;
    let port = required_port(remote_host.port, "目标主机 port", &id)?;
    let label = optional_text(remote_host.name.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{username}@{host}:{port}"));
    let auth = build_auth_plan(
        &id,
        &label,
        remote_host.auth_type,
        remote_host.credential_ref.as_deref(),
        remote_host.credential_secret.as_deref(),
    )?;

    Ok(SshHopPlan {
        id,
        label,
        host,
        port,
        username,
        auth,
    })
}

fn build_resolved_hop(hop_id: String, hop: &ResolvedSshHopAuth) -> AppResult<SshHopPlan> {
    let label = format!("{}@{}:{}", hop.username, hop.host, hop.port);
    let auth = resolved_auth_plan(&hop_id, &label, &hop.material)?;
    Ok(SshHopPlan {
        id: hop_id,
        label,
        host: hop.host.clone(),
        port: hop.port,
        username: hop.username.clone(),
        auth,
    })
}

fn resolved_auth_plan(
    hop_id: &str,
    label: &str,
    material: &ResolvedSshAuthMaterial,
) -> AppResult<SshRouteAuthPlan> {
    match material {
        ResolvedSshAuthMaterial::Agent { .. } => Ok(SshRouteAuthPlan::Agent),
        ResolvedSshAuthMaterial::Password { value, .. } => Ok(SshRouteAuthPlan::Password {
            secret: SshSecret::new(value),
        }),
        ResolvedSshAuthMaterial::PrivateKeyPath { path, .. } => Ok(SshRouteAuthPlan::Key {
            material: SshRouteKeyMaterial::Path(resolve_identity_file_path(
                &path.to_string_lossy(),
            )?),
        }),
        ResolvedSshAuthMaterial::PrivateKeyPem { content, .. } => Ok(SshRouteAuthPlan::Key {
            material: SshRouteKeyMaterial::InlinePrivateKey {
                content: SshSecret::new(normalize_private_key_content(content)?),
            },
        }),
        ResolvedSshAuthMaterial::PromptOnly { reason, .. } => Err(invalid_route_plan(format!(
            "{hop_id} `{label}` requires interactive prompt: {reason}"
        ))),
    }
}

fn build_auth_plan(
    hop_id: &str,
    label: &str,
    auth_type: RemoteHostAuthType,
    credential_ref: Option<&str>,
    credential_secret: Option<&str>,
) -> AppResult<SshRouteAuthPlan> {
    match auth_type {
        RemoteHostAuthType::Password => build_password_auth_plan(hop_id, label, credential_secret),
        RemoteHostAuthType::Key => {
            build_key_auth_plan(hop_id, label, credential_ref, credential_secret)
        }
        RemoteHostAuthType::Agent => Ok(SshRouteAuthPlan::Agent),
    }
}

fn build_password_auth_plan(
    hop_id: &str,
    label: &str,
    credential_secret: Option<&str>,
) -> AppResult<SshRouteAuthPlan> {
    let Some(secret) = non_empty_secret(credential_secret) else {
        return Err(invalid_route_plan(format!(
            "{hop_id} `{label}` 使用密码认证但缺少 credentialSecret"
        )));
    };

    Ok(SshRouteAuthPlan::Password {
        secret: SshSecret::new(secret),
    })
}

fn build_key_auth_plan(
    hop_id: &str,
    label: &str,
    credential_ref: Option<&str>,
    credential_secret: Option<&str>,
) -> AppResult<SshRouteAuthPlan> {
    if let Some(private_key) = non_empty_secret(credential_secret) {
        let normalized = normalize_private_key_content(private_key)?;
        return Ok(SshRouteAuthPlan::Key {
            material: SshRouteKeyMaterial::InlinePrivateKey {
                content: SshSecret::new(normalized),
            },
        });
    }

    let Some(path) = optional_text_opt(credential_ref) else {
        return Err(invalid_route_plan(format!(
            "{hop_id} `{label}` 使用私钥认证但缺少私钥路径或内联私钥内容"
        )));
    };
    if path.starts_with("credential:") {
        return Err(invalid_route_plan(format!(
            "{hop_id} `{label}` 不支持 credential: 私钥引用，请保存私钥路径或内联私钥内容"
        )));
    }

    Ok(SshRouteAuthPlan::Key {
        material: SshRouteKeyMaterial::Path(resolve_identity_file_path(path)?),
    })
}

fn build_known_hosts(jumps: &[SshHopPlan], target: &SshHopPlan) -> Vec<SshKnownHostPlan> {
    jumps
        .iter()
        .chain(std::iter::once(target))
        .map(|hop| SshKnownHostPlan {
            hop_id: hop.id.clone(),
            host: hop.host.clone(),
            port: hop.port,
        })
        .collect()
}

fn build_secret_plan(jumps: &[SshHopPlan], target: &SshHopPlan) -> SshRouteSecretInputPlan {
    let entries = jumps
        .iter()
        .chain(std::iter::once(target))
        .filter_map(password_secret_entry)
        .collect();

    SshRouteSecretInputPlan { entries }
}

fn password_secret_entry(hop: &SshHopPlan) -> Option<SshRouteSecretInputEntry> {
    let SshRouteAuthPlan::Password { secret } = &hop.auth else {
        return None;
    };

    Some(SshRouteSecretInputEntry {
        id: format!("{}:password", hop.id),
        hop_id: hop.id.clone(),
        label: hop.label.clone(),
        prompt_markers: password_prompt_markers(hop),
        response: secret.clone(),
        max_responses: 1,
        redact_values: vec![secret.clone()],
    })
}

fn password_prompt_markers(hop: &SshHopPlan) -> Vec<String> {
    vec![
        format!("{}@{}'s password:", hop.username, hop.host),
        format!("{}'s password:", hop.host),
        "password:".to_owned(),
    ]
}

fn required_text(value: &str, field: &str, hop_id: &str) -> AppResult<String> {
    optional_text(value)
        .map(str::to_owned)
        .ok_or_else(|| invalid_route_plan(format!("{hop_id} 缺少 {field}")))
}

fn required_port(port: u16, field: &str, hop_id: &str) -> AppResult<u16> {
    if port == 0 {
        return Err(invalid_route_plan(format!("{hop_id} {field} 必须大于 0")));
    }
    Ok(port)
}

fn optional_text(value: &str) -> Option<&str> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn optional_text_opt(value: Option<&str>) -> Option<&str> {
    value.and_then(optional_text)
}

fn non_empty_secret(value: Option<&str>) -> Option<&str> {
    value.filter(|secret| !secret.trim().is_empty())
}

fn normalize_private_key_content(private_key: &str) -> AppResult<String> {
    let trimmed = private_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Credential("SSH 私钥凭据内容为空".to_owned()));
    }

    let mut normalized = trimmed.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.ends_with('\n') {
        normalized.push('\n');
    }
    Ok(normalized)
}

fn invalid_route_plan(message: String) -> AppError {
    AppError::InvalidInput(format!("SSH 路由规划失败: {message}"))
}

fn render_openssh_route_config(
    route: &SshRoutePlan,
    paths: &KerminalPaths,
    config_path: &Path,
    known_hosts_path: &Path,
    cleanup_paths: &mut Vec<PathBuf>,
) -> AppResult<String> {
    let mut sections = Vec::new();
    for (index, hop) in route.jumps.iter().enumerate() {
        let alias = openssh_hop_alias(index);
        let proxy_alias = (index > 0).then(|| openssh_hop_alias(index - 1));
        sections.push(render_openssh_host_section(
            &alias,
            hop,
            proxy_alias.as_deref(),
            paths,
            config_path,
            known_hosts_path,
            cleanup_paths,
        )?);
    }

    let target_proxy_alias = route.jumps.len().checked_sub(1).map(openssh_hop_alias);
    sections.push(render_openssh_host_section(
        OPENSSH_TARGET_ALIAS,
        &route.target,
        target_proxy_alias.as_deref(),
        paths,
        config_path,
        known_hosts_path,
        cleanup_paths,
    )?);

    Ok(sections.join("\n"))
}

fn render_openssh_host_section(
    alias: &str,
    hop: &SshHopPlan,
    proxy_alias: Option<&str>,
    paths: &KerminalPaths,
    config_path: &Path,
    known_hosts_path: &Path,
    cleanup_paths: &mut Vec<PathBuf>,
) -> AppResult<String> {
    let mut lines = vec![
        format!("Host {alias}"),
        format!("  HostName {}", quote_ssh_config_value(&hop.host)),
        format!("  Port {}", hop.port),
        format!("  User {}", quote_ssh_config_value(&hop.username)),
        format!(
            "  UserKnownHostsFile {}",
            quote_ssh_config_path(known_hosts_path)
        ),
        "  GlobalKnownHostsFile none".to_owned(),
        format!(
            "  PreferredAuthentications {}",
            preferred_authentications(hop.auth.method())
        ),
        "  ServerAliveInterval 30".to_owned(),
        "  ServerAliveCountMax 3".to_owned(),
    ];

    if let SshRouteAuthPlan::Key { material } = &hop.auth {
        let identity_path = materialize_identity_file(paths, material, cleanup_paths)?;
        lines.push(format!(
            "  IdentityFile {}",
            quote_ssh_config_path(&identity_path)
        ));
        lines.push("  IdentitiesOnly yes".to_owned());
    }

    if let Some(proxy_alias) = proxy_alias {
        lines.push(format!(
            "  ProxyCommand ssh -F {} -W %h:%p {}",
            quote_ssh_config_path(config_path),
            proxy_alias
        ));
    }

    lines.push(String::new());
    Ok(lines.join("\n"))
}

fn materialize_identity_file(
    paths: &KerminalPaths,
    material: &SshRouteKeyMaterial,
    cleanup_paths: &mut Vec<PathBuf>,
) -> AppResult<PathBuf> {
    match material {
        SshRouteKeyMaterial::Path(path) => Ok(path.clone()),
        SshRouteKeyMaterial::InlinePrivateKey { content } => {
            fs::create_dir_all(openssh_route_key_directory(paths))?;
            let path = openssh_route_key_directory(paths).join(format!(
                "{OPENSSH_ROUTE_KEY_PREFIX}{}{OPENSSH_ROUTE_KEY_SUFFIX}",
                Uuid::new_v4()
            ));
            cleanup_paths.push(path.clone());
            write_restricted_file(&path, content.expose_secret())?;
            Ok(path)
        }
    }
}

fn preferred_authentications(method: SshRouteAuthMethod) -> &'static str {
    match method {
        SshRouteAuthMethod::Password => "password,keyboard-interactive",
        SshRouteAuthMethod::Key => "publickey",
        SshRouteAuthMethod::Agent => "publickey,keyboard-interactive,password",
    }
}

fn write_restricted_file(path: &Path, content: &str) -> AppResult<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }

    let mut file = options.open(path)?;
    file.write_all(content.as_bytes())?;
    file.flush()?;

    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

fn cleanup_registered_paths(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        let _ = fs::remove_file(path);
    }
}

fn openssh_route_config_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(OPENSSH_ROUTE_CONFIG_DIR_NAME)
}

fn openssh_route_key_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(OPENSSH_ROUTE_KEY_DIR_NAME)
}

fn openssh_hop_alias(index: usize) -> String {
    format!("{OPENSSH_HOP_ALIAS_PREFIX}{index}")
}

fn display_path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn quote_ssh_config_path(path: &Path) -> String {
    quote_ssh_config_value(&path.to_string_lossy().replace('\\', "/"))
}

fn quote_ssh_config_value(value: &str) -> String {
    if value.is_empty()
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '\'' | '#'))
    {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_owned()
    }
}
