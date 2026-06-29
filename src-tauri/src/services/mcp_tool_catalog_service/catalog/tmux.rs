//! tmux runtime tool catalog.
//!
//! @author kongweiguang

use crate::models::mcp_server::{ToolCategory, ToolDefinition};

use super::super::schema::{
    enum_field, number_field, object_schema, string_field, tool, FieldSchema, ToolEffect,
};

pub(super) fn tmux_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "tmux.probe",
            "探测 tmux",
            "探测本地或已保存 SSH 主机上的 tmux 是否可用。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![]),
        ),
        tool(
            "tmux.list_sessions",
            "列出 tmux sessions",
            "读取本地或已保存 SSH 主机上的 tmux session 列表。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![]),
        ),
        tool(
            "tmux.create_session",
            "创建 tmux session",
            "创建 detached tmux session；调用前确认由 MCP host 负责。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![
                string_field("name", "新 session 名称。", true),
                string_field("cwd", "可选初始目录，由目标机器解释。", false),
            ]),
        ),
        tool(
            "tmux.rename_session",
            "重命名 tmux session",
            "重命名 tmux session；调用前确认由 MCP host 负责。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![
                string_field("sessionId", "session id 或名称。", true),
                string_field("name", "新 session 名称。", true),
            ]),
        ),
        tool(
            "tmux.kill_session",
            "结束 tmux session",
            "结束指定 tmux session；调用前确认由 MCP host 负责。",
            ToolCategory::Tmux,
            ToolEffect::Destructive,
            tmux_schema(vec![string_field("sessionId", "session id 或名称。", true)]),
        ),
        tool(
            "tmux.list_windows",
            "列出 tmux windows",
            "读取指定 tmux session 下的 window 列表。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![string_field("sessionId", "session id 或名称。", true)]),
        ),
        tool(
            "tmux.list_panes",
            "列出 tmux panes",
            "读取指定 tmux session、window 或 pane 下的 pane 列表。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![string_field(
                "targetId",
                "session、window 或 pane id。",
                true,
            )]),
        ),
        tool(
            "tmux.capture_pane",
            "捕获 tmux pane 输出",
            "读取指定 tmux pane 的最近输出并脱敏。",
            ToolCategory::Tmux,
            ToolEffect::Remote,
            tmux_schema(vec![
                string_field("paneId", "pane id，例如 %1。", true),
                number_field("lines", "最多读取最近多少行，默认 200，上限 1000。", false),
            ]),
        ),
        tool(
            "tmux.attach_plan",
            "生成 tmux attach 启动规格",
            "生成 attach 到指定 tmux session 的终端启动规格；不会创建 Kerminal pane。",
            ToolCategory::Tmux,
            ToolEffect::Read,
            tmux_schema(vec![
                string_field("sessionId", "session id 或名称。", true),
                string_field(
                    "sessionName",
                    "展示用 session 名称；为空时使用 sessionId。",
                    false,
                ),
                string_field("cwd", "可选初始目录，由目标机器解释。", false),
            ]),
        ),
    ]
}

fn tmux_schema(extra_fields: Vec<FieldSchema>) -> serde_json::Value {
    let mut fields = target_fields();
    fields.extend(extra_fields);
    object_schema(fields)
}

fn target_fields() -> Vec<FieldSchema> {
    vec![
        enum_field(
            "targetKind",
            "tmux 目标类型。local 使用本机 tmux；ssh 使用已保存 SSH 主机。",
            true,
            vec!["local", "ssh"],
        ),
        string_field(
            "hostId",
            "targetKind=ssh 时必填的已保存 SSH 主机 id。",
            false,
        ),
        string_field(
            "profileId",
            "targetKind=local 时可选的本地 profile id。",
            false,
        ),
        string_field(
            "socketName",
            "tmux -L socket 名称；不能和 socketPath 同时使用。",
            false,
        ),
        string_field("socketPath", "tmux -S socket 路径；由目标机器解释。", false),
        string_field("tmuxPath", "可选 tmux 可执行文件路径。", false),
    ]
}
