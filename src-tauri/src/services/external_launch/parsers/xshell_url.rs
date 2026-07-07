//! Xshell URL and bridge payload parsing.
//!
//! @author kongweiguang

use base64::{engine::general_purpose, Engine as _};
use url::Url;

use crate::error::{AppError, AppResult};

use crate::services::external_launch::{
    destination::split_host_port,
    model::{
        ExternalSecretKind, ExternalSecretSlot, ExternalSecretSource, ExternalSshAuth,
        ExternalSshLaunchOptions, ExternalSshTarget,
    },
    ssh_url::{
        looks_like_external_target_hint, looks_like_opaque_external_username, percent_decode_lossy,
        strip_b64_prefix, strip_xshell_protocol_suffix,
    },
};

pub(super) fn parse_xshell_b64_target(
    raw_value: &str,
) -> AppResult<Option<(ExternalSshTarget, ExternalSshAuth)>> {
    let candidate = if raw_value.to_ascii_lowercase().starts_with("ssh://") {
        let url = Url::parse(raw_value)
            .map_err(|error| AppError::InvalidInput(format!("invalid Xshell SSH URL: {error}")))?;
        percent_decode_lossy(url.username())
    } else {
        percent_decode_lossy(raw_value)
    };
    let Some(payload) = parse_xshell_b64_payload(&candidate)? else {
        return Ok(None);
    };
    let target = ExternalSshTarget::new(payload.host, payload.port, Some(payload.username))?;
    let mut auth = ExternalSshAuth::default();
    if let Some(password) = payload.password {
        auth.password = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::Password,
            ExternalSecretSource::Url,
            password,
        )?);
    }
    Ok(Some((target, auth)))
}

pub(super) fn parse_xshell_bridge_url(
    raw_value: &str,
    display_name: Option<String>,
) -> AppResult<Option<(ExternalSshTarget, ExternalSshAuth, ExternalSshLaunchOptions)>> {
    if !raw_value.to_ascii_lowercase().starts_with("ssh://") {
        return Ok(None);
    }
    let url = Url::parse(raw_value)
        .map_err(|error| AppError::InvalidInput(format!("invalid Xshell SSH URL: {error}")))?;
    if url.scheme() != "ssh" {
        return Ok(None);
    }
    let username = percent_decode_lossy(url.username());
    let b64_username = strip_b64_prefix(&username).is_some();
    let bridge_display_name = display_name
        .as_deref()
        .is_some_and(looks_like_external_target_hint);
    if !b64_username && !bridge_display_name && !looks_like_opaque_external_username(&username) {
        return Ok(None);
    }
    let Some(password) = url.password().map(percent_decode_lossy) else {
        return Ok(None);
    };
    if password.trim().is_empty() {
        return Ok(None);
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("Xshell SSH URL host is required".to_owned()))?;
    let target = ExternalSshTarget::new(host, url.port().unwrap_or(22), Some(username))?;
    let auth = ExternalSshAuth {
        password: Some(ExternalSecretSlot::inline(
            ExternalSecretKind::Password,
            ExternalSecretSource::Url,
            password,
        )?),
        ..ExternalSshAuth::default()
    };
    Ok(Some((
        target,
        auth,
        ExternalSshLaunchOptions {
            display_name,
            ..ExternalSshLaunchOptions::default()
        },
    )))
}

struct XshellB64Payload {
    username: String,
    password: Option<String>,
    host: String,
    port: u16,
}

fn parse_xshell_b64_payload(value: &str) -> AppResult<Option<XshellB64Payload>> {
    let Some(encoded) = strip_b64_prefix(value) else {
        return Ok(None);
    };
    let decoded = general_purpose::STANDARD
        .decode(encoded)
        .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(encoded))
        .map_err(|_| AppError::InvalidInput("invalid Xshell b64 payload".to_owned()))?;
    let decoded = String::from_utf8(decoded)
        .map_err(|_| AppError::InvalidInput("invalid Xshell b64 payload text".to_owned()))?;
    let (credential, target_part) = decoded.split_once('@').ok_or_else(|| {
        AppError::InvalidInput("Xshell b64 payload target is required".to_owned())
    })?;
    let (login_username, password) = match credential.split_once(':') {
        Some((username, password)) => (username.trim(), Some(password.trim().to_owned())),
        None => (credential.trim(), None),
    };
    let (target_username, host_part) = match target_part.split_once('@') {
        Some((username, host_part)) => (Some(username.trim()), host_part),
        None => (None, target_part),
    };
    let host_part = strip_xshell_protocol_suffix(host_part);
    let (host, port) = split_host_port(host_part)?;
    let username = target_username
        .filter(|value| !value.is_empty())
        .unwrap_or(login_username);
    if username.is_empty() {
        return Err(AppError::InvalidInput(
            "Xshell b64 payload username is required".to_owned(),
        ));
    }
    Ok(Some(XshellB64Payload {
        username: username.to_owned(),
        password: password.filter(|value| !value.is_empty()),
        host,
        port: port.unwrap_or(22),
    }))
}
