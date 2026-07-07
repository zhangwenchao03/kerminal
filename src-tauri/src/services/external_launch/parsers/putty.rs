//! PuTTY external SSH launch parser.
//!
//! @author kongweiguang

use crate::error::AppResult;

use super::common::{build_request, is_option, option_value, should_parse};
use crate::services::external_launch::{
    destination::{parse_port, target_from_destination},
    model::{
        ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretSlot,
        ExternalSecretSource, ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest,
    },
    parser::ExternalLaunchParser,
    redaction::{redact_path, redact_value},
};

pub(crate) struct PuttyParser;

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
