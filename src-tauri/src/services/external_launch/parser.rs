//! External SSH launch parser registry.
//!
//! @author kongweiguang

use crate::error::{AppError, AppResult};

use super::{
    classifier::infer_source_tool_from_args,
    model::{ExternalLaunchParseInput, ExternalLaunchSourceTool, ExternalSshLaunchRequest},
    parsers::{
        KerminalNativeParser, MobaXtermParser, OpenSshParser, PuttyParser, SecureCrtParser,
        XshellParser,
    },
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
