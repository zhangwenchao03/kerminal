//! External SSH launch parser registry and P0 parsers.
//!
//! @author kongweiguang

use base64::{engine::general_purpose, Engine as _};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::error::{AppError, AppResult};

use super::model::{
    ExternalLaunchParseInput, ExternalLaunchRequestDiagnostics, ExternalLaunchSource,
    ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretSlot, ExternalSecretSource,
    ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest, ExternalSshRouteHop,
    ExternalSshTarget,
};

/// Parser for one external terminal persona.
pub trait ExternalLaunchParser: Send + Sync {
    fn tool(&self) -> ExternalLaunchSourceTool;
    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>>;
}

/// Registry that selects a persona parser and returns a normalized request.
pub struct ExternalLaunchParserRegistry {
    parsers: Vec<Box<dyn ExternalLaunchParser>>,
}

impl Default for ExternalLaunchParserRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ExternalLaunchParserRegistry {
    pub fn new() -> Self {
        Self {
            parsers: vec![
                Box::new(PuttyParser),
                Box::new(MobaXtermParser),
                Box::new(XshellParser),
                Box::new(SecureCrtParser),
                Box::new(OpenSshParser),
                Box::new(KerminalNativeParser),
            ],
        }
    }

    pub fn parse(&self, input: &ExternalLaunchParseInput) -> AppResult<ExternalSshLaunchRequest> {
        if input.argv.is_empty() {
            return Err(AppError::InvalidInput(
                "external SSH launch argv must not be empty".to_owned(),
            ));
        }
        let inferred_tool = input
            .source_tool
            .or_else(|| infer_source_tool_from_args(&input.argv));
        for parser in &self.parsers {
            if inferred_tool.is_some_and(|tool| tool != parser.tool()) {
                continue;
            }
            if let Some(request) = parser.parse(input)? {
                return Ok(request);
            }
        }
        Err(AppError::InvalidInput(format!(
            "unsupported external SSH launch arguments from {}",
            input.argv[0]
        )))
    }
}

struct PuttyParser;
struct MobaXtermParser;
struct XshellParser;
struct SecureCrtParser;
struct OpenSshParser;
struct KerminalNativeParser;

