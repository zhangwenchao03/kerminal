//! 外部启动安全审查发现项的独立回归测试。
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    build_external_launch_shim_envelope, ExternalLaunchIntake, ExternalLaunchParseInput,
    ExternalLaunchParserRegistry, ExternalLaunchSourceTool,
};

#[test]
fn bridge_request_id_binds_parent_command_line_and_persona() {
    let intake = ExternalLaunchIntake::new();
    let mut first = build_external_launch_shim_envelope(
        vec![
            "ssh.exe".to_owned(),
            "ops@parent-binding.example.internal".to_owned(),
        ],
        None,
        None,
    )
    .expect("build first envelope");
    first.request_id = "request-parent-binding".to_owned();
    first.persona = ExternalLaunchSourceTool::Openssh;
    first.parent_command_line = Some("launcher.exe --profile first".to_owned());
    let mut conflicting = first.clone();
    conflicting.parent_command_line = Some("launcher.exe --profile other".to_owned());

    intake
        .accept_bridge_envelope(first)
        .expect("accept first envelope");
    let error = intake
        .accept_bridge_envelope(conflicting)
        .expect_err("request id must bind the parent command line");

    assert!(error.to_string().contains("request id was reused"));
}

#[test]
fn openssh_rejects_jump_chains_over_eight_hops() {
    let jumps = (0..9)
        .map(|index| format!("jump-{index}.example.internal"))
        .collect::<Vec<_>>()
        .join(",");
    let error = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec![
                "ssh.exe".to_owned(),
                "-J".to_owned(),
                jumps,
                "target.example.internal".to_owned(),
            ],
        ))
        .expect_err("oversized jump chain must fail before host identity I/O");

    assert!(error.to_string().contains("8-hop limit"));
}
