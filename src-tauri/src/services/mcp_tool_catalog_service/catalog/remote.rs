//! SSH 运行态工具目录。
//!
//! @author kongweiguang

use crate::models::mcp_server::{ToolCategory, ToolDefinition};

use super::super::schema::{
    enum_field, number_field, object_schema, string_field, tool, ToolEffect,
};

pub(super) fn remote_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "ssh.command",
            "执行远程命令",
            "在已保存 SSH 主机上执行非交互远程命令；调用前确认由 MCP host 负责。",
            ToolCategory::Ssh,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("command", "远程 shell 命令或脚本片段。", true),
                string_field(
                    "proxyUrl",
                    "本次远程命令临时代理，不写远端 profile。",
                    false,
                ),
                enum_field(
                    "proxyProtocol",
                    "proxyUrl 的协议；缺省时根据 URL 推断。",
                    false,
                    vec!["http", "socks5"],
                ),
                number_field("timeoutSeconds", "执行超时时间，单位秒。", false),
                number_field("maxOutputBytes", "stdout/stderr 最大保留字节数。", false),
            ]),
        ),
        tool(
            "ssh.command_on_resolved_host",
            "解析目标后执行远程命令",
            "解析已保存 SSH 主机并执行非交互命令。",
            ToolCategory::Ssh,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "可选远程主机 id；已知时优先传入。", false),
                string_field("groupId", "可选主机分组 id。", false),
                string_field("groupName", "可选主机分组名称。", false),
                string_field("name", "可选主机名称。", false),
                string_field("host", "可选主机名或 IP。", false),
                string_field("username", "可选 SSH 用户名。", false),
                number_field("port", "可选 SSH 端口。", false),
                string_field("command", "远程 shell 命令或脚本片段。", true),
                string_field(
                    "proxyUrl",
                    "本次远程命令临时代理，不写远端 profile。",
                    false,
                ),
                enum_field(
                    "proxyProtocol",
                    "proxyUrl 的协议；缺省时根据 URL 推断。",
                    false,
                    vec!["http", "socks5"],
                ),
                number_field("timeoutSeconds", "执行超时时间，单位秒。", false),
                number_field("maxOutputBytes", "stdout/stderr 最大保留字节数。", false),
            ]),
        ),
    ]
}
