//! 外部启动安全审查发现项的独立回归测试。
//!
//! @author kongweiguang

use kerminal_lib::services::external_launch::{
    ExternalLaunchParseInput, ExternalLaunchParserRegistry, ExternalLaunchSourceTool,
};

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
