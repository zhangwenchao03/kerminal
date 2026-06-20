//! MCP prompt 渲染测试。
//!
//! @author kongweiguang

use super::*;

#[test]
fn mcp_gateway_renders_prompt_messages_and_validates_arguments() {
    let gateway = McpToolGateway::new();

    let mut suggest_arguments = serde_json::Map::new();
    suggest_arguments.insert(
        "goal".to_owned(),
        serde_json::json!("修复当前 cargo test 失败"),
    );
    let suggest = gateway
        .render_prompt(
            McpPromptRenderRequest {
                arguments: suggest_arguments,
                application_context: Some(app_context_request()),
                name: "kerminal.terminal.suggest".to_owned(),
                terminal_context: None,
            },
            McpPromptRenderRuntime {
                application_context: Some(app_context_request()),
                ..McpPromptRenderRuntime::default()
            },
        )
        .expect("suggest prompt");
    assert_eq!(suggest.protocol, "kerminal-mcp/prompts/get");
    assert_eq!(suggest.name, "kerminal.terminal.suggest");
    assert_eq!(suggest.title, "建议下一步命令");
    assert_eq!(suggest.arguments["goal"], "修复当前 cargo test 失败");
    assert_eq!(suggest.messages[0].role, "user");
    assert_eq!(suggest.messages[0].content_type, "text");
    assert!(suggest.messages[0].text.contains("不自动执行任何命令"));
    assert!(suggest.messages[0].text.contains("当前应用上下文"));
    assert!(suggest.messages[0].text.contains("本地 PowerShell"));
    assert!(suggest.messages[0].text.contains("当前终端上下文不可用"));

    let mut route_arguments = serde_json::Map::new();
    route_arguments.insert(
        "goal".to_owned(),
        serde_json::json!("打开 SFTP 面板并预览日志"),
    );
    let route = gateway
        .render_prompt(
            McpPromptRenderRequest {
                arguments: route_arguments,
                application_context: Some(app_context_request()),
                name: "kerminal.agent.route".to_owned(),
                terminal_context: None,
            },
            McpPromptRenderRuntime {
                application_context: Some(app_context_request()),
                ..McpPromptRenderRuntime::default()
            },
        )
        .expect("agent route prompt");
    assert_eq!(route.name, "kerminal.agent.route");
    assert!(route.messages[0].text.contains("skill 路由器"));
    assert!(route.messages[0].text.contains("sftp-files"));
    assert!(route.messages[0]
        .text
        .contains("当前 pane：本地 PowerShell"));

    let explain = gateway
        .render_prompt(
            McpPromptRenderRequest {
                arguments: serde_json::Map::new(),
                application_context: None,
                name: "kerminal.terminal.explain".to_owned(),
                terminal_context: None,
            },
            McpPromptRenderRuntime {
                terminal_context_error: Some("测试上下文不可用".to_owned()),
                ..McpPromptRenderRuntime::default()
            },
        )
        .expect("explain prompt");
    assert!(explain.messages[0].text.contains("测试上下文不可用"));
    assert!(explain.messages[0].text.contains("只解释和建议"));

    let missing_goal = gateway
        .render_prompt(
            McpPromptRenderRequest {
                arguments: serde_json::Map::new(),
                application_context: None,
                name: "kerminal.terminal.suggest".to_owned(),
                terminal_context: None,
            },
            McpPromptRenderRuntime::default(),
        )
        .expect_err("missing goal should fail");
    assert!(missing_goal
        .to_string()
        .contains("MCP prompt 参数缺失: goal"));

    let unknown = gateway
        .render_prompt(
            McpPromptRenderRequest {
                arguments: serde_json::Map::new(),
                application_context: None,
                name: "kerminal.unknown".to_owned(),
                terminal_context: None,
            },
            McpPromptRenderRuntime::default(),
        )
        .expect_err("unknown prompt should fail");
    assert!(unknown.to_string().contains("未知 MCP prompt"));
}

#[test]
fn mcp_gateway_renders_remote_safe_ops_prompt() {
    let gateway = McpToolGateway::new();
    let mut arguments = serde_json::Map::new();
    arguments.insert("hostId".to_owned(), serde_json::json!("dev-server"));
    arguments.insert(
        "task".to_owned(),
        serde_json::json!("安全检查磁盘空间并预览日志"),
    );

    let result = gateway
        .render_prompt(
            McpPromptRenderRequest {
                arguments,
                application_context: None,
                name: "kerminal.remote.safe_ops".to_owned(),
                terminal_context: None,
            },
            McpPromptRenderRuntime::default(),
        )
        .expect("remote safe ops prompt");

    assert_eq!(result.name, "kerminal.remote.safe_ops");
    assert_eq!(result.arguments["hostId"], "dev-server");
    assert!(result.messages[0].text.contains("先读后写"));
    assert!(result.messages[0].text.contains("Kerminal 工具"));
    assert!(result.messages[0].text.contains("dev-server"));
}
