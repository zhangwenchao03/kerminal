//! OpenSSH-compatible external SSH launch parser.
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};

const EXTERNAL_SSH_MAX_JUMP_HOSTS: usize = 8;

use super::common::{build_request, option_value, should_parse};
use crate::services::external_launch::{
    destination::{parse_port, route_hop_from_destination, target_from_destination},
    model::{
        ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSshAuth,
        ExternalSshLaunchOptions, ExternalSshLaunchRequest,
    },
    parser::ExternalLaunchParser,
    redaction::redact_path,
};

pub(crate) struct OpenSshParser;

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

pub(super) fn parse_openssh_tokens(
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
                for value in redacted.iter_mut().skip(i) {
                    *value = "<remote-command>".to_owned();
                }
            }
            break;
        }
        let token = &argv[i];
        if token == "--" {
            i += 1;
            if let Some(value) = argv.get(i) {
                destination = Some(value.clone());
                i += 1;
            }
            continue;
        }
        if let Some(value) = attached_option_value(token, "-p") {
            port = parse_port(value)?;
            i += 1;
            continue;
        }
        if let Some(value) = attached_option_value(token, "-l") {
            username = Some(value.to_owned());
            i += 1;
            continue;
        }
        if let Some(value) = attached_option_value(token, "-i") {
            auth.identity_file = Some(value.to_owned());
            redacted[i] = "-i<redacted-path>".to_owned();
            i += 1;
            continue;
        }
        if let Some(value) = attached_option_value(token, "-J") {
            append_proxy_jumps(&mut route, value)?;
            i += 1;
            continue;
        }
        if let Some(value) = attached_option_value(token, "-o") {
            apply_ssh_option(value, &mut port, &mut username, &mut auth, &mut route)?;
            i += 1;
            continue;
        }
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
                append_proxy_jumps(&mut route, option_value(argv, i, "-J")?)?;
                i += 2;
            }
            "-o" => {
                apply_ssh_option(
                    option_value(argv, i, "-o")?,
                    &mut port,
                    &mut username,
                    &mut auth,
                    &mut route,
                )?;
                i += 2;
            }
            "-F" | "-E" => {
                let _ = option_value(argv, i, token)?;
                redact_path(&mut redacted, i + 1);
                i += 2;
            }
            _ if is_known_flag_option(token) => {
                i += 1;
            }
            _ if is_known_value_option(token) => {
                let _ = option_value(argv, i, token)?;
                i += 2;
            }
            _ if token.starts_with('-') => {
                return Err(AppError::InvalidInput(format!(
                    "unsupported OpenSSH option: {token}"
                )));
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

const OPENSSH_VALUE_OPTIONS: &[&str] = &[
    "-B", "-b", "-c", "-D", "-e", "-I", "-L", "-m", "-O", "-P", "-Q", "-R", "-S", "-W", "-w",
];

const OPENSSH_FLAG_OPTIONS: &[char] = &[
    '4', '6', 'A', 'a', 'C', 'f', 'G', 'g', 'K', 'k', 'M', 'N', 'n', 'q', 's', 'T', 't', 'V', 'v',
    'X', 'x', 'Y', 'y',
];

fn attached_option_value<'a>(token: &'a str, option: &str) -> Option<&'a str> {
    token.strip_prefix(option).filter(|value| !value.is_empty())
}

fn is_known_value_option(token: &str) -> bool {
    OPENSSH_VALUE_OPTIONS.contains(&token)
}

fn is_known_flag_option(token: &str) -> bool {
    let Some(flags) = token.strip_prefix('-') else {
        return false;
    };
    !flags.is_empty()
        && flags
            .chars()
            .all(|flag| OPENSSH_FLAG_OPTIONS.contains(&flag))
}

fn append_proxy_jumps(
    route: &mut Vec<crate::services::external_launch::model::ExternalSshRouteHop>,
    value: &str,
) -> AppResult<()> {
    for hop in value
        .split(',')
        .map(str::trim)
        .filter(|hop| !hop.is_empty())
    {
        if route.len() >= EXTERNAL_SSH_MAX_JUMP_HOSTS {
            return Err(AppError::InvalidInput(
                "external SSH jump chain exceeds the supported 8-hop limit".to_owned(),
            ));
        }
        route.push(route_hop_from_destination(hop)?);
    }
    Ok(())
}

fn apply_ssh_option(
    value: &str,
    port: &mut u16,
    username: &mut Option<String>,
    auth: &mut ExternalSshAuth,
    route: &mut Vec<crate::services::external_launch::model::ExternalSshRouteHop>,
) -> AppResult<()> {
    let Some((name, option_value)) = value.split_once('=') else {
        return Ok(());
    };
    match name.trim().to_ascii_lowercase().as_str() {
        "port" => *port = parse_port(option_value.trim())?,
        "user" => *username = Some(option_value.trim().to_owned()),
        "identityfile" => auth.identity_file = Some(option_value.trim().to_owned()),
        "proxyjump" => append_proxy_jumps(route, option_value)?,
        // 外部输入不能通过 OpenSSH option 降低 Kerminal 的 host key 策略。
        "stricthostkeychecking" if option_value.trim().eq_ignore_ascii_case("no") => {
            return Err(AppError::InvalidInput(
                "external launch cannot disable strict host key checking".to_owned(),
            ));
        }
        _ => {}
    }
    Ok(())
}