impl ExternalLaunchParser for PuttyParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::Putty
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        let argv = &input.argv;
        let mut redacted = argv.clone();
        let mut destination = None;
        let mut username = None;
        let mut port = 22;
        let mut auth = ExternalSshAuth::default();
        let mut options = ExternalSshLaunchOptions::default();
        let mut i = 1;

        while i < argv.len() {
            let token = &argv[i];
            if token.eq_ignore_ascii_case("-ssh") {
                if i + 1 < argv.len() && !is_option(&argv[i + 1]) {
                    destination = Some(argv[i + 1].clone());
                    i += 2;
                } else {
                    i += 1;
                }
                continue;
            }
            if token.eq_ignore_ascii_case("-P") {
                port = parse_port(option_value(argv, i, "-P")?)?;
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("-l") {
                username = Some(option_value(argv, i, "-l")?.to_owned());
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("-pw") {
                let password = option_value(argv, i, "-pw")?;
                auth.password = Some(ExternalSecretSlot::inline(
                    ExternalSecretKind::Password,
                    ExternalSecretSource::CommandLine,
                    password,
                )?);
                redact_value(&mut redacted, i + 1);
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("-i") {
                auth.identity_file = Some(option_value(argv, i, "-i")?.to_owned());
                redact_path(&mut redacted, i + 1);
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("-pwfile") {
                auth.password_file = Some(option_value(argv, i, "-pwfile")?.to_owned());
                redact_path(&mut redacted, i + 1);
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("-m") {
                options.remote_command_file = Some(option_value(argv, i, "-m")?.to_owned());
                redact_path(&mut redacted, i + 1);
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("-load") {
                let session_name = option_value(argv, i, "-load")?.to_owned();
                options.display_name = Some(session_name.clone());
                options.session_name = Some(session_name);
                i += 2;
                continue;
            }
            if !is_option(token) && destination.is_none() {
                destination = Some(token.clone());
            }
            i += 1;
        }

        let target = target_from_destination(destination, username, port)?;
        Ok(Some(build_request(
            input,
            self.tool(),
            "putty",
            target,
            auth,
            options,
            redacted,
        )))
    }
}

impl ExternalLaunchParser for MobaXtermParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::Mobaxterm
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        let Some(command_index) = find_option_index(&input.argv, &["-newtab", "-exec"]) else {
            if let Some(command_tokens) = mobaxterm_direct_command_tokens(&input.argv) {
                let mut parsed =
                    parse_openssh_tokens(input, self.tool(), "mobaxterm-argv", &command_tokens)?;
                parsed.source.tool = self.tool();
                parsed.diagnostics.parser = "mobaxterm-argv".to_owned();
                parsed.diagnostics.raw_hash = raw_hash(&input.argv);
                return Ok(Some(parsed));
            }
            if looks_like_openssh_args(&input.argv) {
                let mut parsed =
                    parse_openssh_tokens(input, self.tool(), "mobaxterm-argv", &input.argv)?;
                parsed.source.tool = self.tool();
                parsed.diagnostics.parser = "mobaxterm-argv".to_owned();
                parsed.diagnostics.raw_hash = raw_hash(&input.argv);
                return Ok(Some(parsed));
            }
            return Ok(None);
        };
        let command_tokens = mobaxterm_command_tokens(&input.argv, command_index)?;
        if command_tokens.is_empty() || !is_ssh_command_token(&command_tokens[0]) {
            return parse_mobaxterm_field_args(input, self.tool());
        }
        let mut parsed =
            parse_openssh_tokens(input, self.tool(), "mobaxterm-openssh", &command_tokens)?;
        let mut redacted = input.argv.clone();
        redact_mobaxterm_command_args(&mut redacted, command_index);
        parsed.source.tool = self.tool();
        parsed.diagnostics.parser = "mobaxterm-openssh".to_owned();
        parsed.diagnostics.argv_redacted = redacted;
        parsed.diagnostics.raw_hash = raw_hash(&input.argv);
        Ok(Some(parsed))
    }
}

impl ExternalLaunchParser for XshellParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::Xshell
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        let Some((url_index, raw_url)) = xshell_url_argument(&input.argv) else {
            return Ok(None);
        };
        let mut redacted = input.argv.clone();
        redacted[url_index] = redact_xshell_url(raw_url);
        if let Some((target, auth)) = parse_xshell_b64_target(raw_url)? {
            return Ok(Some(build_request(
                input,
                self.tool(),
                "xshell-b64",
                target,
                auth,
                ExternalSshLaunchOptions::default(),
                redacted,
            )));
        }
        let url = Url::parse(raw_url)
            .map_err(|error| AppError::InvalidInput(format!("invalid Xshell SSH URL: {error}")))?;
        if url.scheme() != "ssh" {
            return Ok(None);
        }
        let username = empty_to_none(&percent_decode_lossy(url.username()));
        let password = url.password().map(percent_decode_lossy);
        let host = url
            .host_str()
            .ok_or_else(|| AppError::InvalidInput("Xshell SSH URL host is required".to_owned()))?;
        let target = ExternalSshTarget::new(host, url.port().unwrap_or(22), username)?;
        let mut auth = ExternalSshAuth::default();
        if let Some(password) = password {
            auth.password = Some(ExternalSecretSlot::inline(
                ExternalSecretKind::Password,
                ExternalSecretSource::Url,
                password,
            )?);
        }
        Ok(Some(build_request(
            input,
            self.tool(),
            "xshell-url",
            target,
            auth,
            ExternalSshLaunchOptions::default(),
            redacted,
        )))
    }
}

impl ExternalLaunchParser for SecureCrtParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::Securecrt
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        if !input
            .argv
            .iter()
            .any(|token| token.eq_ignore_ascii_case("/SSH2"))
        {
            return Ok(None);
        }
        let mut redacted = input.argv.clone();
        let mut host = None;
        let mut username = None;
        let mut port = 22;
        let mut auth = ExternalSshAuth::default();
        let mut i = 1;

        while i < input.argv.len() {
            let token = &input.argv[i];
            if token.eq_ignore_ascii_case("/SSH2") {
                i += 1;
                continue;
            }
            if token.eq_ignore_ascii_case("/L") {
                username = Some(option_value(&input.argv, i, "/L")?.to_owned());
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("/P") {
                port = parse_port(option_value(&input.argv, i, "/P")?)?;
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("/PASSWORD") {
                let password = option_value(&input.argv, i, "/PASSWORD")?;
                auth.password = Some(ExternalSecretSlot::inline(
                    ExternalSecretKind::Password,
                    ExternalSecretSource::CommandLine,
                    password,
                )?);
                redact_value(&mut redacted, i + 1);
                i += 2;
                continue;
            }
            if token.eq_ignore_ascii_case("/I") {
                auth.identity_file = Some(option_value(&input.argv, i, "/I")?.to_owned());
                redact_path(&mut redacted, i + 1);
                i += 2;
                continue;
            }
            if !token.starts_with('/') {
                host = Some(token.clone());
            }
            i += 1;
        }

        let target = ExternalSshTarget::new(
            host.ok_or_else(|| {
                AppError::InvalidInput("SecureCRT external launch host is required".to_owned())
            })?,
            port,
            username,
        )?;
        Ok(Some(build_request(
            input,
            self.tool(),
            "securecrt",
            target,
            auth,
            ExternalSshLaunchOptions::default(),
            redacted,
        )))
    }
}

