//! MobaXterm external SSH launch parser.
//!
//! @author kongweiguang

use std::{
    fs,
    io::Read,
    path::{Component, Path},
};

use crate::error::{AppError, AppResult};

use super::{
    common::{
        build_request, find_option_index, is_option, is_ssh_command_token, matches_option,
        option_value, should_parse, split_command_line,
    },
    openssh::parse_openssh_tokens,
};
use crate::services::external_launch::{
    classifier::looks_like_openssh_args,
    destination::{parse_port, target_from_destination},
    model::{
        ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretSlot,
        ExternalSecretSource, ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest,
        ExternalSshTarget,
    },
    parser::ExternalLaunchParser,
    redaction::{raw_hash, redact_mobaxterm_command_args, redact_value},
    ssh_url::clean_external_token,
};

pub(crate) struct MobaXtermParser;

const MAX_MOBAXTERM_SESSION_FILE_BYTES: u64 = 64 * 1024;

struct BhostParentTarget {
    target: ExternalSshTarget,
    auth: ExternalSshAuth,
    display_name: Option<String>,
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
            if let Some((session_index, session_file)) =
                mobaxterm_session_file_argument(&input.argv)
            {
                return parse_mobaxterm_session_file(
                    input,
                    self.tool(),
                    session_index,
                    session_file,
                );
            }
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
        if looks_like_mobaxterm_session_file(token) {
            if let Some(parent) =
                parse_bhost_parent_command_line(input.parent_command_line.as_deref(), Some(token))?
            {
                redacted[i] = "<moba-session-file>".to_owned();
                return Ok(Some(build_request(
                    input,
                    tool,
                    "mobaxterm-bhost-parent",
                    parent.target,
                    parent.auth,
                    options_with_display_name(parent.display_name),
                    redacted,
                )));
            }
            let session = read_mobaxterm_session_file(token)?;
            redacted[i] = "<moba-session-file>".to_owned();
            host = Some(session.host);
            port = session.port;
            username = session.username;
            if auth.identity_file.is_none() {
                auth.identity_file = session.identity_file;
            }
            options.display_name = Some(session.display_name.clone());
            options.session_name = Some(session.display_name);
            i += 1;
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

struct MobaSessionTarget {
    host: String,
    port: u16,
    username: Option<String>,
    identity_file: Option<String>,
    display_name: String,
}

fn parse_mobaxterm_session_file(
    input: &ExternalLaunchParseInput,
    tool: ExternalLaunchSourceTool,
    session_index: usize,
    session_file: &str,
) -> AppResult<Option<ExternalSshLaunchRequest>> {
    let mut redacted = input.argv.clone();
    redacted[session_index] = "<moba-session-file>".to_owned();
    if let Some(parent) =
        parse_bhost_parent_command_line(input.parent_command_line.as_deref(), Some(session_file))?
    {
        return Ok(Some(build_request(
            input,
            tool,
            "mobaxterm-bhost-parent",
            parent.target,
            parent.auth,
            options_with_display_name(parent.display_name),
            redacted,
        )));
    }
    let session = read_mobaxterm_session_file(session_file)?;
    let auth = ExternalSshAuth {
        identity_file: session.identity_file,
        ..ExternalSshAuth::default()
    };
    let options = ExternalSshLaunchOptions {
        display_name: Some(session.display_name.clone()),
        session_name: Some(session.display_name),
        ..ExternalSshLaunchOptions::default()
    };
    let target = ExternalSshTarget::new(session.host, session.port, session.username)?;
    Ok(Some(build_request(
        input,
        tool,
        "mobaxterm-moba-file",
        target,
        auth,
        options,
        redacted,
    )))
}

fn read_mobaxterm_session_file(path: &str) -> AppResult<MobaSessionTarget> {
    let path = Path::new(path);
    reject_unsafe_session_file_path(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        AppError::InvalidInput("failed to inspect MobaXterm session file".to_owned())
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::InvalidInput(
            "MobaXterm session path must be a regular non-symlink file".to_owned(),
        ));
    }
    if metadata.len() > MAX_MOBAXTERM_SESSION_FILE_BYTES {
        return Err(AppError::InvalidInput(
            "MobaXterm session file exceeds 64 KiB".to_owned(),
        ));
    }
    let mut file = fs::File::open(path)
        .map_err(|_| AppError::InvalidInput("failed to open MobaXterm session file".to_owned()))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(MAX_MOBAXTERM_SESSION_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::InvalidInput("failed to read MobaXterm session file".to_owned()))?;
    if bytes.len() as u64 > MAX_MOBAXTERM_SESSION_FILE_BYTES {
        return Err(AppError::InvalidInput(
            "MobaXterm session file exceeds 64 KiB".to_owned(),
        ));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| AppError::InvalidInput("MobaXterm session file must be UTF-8".to_owned()))?;
    parse_mobaxterm_session_text(&text)
}

fn reject_unsafe_session_file_path(path: &Path) -> AppResult<()> {
    let normalized = path.to_string_lossy().replace('/', "\\");
    if normalized.starts_with("\\\\")
        || normalized.starts_with("\\?\\")
        || normalized.starts_with("\\.\\")
    {
        return Err(AppError::InvalidInput(
            "MobaXterm session file cannot use UNC or device paths".to_owned(),
        ));
    }
    if path.components().any(|component| {
        let Component::Normal(value) = component else {
            return false;
        };
        let name = value.to_string_lossy();
        matches!(
            name.split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    }) {
        return Err(AppError::InvalidInput(
            "MobaXterm session file cannot use a reserved device name".to_owned(),
        ));
    }
    Ok(())
}

fn parse_mobaxterm_session_text(text: &str) -> AppResult<MobaSessionTarget> {
    for line in text.lines() {
        let Some((session_name, definition)) = line.split_once('=') else {
            continue;
        };
        let Some((_, after_marker)) = definition.split_once("#109#") else {
            continue;
        };
        let fields_text = after_marker.split('#').next().unwrap_or_default();
        let fields = fields_text.split('%').collect::<Vec<_>>();
        let Some(host) = fields
            .get(1)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let port = fields
            .get(2)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(parse_port)
            .transpose()?
            .unwrap_or(22);
        let username = fields
            .get(3)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty() && *value != "<none>")
            .map(str::to_owned)
            .or_else(|| derive_mobaxterm_session_username(session_name));
        let identity_file = fields
            .get(15)
            .map(|value| value.trim())
            .filter(|value| looks_like_identity_file(value))
            .map(str::to_owned);
        let display_name = session_name.trim().to_owned();
        return Ok(MobaSessionTarget {
            host: host.to_owned(),
            port,
            username,
            identity_file,
            display_name,
        });
    }
    Err(AppError::InvalidInput(
        "MobaXterm session file does not contain an SSH session".to_owned(),
    ))
}

fn looks_like_identity_file(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value == "<none>" {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    value.contains('/')
        || value.contains('\\')
        || [".pem", ".ppk", ".key", "id_rsa", "id_ed25519"]
            .iter()
            .any(|suffix| lower.ends_with(suffix))
}

fn derive_mobaxterm_session_username(session_name: &str) -> Option<String> {
    let candidate = session_name
        .trim()
        .split_once('@')
        .map(|(left, _)| left)
        .or_else(|| session_name.trim().split_once('_').map(|(left, _)| left))
        .unwrap_or_else(|| session_name.trim())
        .trim();
    (!candidate.is_empty()).then(|| candidate.to_owned())
}

fn parse_bhost_parent_command_line(
    parent_command_line: Option<&str>,
    session_file: Option<&str>,
) -> AppResult<Option<BhostParentTarget>> {
    let Some(parent_command_line) = parent_command_line else {
        return Ok(None);
    };
    let tokens = split_command_line(parent_command_line);
    let Some(program) = tokens.first() else {
        return Ok(None);
    };
    if !program
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(program)
        .eq_ignore_ascii_case("bhmultauth.exe")
    {
        return Ok(None);
    }
    let Some(kerminal_index) = tokens
        .iter()
        .position(|token| is_kerminal_program_token(token))
    else {
        return Ok(None);
    };
    if tokens.len() <= kerminal_index + 4 {
        return Ok(None);
    }
    let host = tokens[kerminal_index + 1].trim().to_owned();
    let port = parse_port(tokens[kerminal_index + 2].trim())?;
    let username = clean_external_token(&tokens[kerminal_index + 3]);
    let password = clean_external_token(&tokens[kerminal_index + 4]);
    let target = ExternalSshTarget::new(host, port, Some(username))?;
    let mut auth = ExternalSshAuth::default();
    if !password.trim().is_empty() {
        auth.password = Some(ExternalSecretSlot::inline(
            ExternalSecretKind::Password,
            ExternalSecretSource::CommandLine,
            password,
        )?);
    }
    Ok(Some(BhostParentTarget {
        target,
        auth,
        display_name: tokens
            .get(kerminal_index + 5)
            .map(|value| clean_external_token(value))
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                session_file
                    .and_then(|path| {
                        path.rsplit(['\\', '/'])
                            .next()
                            .and_then(|name| name.strip_suffix(".moba"))
                    })
                    .map(str::to_owned)
            }),
    }))
}

fn is_kerminal_program_token(value: &str) -> bool {
    let program = value
        .trim_matches('"')
        .trim_matches('\'')
        .replace('/', "\\")
        .rsplit('\\')
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase();
    program == "kerminal.exe"
        || program == "kerminal-launch-shim.exe"
        || program.starts_with("kerminal-launch-shim")
}

fn options_with_display_name(display_name: Option<String>) -> ExternalSshLaunchOptions {
    ExternalSshLaunchOptions {
        display_name,
        ..ExternalSshLaunchOptions::default()
    }
}

fn looks_like_mobaxterm_session_file(token: &str) -> bool {
    token.to_ascii_lowercase().ends_with(".moba")
}

fn mobaxterm_session_file_argument(argv: &[String]) -> Option<(usize, &str)> {
    argv.iter()
        .enumerate()
        .skip(1)
        .find(|(_, token)| looks_like_mobaxterm_session_file(token))
        .map(|(index, value)| (index, value.as_str()))
}

pub(crate) fn mobaxterm_command_tokens(
    argv: &[String],
    command_index: usize,
) -> AppResult<Vec<String>> {
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
