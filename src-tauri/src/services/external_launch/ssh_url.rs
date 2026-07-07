//! External SSH launch URL and encoded token helpers.
//!
//! @author kongweiguang

use url::Url;

use crate::error::{AppError, AppResult};

pub(crate) fn query_param(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(query_key, _)| query_key == key)
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub(crate) fn required_query_param(url: &Url, key: &str) -> AppResult<String> {
    query_param(url, key).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Kerminal external launch URL query parameter `{key}` is required"
        ))
    })
}

pub(crate) fn is_truthy_query_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub(crate) fn strip_b64_prefix(value: &str) -> Option<&str> {
    value
        .get(..5)
        .filter(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
        .and_then(|_| value.get(5..))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn strip_xshell_protocol_suffix(value: &str) -> &str {
    let Some((head, suffix)) = value.rsplit_once(':') else {
        return value;
    };
    if matches!(suffix.to_ascii_uppercase().as_str(), "SSH1" | "SSH2") {
        head
    } else {
        value
    }
}

pub(crate) fn percent_decode_lossy(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

pub(crate) fn clean_external_token(value: &str) -> String {
    let mut value = percent_decode_lossy(value).trim().to_owned();
    loop {
        let trimmed = value.trim();
        let quoted = (trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\''));
        if quoted && trimmed.len() >= 2 {
            value = trimmed[1..trimmed.len() - 1].trim().to_owned();
        } else {
            return trimmed.to_owned();
        }
    }
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn looks_like_external_target_hint(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.starts_with('/') {
        return false;
    }
    value.to_ascii_lowercase().starts_with("ssh://") || value.contains('@') || value.contains('_')
}

pub(crate) fn looks_like_opaque_external_username(username: &str) -> bool {
    let username = username.trim();
    if username.len() < 32 || username.contains('@') {
        return false;
    }
    let token_chars = username
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '+' | '/' | '='))
        .count();
    token_chars * 100 / username.len() >= 80
}
