//! External SSH launch redaction and diagnostics helpers.
//!
//! @author kongweiguang

use sha2::{Digest, Sha256};
use url::Url;

use super::{
    parsers::{common::split_command_line, mobaxterm::mobaxterm_command_tokens},
    ssh_url::{looks_like_opaque_external_username, percent_decode_lossy, strip_b64_prefix},
};

pub(crate) fn redact_value(argv: &mut [String], index: usize) {
    if let Some(value) = argv.get_mut(index) {
        *value = "<redacted>".to_owned();
    }
}

pub(crate) fn redact_path(argv: &mut [String], index: usize) {
    if let Some(value) = argv.get_mut(index) {
        *value = "<path:fingerprint>".to_owned();
    }
}

pub(crate) fn redact_ssh_url_password(raw_url: &str) -> String {
    let Ok(url) = Url::parse(raw_url) else {
        return "<redacted-url>".to_owned();
    };
    let Some(password) = url.password() else {
        return raw_url.to_owned();
    };
    raw_url.replacen(password, "<redacted>", 1)
}

pub(crate) fn redact_xshell_url(raw_url: &str) -> String {
    if strip_b64_prefix(&percent_decode_lossy(raw_url)).is_some() {
        return "b64>><redacted>".to_owned();
    }
    let Ok(url) = Url::parse(raw_url) else {
        return "<redacted-url>".to_owned();
    };
    if strip_b64_prefix(&percent_decode_lossy(url.username())).is_some() {
        let host = url.host_str().unwrap_or("<host>");
        let port = url
            .port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default();
        return format!("ssh://b64>><redacted>@{host}{port}");
    }
    if url.password().is_some()
        && looks_like_opaque_external_username(&percent_decode_lossy(url.username()))
    {
        let host = url.host_str().unwrap_or("<host>");
        let port = url
            .port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default();
        return format!("ssh://<redacted-external-user>@{host}{port}");
    }
    redact_ssh_url_password(raw_url)
}

pub(crate) fn redact_kerminal_json_secrets(raw_json: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(raw_json) else {
        return "{\"password\":\"<redacted>\"}".to_owned();
    };
    if let Some(object) = value.as_object_mut() {
        if object.contains_key("password") {
            object.insert(
                "password".to_owned(),
                serde_json::Value::String("<redacted>".to_owned()),
            );
        }
        if object.contains_key("keyPassphrase") {
            object.insert(
                "keyPassphrase".to_owned(),
                serde_json::Value::String("<redacted>".to_owned()),
            );
        }
        if object.contains_key("identityFile") {
            object.insert(
                "identityFile".to_owned(),
                serde_json::Value::String("<path:fingerprint>".to_owned()),
            );
        }
    }
    serde_json::to_string(&value).unwrap_or_else(|_| "{\"password\":\"<redacted>\"}".to_owned())
}

pub(crate) fn redact_openssh_command_string(command: &str) -> String {
    let mut tokens = split_command_line(command);
    let mut i = 0;
    while i < tokens.len() {
        if tokens[i] == "-i" && i + 1 < tokens.len() {
            tokens[i + 1] = "<path:fingerprint>".to_owned();
            i += 2;
        } else {
            i += 1;
        }
    }
    tokens.join(" ")
}

pub(crate) fn redact_mobaxterm_command_args(argv: &mut [String], command_index: usize) {
    if command_index + 1 >= argv.len() {
        return;
    }
    if command_index + 2 >= argv.len() {
        argv[command_index + 1] = redact_openssh_command_string(&argv[command_index + 1]);
        return;
    }
    let mut command_tokens = mobaxterm_command_tokens(argv, command_index).unwrap_or_default();
    let mut i = 0;
    while i < command_tokens.len() {
        if command_tokens[i] == "-i" && i + 1 < command_tokens.len() {
            command_tokens[i + 1] = "<path:fingerprint>".to_owned();
            i += 2;
        } else {
            i += 1;
        }
    }
    argv[command_index + 1] = command_tokens.join(" ");
    for arg in &mut argv[command_index + 2..] {
        *arg = "<merged-into-command>".to_owned();
    }
}

pub(crate) fn raw_hash(argv: &[String]) -> String {
    let mut hasher = Sha256::new();
    for arg in argv {
        hasher.update(arg.as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
