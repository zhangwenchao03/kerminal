use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use uuid::Uuid;

use crate::{error::AppResult, paths::KerminalPaths};

use super::{
    SshHopPlan, SshRouteAuthMethod, SshRouteAuthPlan, SshRouteKeyMaterial, SshRoutePlan,
    OPENSSH_HOP_ALIAS_PREFIX, OPENSSH_ROUTE_CONFIG_DIR_NAME, OPENSSH_ROUTE_KEY_DIR_NAME,
    OPENSSH_ROUTE_KEY_PREFIX, OPENSSH_ROUTE_KEY_SUFFIX, OPENSSH_TARGET_ALIAS,
};

pub(super) fn render_openssh_route_config(
    route: &SshRoutePlan,
    paths: &KerminalPaths,
    config_path: &Path,
    known_hosts_path: &Path,
    cleanup_paths: &mut Vec<PathBuf>,
    keepalive_seconds: u64,
) -> AppResult<String> {
    let mut sections = Vec::new();
    let context = OpenSshHostSectionContext {
        paths,
        config_path,
        known_hosts_path,
        keepalive_seconds,
    };
    for (index, hop) in route.jumps.iter().enumerate() {
        let alias = openssh_hop_alias(index);
        let proxy_alias = (index > 0).then(|| openssh_hop_alias(index - 1));
        sections.push(render_openssh_host_section(
            &alias,
            hop,
            proxy_alias.as_deref(),
            cleanup_paths,
            &context,
        )?);
    }

    let target_proxy_alias = route.jumps.len().checked_sub(1).map(openssh_hop_alias);
    sections.push(render_openssh_host_section(
        OPENSSH_TARGET_ALIAS,
        &route.target,
        target_proxy_alias.as_deref(),
        cleanup_paths,
        &context,
    )?);

    Ok(sections.join("\n"))
}

struct OpenSshHostSectionContext<'a> {
    paths: &'a KerminalPaths,
    config_path: &'a Path,
    known_hosts_path: &'a Path,
    keepalive_seconds: u64,
}

fn render_openssh_host_section(
    alias: &str,
    hop: &SshHopPlan,
    proxy_alias: Option<&str>,
    cleanup_paths: &mut Vec<PathBuf>,
    context: &OpenSshHostSectionContext<'_>,
) -> AppResult<String> {
    let mut lines = vec![
        format!("Host {alias}"),
        format!("  HostName {}", quote_ssh_config_value(&hop.host)),
        format!("  Port {}", hop.port),
        format!("  User {}", quote_ssh_config_value(&hop.username)),
        format!(
            "  UserKnownHostsFile {}",
            quote_ssh_config_path(context.known_hosts_path)
        ),
        "  GlobalKnownHostsFile none".to_owned(),
        format!(
            "  PreferredAuthentications {}",
            preferred_authentications(hop.auth.method())
        ),
        format!("  ServerAliveInterval {}", context.keepalive_seconds),
        "  ServerAliveCountMax 3".to_owned(),
    ];

    if let SshRouteAuthPlan::Key { material } = &hop.auth {
        let identity_path = materialize_identity_file(context.paths, material, cleanup_paths)?;
        lines.push(format!(
            "  IdentityFile {}",
            quote_ssh_config_path(&identity_path)
        ));
        lines.push("  IdentitiesOnly yes".to_owned());
    }

    if let Some(proxy_alias) = proxy_alias {
        lines.push(format!(
            "  ProxyCommand ssh -F {} -W %h:%p {}",
            quote_ssh_config_path(context.config_path),
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

pub(super) fn write_restricted_file(path: &Path, content: &str) -> AppResult<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = options.open(path)?;
    file.write_all(content.as_bytes())?;
    file.flush()?;

    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;

    Ok(())
}

pub(super) fn cleanup_registered_paths(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        let _ = fs::remove_file(path);
    }
}

pub(super) fn openssh_route_config_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(OPENSSH_ROUTE_CONFIG_DIR_NAME)
}

fn openssh_route_key_directory(paths: &KerminalPaths) -> PathBuf {
    paths.temp.join(OPENSSH_ROUTE_KEY_DIR_NAME)
}

fn openssh_hop_alias(index: usize) -> String {
    format!("{OPENSSH_HOP_ALIAS_PREFIX}{index}")
}

pub(super) fn display_path_arg(path: &Path) -> String {
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
