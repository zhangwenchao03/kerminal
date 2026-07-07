//! OpenSSH-compatible external SSH launch parser.
//!
//! @author kongweiguang

use crate::error::AppResult;

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
