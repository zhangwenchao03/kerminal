use super::fixtures::*;

#[test]
fn parses_remote_dynamic_socks_arguments_for_mcp_tool_invocations() {
    let arguments = json!({
        "hostId": "host-a",
        "kind": "remoteDynamic",
        "proxyProtocol": "socks5",
        "remoteBindHost": "0.0.0.0",
        "remoteAccessScope": "allInterfaces",
        "proxyApplyScope": "toolOnly",
        "sourcePort": 18080
    });
    let arguments = arguments.as_object().expect("object args");

    let request =
        port_forward_create_request_from_arguments(arguments).expect("parse remote SOCKS");

    assert_eq!(request.host_id, "host-a");
    assert_eq!(request.origin, PortForwardOrigin::McpTool);
    assert_eq!(request.kind, PortForwardKind::RemoteDynamic);
    assert_eq!(
        request.proxy_protocol,
        Some(PortForwardProxyProtocol::Socks5)
    );
    assert_eq!(
        request.remote_access_scope,
        Some(PortForwardRemoteAccessScope::AllInterfaces)
    );
    assert_eq!(
        request.proxy_apply_scope,
        PortForwardProxyApplyScope::ToolOnly
    );
    assert_eq!(request.remote_bind_host.as_deref(), Some("0.0.0.0"));
    assert_eq!(request.local_endpoint, None);
}

#[test]
fn rejects_removed_http_proxy_protocol() {
    let arguments = json!({
        "hostId": "host-a",
        "kind": "remoteDynamic",
        "proxyProtocol": "http",
        "sourcePort": 18080
    });
    let arguments = arguments.as_object().expect("object args");

    let error =
        port_forward_create_request_from_arguments(arguments).expect_err("invalid proxy protocol");

    assert!(error.to_string().contains("proxyProtocol 只支持"));
}

#[test]
fn wraps_agent_ssh_command_with_http_proxy_exports() {
    let arguments = json!({
        "hostId": "host-a",
        "command": "curl -I https://example.com",
        "proxyUrl": "http://127.0.0.1:18080",
        "proxyProtocol": "http"
    });
    let arguments = arguments.as_object().expect("object args");

    let request = ssh_command_request_from_arguments(arguments).expect("parse ssh command");

    assert_eq!(request.host_id, "host-a");
    assert!(request
        .command
        .starts_with("export HTTP_PROXY='http://127.0.0.1:18080'\n"));
    assert!(request
        .command
        .contains("export HTTPS_PROXY='http://127.0.0.1:18080'\n"));
    assert!(request.command.ends_with("curl -I https://example.com"));
}

#[test]
fn wraps_agent_ssh_command_with_socks_proxy_exports() {
    let arguments = json!({
        "hostId": "host-a",
        "command": "git ls-remote origin",
        "proxyUrl": "socks5h://127.0.0.1:18080"
    });
    let arguments = arguments.as_object().expect("object args");

    let request = ssh_command_request_from_arguments(arguments).expect("parse ssh command");

    assert!(request
        .command
        .starts_with("export ALL_PROXY='socks5h://127.0.0.1:18080'\n"));
    assert!(request.command.ends_with("git ls-remote origin"));
}

#[test]
fn rejects_invalid_agent_ssh_command_proxy_url() {
    let arguments = json!({
        "hostId": "host-a",
        "command": "curl example.com",
        "proxyUrl": "file:///tmp/proxy"
    });
    let arguments = arguments.as_object().expect("object args");

    let error = ssh_command_request_from_arguments(arguments).expect_err("invalid proxy url");

    assert!(error.to_string().contains("proxyUrl 只支持"));
}
