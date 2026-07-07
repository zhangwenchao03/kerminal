//! Xshell external SSH launch parser.
//!
//! @author kongweiguang

use url::Url;

use crate::error::{AppError, AppResult};

use super::common::{build_request, empty_to_none, find_option_index, should_parse};
use crate::services::external_launch::{
    model::{
        ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretSlot,
        ExternalSecretSource, ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest,
        ExternalSshTarget,
    },
    parser::ExternalLaunchParser,
    redaction::redact_xshell_url,
    ssh_url::{percent_decode_lossy, strip_b64_prefix},
};

pub(crate) struct XshellParser;

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
        if let Some((target, auth, options)) = super::xshell_url::parse_xshell_bridge_url(
            raw_url,
            xshell_trailing_display_name(&input.argv),
        )? {
            return Ok(Some(build_request(
                input,
                self.tool(),
                "xshell-bhost-url",
                target,
                auth,
                options,
                redacted,
            )));
        }
        if let Some((target, auth)) = super::xshell_url::parse_xshell_b64_target(raw_url)? {
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

pub(super) fn xshell_url_argument(argv: &[String]) -> Option<(usize, &str)> {
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

fn xshell_trailing_display_name(argv: &[String]) -> Option<String> {
    find_option_index(argv, &["-newtab"])
        .and_then(|index| argv.get(index + 1))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && !value.starts_with('-') && !value.starts_with('/'))
        .map(ToOwned::to_owned)
}
