//! 终端运行态工具目录。
//!
//! @author kongweiguang

use crate::models::mcp_server::{ToolCategory, ToolDefinition};

use super::super::schema::{
    enum_field, number_field, object_schema, string_field, tool, tool_with_exposure, ToolEffect,
};

pub(super) fn foundation_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "terminal.write",
            "写入终端",
            "向指定既有 session 写入原始输入；在 session-scoped Agent endpoint 中必须通过 agentSessionId 和 bindingGeneration 写入当前 Agent 绑定目标，不能显式指定 sessionId。调用前确认由 MCP host 负责。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field(
                    "sessionId",
                    "终端 session id；仅全局 MCP endpoint 手动调用时使用，提供 agentSessionId 时禁止使用。",
                    false,
                ),
                string_field("agentSessionId", "Kerminal Agent session id；用于解析默认目标终端。", false),
                number_field(
                    "bindingGeneration",
                    "Agent target binding generation；通过 agentSessionId 写入时必填。",
                    false,
                ),
                string_field("data", "写入终端的原始输入。", true),
            ]),
        ),
        tool(
            "terminal.snapshot",
            "读取终端快照",
            "读取指定终端或当前 Agent 绑定目标的最近输出快照。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![
                string_field("sessionId", "终端 session id；提供 agentSessionId 时可省略。", false),
                string_field("agentSessionId", "Kerminal Agent session id；用于解析默认目标终端。", false),
                number_field("maxBytes", "最多读取的最近输出字节数，默认 24576。", false),
            ]),
        ),
        tool(
            "terminal.resolve_agent_target",
            "解析 Agent 目标终端",
            "把 Kerminal Agent session id 解析为当前绑定的目标终端，并返回 live/stale 状态。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![string_field(
                "agentSessionId",
                "Kerminal Agent session id。",
                true,
            )]),
        ),
        tool(
            "kerminal.agent.current_session",
            "读取 Agent 会话",
            "读取当前 Kerminal Agent session 文件元数据、provider 和关键路径。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![string_field(
                "agentSessionId",
                "Kerminal Agent session id。",
                true,
            )]),
        ),
        tool(
            "kerminal.agent.target_context",
            "读取 Agent 目标上下文",
            "读取当前 Agent 绑定目标、live/stale 状态和最近终端输出快照。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![
                string_field("agentSessionId", "Kerminal Agent session id。", true),
                number_field("maxBytes", "最多读取的最近输出字节数，默认 24576。", false),
            ]),
        ),
        tool(
            "kerminal.config.validate",
            "校验文件配置",
            "只读校验当前 Kerminal 文件型配置是否可被运行时代码加载；用于外部 Agent 编辑 settings/profiles/hosts/snippets/workflows 后验证，不做配置 CRUD，不读取 secrets。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![enum_field(
                "scope",
                "校验范围，默认 all。",
                false,
                vec!["all", "settings", "profiles", "hosts", "snippets", "workflows"],
            )]),
        ),
        tool(
            "terminal.resize",
            "调整终端尺寸",
            "同步 rows/cols 到后端会话。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field("sessionId", "终端 session id。", true),
                number_field("cols", "目标列数。", true),
                number_field("rows", "目标行数。", true),
            ]),
        ),
        tool(
            "terminal.list",
            "列出终端会话",
            "读取当前运行时本地终端会话摘要。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool_with_exposure(
            "terminal.close",
            "关闭终端会话",
            "关闭并移除指定本地终端会话；调用前确认由 MCP host 负责。",
            ToolCategory::Terminal,
            ToolEffect::Destructive,
            true,
            true,
            object_schema(vec![string_field("sessionId", "终端 session id。", true)]),
        ),
        tool(
            "terminal.log.start",
            "开始终端日志",
            "开始把指定终端 session 的新输出写入本地日志文件。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![string_field("sessionId", "终端 session id。", true)]),
        ),
        tool(
            "terminal.log.stop",
            "停止终端日志",
            "停止日志记录并返回路径摘要。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![string_field("sessionId", "终端 session id。", true)]),
        ),
        tool(
            "terminal.log.state",
            "读取终端日志状态",
            "读取指定终端 session 当前日志记录状态。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![string_field("sessionId", "终端 session id。", true)]),
        ),
    ]
}
