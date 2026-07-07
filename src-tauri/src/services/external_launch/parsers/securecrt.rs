//! SecureCRT external SSH launch parser.
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};

use super::common::{build_request, option_value, should_parse};
use crate::services::external_launch::{
    destination::parse_port,
    model::{
        ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSecretKind, ExternalSecretSlot,
        ExternalSecretSource, ExternalSshAuth, ExternalSshLaunchOptions, ExternalSshLaunchRequest,
        ExternalSshTarget,
    },
    parser::ExternalLaunchParser,
    redaction::{redact_path, redact_value},
    ssh_url::{percent_decode_lossy, strip_b64_prefix},
};

pub(crate) struct SecureCrtParser;

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
                if strip_b64_prefix(&percent_decode_lossy(option_value(&input.argv, i, "/L")?))
                    .is_some()
                {
                    redact_value(&mut redacted, i + 1);
                }
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
