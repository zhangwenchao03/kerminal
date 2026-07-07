//! External SSH launch destination parsing.
//!
//! @author kongweiguang

use url::Url;

use crate::error::{AppError, AppResult};

use super::{
    model::{ExternalSshRouteHop, ExternalSshTarget},
    parsers::common::empty_to_none,
    ssh_url::percent_decode_lossy,
};

pub(crate) fn target_from_destination(
    destination: Option<String>,
    username_override: Option<String>,
    port_override: u16,
) -> AppResult<ExternalSshTarget> {
    let destination = destination.ok_or_else(|| {
        AppError::InvalidInput("external SSH launch destination is required".to_owned())
    })?;
    let ParsedDestination {
        username,
        host,
        port,
    } = parse_destination(&destination)?;
    ExternalSshTarget::new(
        host,
        port.unwrap_or(port_override),
        username_override.or(username),
    )
}

pub(crate) fn route_hop_from_destination(value: &str) -> AppResult<ExternalSshRouteHop> {
    let ParsedDestination {
        username,
        host,
        port,
    } = parse_destination(value)?;
    Ok(ExternalSshRouteHop {
        host,
        port: port.unwrap_or(22),
        username,
    })
}

struct ParsedDestination {
    username: Option<String>,
    host: String,
    port: Option<u16>,
}

fn parse_destination(value: &str) -> AppResult<ParsedDestination> {
    if value.to_ascii_lowercase().starts_with("ssh://") {
        return parse_ssh_url_destination(value);
    }
    let (username, host_port) = match value.rsplit_once('@') {
        Some((username, host_port)) if !username.is_empty() => {
            (Some(username.to_owned()), host_port)
        }
        _ => (None, value),
    };
    let (host, port) = split_host_port(host_port)?;
    Ok(ParsedDestination {
        username,
        host,
        port,
    })
}

fn parse_ssh_url_destination(value: &str) -> AppResult<ParsedDestination> {
    let url = Url::parse(value)
        .map_err(|error| AppError::InvalidInput(format!("invalid SSH URL destination: {error}")))?;
    if url.scheme() != "ssh" {
        return Err(AppError::InvalidInput(
            "external SSH launch URL destination must use ssh://".to_owned(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("external SSH URL host is required".to_owned()))?
        .to_owned();
    Ok(ParsedDestination {
        username: empty_to_none(&percent_decode_lossy(url.username())),
        host,
        port: url.port(),
    })
}

pub(crate) fn split_host_port(value: &str) -> AppResult<(String, Option<u16>)> {
    if let Some(rest) = value.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            let port = tail.strip_prefix(':').map(parse_port).transpose()?;
            return Ok((host.to_owned(), port));
        }
    }
    if let Some((host, port)) = value.rsplit_once(':') {
        if !host.contains(':') && port.chars().all(|ch| ch.is_ascii_digit()) {
            return Ok((host.to_owned(), Some(parse_port(port)?)));
        }
    }
    Ok((value.to_owned(), None))
}

pub(crate) fn parse_port(value: &str) -> AppResult<u16> {
    let port = value.parse::<u16>().map_err(|_| {
        AppError::InvalidInput(format!("external SSH launch port is invalid: {value}"))
    })?;
    if port == 0 {
        Err(AppError::InvalidInput(
            "external SSH launch port must be within 1..=65535".to_owned(),
        ))
    } else {
        Ok(port)
    }
}