impl ExternalLaunchParser for OpenSshParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::Openssh
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        Ok(Some(parse_openssh_tokens(
            input,
            self.tool(),
            "openssh",
            &input.argv,
        )?))
    }
}

impl ExternalLaunchParser for KerminalNativeParser {
    fn tool(&self) -> ExternalLaunchSourceTool {
        ExternalLaunchSourceTool::KerminalNative
    }

    fn parse(
        &self,
        input: &ExternalLaunchParseInput,
    ) -> AppResult<Option<ExternalSshLaunchRequest>> {
        if !should_parse(input, self.tool()) {
            return Ok(None);
        }
        if let Some((url_index, raw_url)) = input
            .argv
            .iter()
            .enumerate()
            .find(|(_, token)| token.starts_with("kerminal://ssh"))
        {
            return Ok(Some(parse_kerminal_protocol_url(
                input, raw_url, url_index,
            )?));
        }
        if let Some(json_index) = find_option_index(&input.argv, &["--external-ssh-json"]) {
            let raw_json = option_value(&input.argv, json_index, "--external-ssh-json")?;
            return Ok(Some(parse_kerminal_json(input, raw_json, json_index)?));
        }
        if !input.argv.iter().any(|token| token == "--external-ssh") {
            return Ok(None);
        }

        let host = required_named_option(&input.argv, "--host")?;
        let port = find_named_option(&input.argv, "--port")
            .map(parse_port)
            .transpose()?
            .unwrap_or(22);
        let username = find_named_option(&input.argv, "--user")
            .or_else(|| find_named_option(&input.argv, "--username"))
            .map(str::to_owned);
        let mut options = ExternalSshLaunchOptions {
            open_sftp: input.argv.iter().any(|token| token == "--open-sftp"),
            ..ExternalSshLaunchOptions::default()
        };
        options.display_name = Some(match username.as_deref() {
            Some(username) => format!("{username}@{host}"),
            None => host.to_owned(),
        });
        let target = ExternalSshTarget::new(host, port, username)?;
        Ok(Some(build_request(
            input,
            self.tool(),
            "kerminal-native-flags",
            target,
            ExternalSshAuth::default(),
            options,
            input.argv.clone(),
        )))
    }
}

fn parse_openssh_tokens(
    input: &ExternalLaunchParseInput,
    tool: ExternalLaunchSourceTool,
    parser_name: &str,
    argv: &[String],
) -> AppResult<ExternalSshLaunchRequest> {
    let mut redacted = argv.to_vec();
    let mut destination = None;
    let mut username = None;
    let mut port = 22;
    let mut auth = ExternalSshAuth::default();
    let mut options = ExternalSshLaunchOptions::default();
    let mut route = Vec::new();
    let mut i = 1;

    while i < argv.len() {
        if destination.is_some() {
            let command = argv[i..].join(" ");
            if !command.trim().is_empty() {
                options.remote_command = Some(command);
            }
            break;
        }
        let token = &argv[i];
        match token.as_str() {
            "-p" => {
                port = parse_port(option_value(argv, i, "-p")?)?;
                i += 2;
            }
            "-l" => {
                username = Some(option_value(argv, i, "-l")?.to_owned());
                i += 2;
            }
            "-i" => {
                auth.identity_file = Some(option_value(argv, i, "-i")?.to_owned());
                redact_path(&mut redacted, i + 1);
                i += 2;
            }
            "-J" => {
                route.push(route_hop_from_destination(option_value(argv, i, "-J")?)?);
                i += 2;
            }
            "-o" | "-F" => {
                i += 2;
            }
            _ if token.starts_with('-') => {
                i += 1;
            }
            _ => {
                destination = Some(token.clone());
                i += 1;
            }
        }
    }

    let mut target = target_from_destination(destination, username, port)?;
    target.route = route;
    Ok(build_request(
        input,
        tool,
        parser_name,
        target,
        auth,
        options,
        redacted,
    ))
}

