//! External SSH launch parser tests.
//!
//! @author kongweiguang

use serde_json::Value;

use kerminal_lib::services::external_launch::{
    ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchParserRegistry,
    ExternalLaunchSourceTool, ExternalSshLaunchRequest,
};

const CASES_JSON: &[&str] = &[
    include_str!("fixtures/external_launch/cases.json"),
    include_str!("fixtures/external_launch/cases-putty.json"),
    include_str!("fixtures/external_launch/cases-mobaxterm.json"),
    include_str!("fixtures/external_launch/cases-xshell.json"),
    include_str!("fixtures/external_launch/cases-securecrt.json"),
    include_str!("fixtures/external_launch/cases-openssh.json"),
    include_str!("fixtures/external_launch/cases-kerminal-native.json"),
];

include!("external_launch_parser/cases.rs");
include!("external_launch_parser/assertions.rs");