fn parse_kerminal_json(
    input: &ExternalLaunchParseInput,
    raw_json: &str,
    json_index: usize,
) -> AppResult<ExternalSshLaunchRequest> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope {
        host: String,
        port: Option<u16>,
        #[serde(alias = "user")]
        username: Option<String>,
        password: Option<String>,
        identity_file: Option<String>,
        key_passphrase: Option<String>,
        open_sftp: Option<bool>,
    }

    let envelope: Envelope = serde_json::from_str(raw_json)?;
    let target = ExternalSshTarget::new(
        envelope.host,
        envelope.port.unwrap_or(22),
        envelope.username,
    )?;
    let mut auth = ExternalSshAuth::default();
    if let Some(password) = envelope.password {
        auth.password = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::Password,
            ExternalSecretSource::JsonEnvelope,
            password,
        )?);
    }
    auth.identity_file = envelope.identity_file;
    if let Some(passphrase) = envelope.key_passphrase {
        auth.key_passphrase = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::KeyPassphrase,
            ExternalSecretSource::JsonEnvelope,
            passphrase,
        )?);
    }
    let options = ExternalSshLaunchOptions {
        open_sftp: envelope.open_sftp.unwrap_or(false),
        ..ExternalSshLaunchOptions::default()
    };
    let mut redacted = input.argv.clone();
    redacted[json_index + 1] = redact_kerminal_json_secrets(raw_json);
    Ok(build_request(
        input,
        ExternalLaunchSourceTool::KerminalNative,
        "kerminal-native-json",
        target,
        auth,
        options,
        redacted,
    ))
}

fn parse_kerminal_protocol_url(
    input: &ExternalLaunchParseInput,
    raw_url: &str,
    url_index: usize,
) -> AppResult<ExternalSshLaunchRequest> {
    let url = Url::parse(raw_url)
        .map_err(|error| AppError::InvalidInput(format!("invalid Kerminal SSH URL: {error}")))?;
    if url.scheme() != "kerminal" || url.host_str() != Some("ssh") {
        return Err(AppError::InvalidInput(
            "Kerminal external launch URL must start with kerminal://ssh".to_owned(),
        ));
    }

    let host = required_query_param(&url, "host")?;
    let port = query_param(&url, "port")
        .map(|value| parse_port(&value))
        .transpose()?
        .unwrap_or(22);
    let username = query_param(&url, "user").or_else(|| query_param(&url, "username"));
    let target = ExternalSshTarget::new(host, port, username)?;
    let mut auth = ExternalSshAuth::default();
    if let Some(password) = query_param(&url, "password") {
        auth.password = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::Password,
            ExternalSecretSource::Url,
            password,
        )?);
    }
    auth.identity_file =
        query_param(&url, "identityFile").or_else(|| query_param(&url, "identity_file"));
    if let Some(passphrase) =
        query_param(&url, "keyPassphrase").or_else(|| query_param(&url, "key_passphrase"))
    {
        auth.key_passphrase = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::KeyPassphrase,
            ExternalSecretSource::Url,
            passphrase,
        )?);
    }
    let options = ExternalSshLaunchOptions {
        display_name: Some(target.display_name()),
        open_sftp: query_param(&url, "openSftp")
            .or_else(|| query_param(&url, "open_sftp"))
            .is_some_and(|value| is_truthy_query_value(&value)),
        ..ExternalSshLaunchOptions::default()
    };
    let mut redacted = input.argv.clone();
    redacted[url_index] = redact_kerminal_protocol_url(&url);
    Ok(build_request(
        input,
        ExternalLaunchSourceTool::KerminalNative,
        "kerminal-native-protocol",
        target,
        auth,
        options,
        redacted,
    ))
}

fn query_param(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(query_key, _)| query_key == key)
        .map(|(_, value)| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn required_query_param(url: &Url, key: &str) -> AppResult<String> {
    query_param(url, key).ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Kerminal external launch URL query parameter `{key}` is required"
        ))
    })
}

fn is_truthy_query_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn redact_kerminal_protocol_url(url: &Url) -> String {
    let mut redacted = url.clone();
    redacted.set_query(None);
    {
        let mut pairs = redacted.query_pairs_mut();
        for (key, value) in url.query_pairs() {
            if matches!(
                key.as_ref(),
                "password" | "keyPassphrase" | "key_passphrase"
            ) {
                pairs.append_pair(&key, "<redacted>");
            } else if matches!(key.as_ref(), "identityFile" | "identity_file") {
                pairs.append_pair(&key, "<path:fingerprint>");
            } else {
                pairs.append_pair(&key, &value);
            }
        }
    }
    redacted.to_string()
}

fn build_request(
    input: &ExternalLaunchParseInput,
    tool: ExternalLaunchSourceTool,
    parser: &str,
    target: ExternalSshTarget,
    auth: ExternalSshAuth,
    options: ExternalSshLaunchOptions,
    argv_redacted: Vec<String>,
) -> ExternalSshLaunchRequest {
    let source = ExternalLaunchSource {
        tool,
        entrypoint: input.entrypoint,
        persona: input
            .persona
            .clone()
            .or_else(|| Some(tool.as_str().to_owned())),
        argv0: input.argv.first().cloned(),
    };
    let diagnostics = ExternalLaunchRequestDiagnostics {
        parser: parser.to_owned(),
        argv_redacted,
        raw_hash: raw_hash(&input.argv),
        warnings: Vec::new(),
    };
    ExternalSshLaunchRequest::new(source, target, auth, options, diagnostics)
}

fn should_parse(input: &ExternalLaunchParseInput, parser_tool: ExternalLaunchSourceTool) -> bool {
    if input.source_tool == Some(parser_tool) {
        return true;
    }
    if input.source_tool.is_some() {
        return false;
    }
    infer_source_tool_from_args(&input.argv) == Some(parser_tool)
}

fn infer_source_tool_from_args(argv: &[String]) -> Option<ExternalLaunchSourceTool> {
    if argv.len() <= 1 {
        return None;
    }
    if has_token(argv, "--external-ssh")
        || has_token(argv, "--external-ssh-json")
        || argv.iter().any(|token| token.starts_with("kerminal://ssh"))
    {
        return Some(ExternalLaunchSourceTool::KerminalNative);
    }

    let argv0_tool = argv
        .first()
        .and_then(|argv0| infer_source_tool_from_argv0(argv0));
    if argv0_tool.is_some_and(|tool| tool != ExternalLaunchSourceTool::KerminalNative) {
        return argv0_tool;
    }

    if has_token(argv, "/SSH2") {
        Some(ExternalLaunchSourceTool::Securecrt)
    } else if has_token(argv, "-url") || has_token(argv, "-newwin") {
        Some(ExternalLaunchSourceTool::Xshell)
    } else if has_token(argv, "-newtab") || has_token(argv, "-exec") {
        Some(ExternalLaunchSourceTool::Mobaxterm)
    } else if has_token(argv, "-ssh")
        || has_token(argv, "-pw")
        || has_token(argv, "-pwfile")
        || has_token(argv, "-load")
    {
        Some(ExternalLaunchSourceTool::Putty)
    } else if looks_like_openssh_args(argv) {
        Some(ExternalLaunchSourceTool::Openssh)
    } else {
        None
    }
}

fn infer_source_tool_from_argv0(argv0: &str) -> Option<ExternalLaunchSourceTool> {
    let filename = argv0.rsplit(['\\', '/']).next().unwrap_or(argv0);
    let lower = filename.to_ascii_lowercase();
    if lower.contains("mobaxterm") {
        Some(ExternalLaunchSourceTool::Mobaxterm)
    } else if lower.contains("xshell") {
        Some(ExternalLaunchSourceTool::Xshell)
    } else if lower.contains("securecrt") {
        Some(ExternalLaunchSourceTool::Securecrt)
    } else if lower.contains("putty") || lower.contains("plink") {
        Some(ExternalLaunchSourceTool::Putty)
    } else if lower == "ssh" || lower == "ssh.exe" {
        Some(ExternalLaunchSourceTool::Openssh)
    } else if lower.contains("kerminal") {
        Some(ExternalLaunchSourceTool::KerminalNative)
    } else {
        None
    }
}

fn has_token(argv: &[String], expected: &str) -> bool {
    argv.iter()
        .any(|token| token.eq_ignore_ascii_case(expected))
}

fn looks_like_openssh_args(argv: &[String]) -> bool {
    let mut saw_openssh_option = false;
    let mut i = 1;
    while i < argv.len() {
        let token = &argv[i];
        match token.as_str() {
            "-p" | "-l" | "-i" | "-J" => {
                saw_openssh_option = true;
                i += 2;
            }
            "-o" | "-F" => {
                i += 2;
            }
            _ if token.starts_with('-') => {
                i += 1;
            }
            _ => {
                return saw_openssh_option;
            }
        }
    }
    false
}

fn target_from_destination(
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

fn route_hop_from_destination(value: &str) -> AppResult<ExternalSshRouteHop> {
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

fn split_host_port(value: &str) -> AppResult<(String, Option<u16>)> {
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

fn parse_port(value: &str) -> AppResult<u16> {
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

fn option_value<'a>(argv: &'a [String], index: usize, option: &str) -> AppResult<&'a str> {
    argv.get(index + 1)
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::InvalidInput(format!("external SSH launch option {option} needs a value"))
        })
}

fn find_option_index(argv: &[String], names: &[&str]) -> Option<usize> {
    argv.iter()
        .position(|token| names.iter().any(|name| token.eq_ignore_ascii_case(name)))
}

fn find_named_option<'a>(argv: &'a [String], name: &str) -> Option<&'a str> {
    find_option_index(argv, &[name]).and_then(|index| argv.get(index + 1).map(String::as_str))
}

fn required_named_option<'a>(argv: &'a [String], name: &str) -> AppResult<&'a str> {
    find_named_option(argv, name).ok_or_else(|| {
        AppError::InvalidInput(format!("external SSH launch option {name} is required"))
    })
}

fn is_option(token: &str) -> bool {
    token.starts_with('-') || token.starts_with('/')
}

fn empty_to_none(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn mobaxterm_command_tokens(argv: &[String], command_index: usize) -> AppResult<Vec<String>> {
    let command = option_value(argv, command_index, &argv[command_index])?;
    let mut tokens = split_command_line(command);
    if tokens.len() == 1
        && tokens[0]
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&tokens[0])
            .eq_ignore_ascii_case("ssh")
        && command_index + 2 < argv.len()
    {
        for arg in &argv[command_index + 2..] {
            tokens.extend(split_command_line(arg));
        }
    }
    Ok(tokens)
}

fn mobaxterm_direct_command_tokens(argv: &[String]) -> Option<Vec<String>> {
    let first = argv.get(1)?;
    let mut tokens = split_command_line(first);
    if tokens.is_empty()
        || !tokens[0]
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&tokens[0])
            .eq_ignore_ascii_case("ssh")
    {
        return None;
    }
    for arg in &argv[2..] {
        tokens.extend(split_command_line(arg));
    }
    Some(tokens)
}

fn parse_mobaxterm_field_args(
    input: &ExternalLaunchParseInput,
    tool: ExternalLaunchSourceTool,
) -> AppResult<Option<ExternalSshLaunchRequest>> {
    let mut redacted = input.argv.clone();
    let mut saw_ssh_marker = false;
    let mut destination = None;
    let mut host = None;
    let mut username = None;
    let mut port = 22;
    let mut auth = ExternalSshAuth::default();
    let mut options = ExternalSshLaunchOptions::default();
    let mut i = 1;

    while i < input.argv.len() {
        let token = &input.argv[i];
        if token.eq_ignore_ascii_case("-newtab") || token.eq_ignore_ascii_case("-exec") {
            i += 1;
            continue;
        }
        if token.eq_ignore_ascii_case("ssh") || token.eq_ignore_ascii_case("-ssh") {
            saw_ssh_marker = true;
            if let Some(next) = input.argv.get(i + 1) {
                if !is_option(next) && !looks_like_mobaxterm_session_file(next) {
                    destination = Some(next.clone());
                    i += 2;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        if matches_option(token, &["-remotehost", "-host", "-hostname", "-server"]) {
            host = Some(option_value(&input.argv, i, token)?.to_owned());
            i += 2;
            continue;
        }
        if matches_option(token, &["-username", "-user", "-login", "-l"]) {
            username = Some(option_value(&input.argv, i, token)?.to_owned());
            i += 2;
            continue;
        }
        if matches_option(token, &["-port", "-p"]) {
            port = parse_port(option_value(&input.argv, i, token)?)?;
            i += 2;
            continue;
        }
        if matches_option(token, &["-password", "-pass", "-pwd"]) {
            let password = option_value(&input.argv, i, token)?;
            auth.password = Some(ExternalSecretSlot::inline(
                ExternalSecretKind::Password,
                ExternalSecretSource::CommandLine,
                password,
            )?);
            redact_value(&mut redacted, i + 1);
            i += 2;
            continue;
        }
        if token.eq_ignore_ascii_case("-bookmark") {
            let session_name = option_value(&input.argv, i, "-bookmark")?.to_owned();
            options.display_name = Some(session_name.clone());
            options.session_name = Some(session_name);
            i += 2;
            continue;
        }
        if !is_option(token)
            && destination.is_none()
            && !looks_like_mobaxterm_session_file(token)
            && (token.contains('@') || token.to_ascii_lowercase().starts_with("ssh://"))
        {
            destination = Some(token.clone());
        }
        i += 1;
    }

    let target = if let Some(host) = host {
        Some(ExternalSshTarget::new(host, port, username)?)
    } else if destination.is_some() {
        Some(target_from_destination(destination, username, port)?)
    } else {
        None
    };
    let Some(target) = target else {
        return Ok(None);
    };
    if !saw_ssh_marker && options.session_name.is_some() && input.argv.len() <= 3 {
        return Ok(None);
    }

    Ok(Some(build_request(
        input,
        tool,
        "mobaxterm-fields",
        target,
        auth,
        options,
        redacted,
    )))
}

fn is_ssh_command_token(token: &str) -> bool {
    token
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(token)
        .eq_ignore_ascii_case("ssh")
}

fn matches_option(token: &str, names: &[&str]) -> bool {
    names.iter().any(|name| token.eq_ignore_ascii_case(name))
}

fn looks_like_mobaxterm_session_file(token: &str) -> bool {
    token.to_ascii_lowercase().ends_with(".moba")
}

fn xshell_url_argument(argv: &[String]) -> Option<(usize, &str)> {
    if let Some(option_index) = find_option_index(argv, &["-url", "-newwin"]) {
        return argv
            .get(option_index + 1)
            .map(String::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(|value| (option_index + 1, value));
    }
    argv.iter()
        .enumerate()
        .skip(1)
        .find(|(_, token)| {
            let decoded = percent_decode_lossy(token);
            decoded.to_ascii_lowercase().starts_with("ssh://")
                || strip_b64_prefix(&decoded).is_some()
        })
        .map(|(index, value)| (index, value.as_str()))
}

fn redact_mobaxterm_command_args(argv: &mut [String], command_index: usize) {
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

fn parse_xshell_b64_target(
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

fn strip_b64_prefix(value: &str) -> Option<&str> {
    value
        .get(..5)
        .filter(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
        .and_then(|_| value.get(5..))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn strip_xshell_protocol_suffix(value: &str) -> &str {
    let Some((head, suffix)) = value.rsplit_once(':') else {
        return value;
    };
    if matches!(suffix.to_ascii_uppercase().as_str(), "SSH1" | "SSH2") {
        head
    } else {
        value
    }
}

fn percent_decode_lossy(value: &str) -> String {
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

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn redact_value(argv: &mut [String], index: usize) {
    if let Some(value) = argv.get_mut(index) {
        *value = "<redacted>".to_owned();
    }
}

fn redact_path(argv: &mut [String], index: usize) {
    if let Some(value) = argv.get_mut(index) {
        *value = "<path:fingerprint>".to_owned();
    }
}

fn redact_ssh_url_password(raw_url: &str) -> String {
    let Ok(url) = Url::parse(raw_url) else {
        return "<redacted-url>".to_owned();
    };
    let Some(password) = url.password() else {
        return raw_url.to_owned();
    };
    raw_url.replacen(password, "<redacted>", 1)
}

fn redact_xshell_url(raw_url: &str) -> String {
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
    redact_ssh_url_password(raw_url)
}

fn redact_kerminal_json_secrets(raw_json: &str) -> String {
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

fn redact_openssh_command_string(command: &str) -> String {
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

fn split_command_line(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    for ch in command.chars() {
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        match ch {
            '\'' | '"' => quote = Some(ch),
            ch if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn raw_hash(argv: &[String]) -> String {
    let mut hasher = Sha256::new();
    for arg in argv {
        hasher.update(arg.as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
