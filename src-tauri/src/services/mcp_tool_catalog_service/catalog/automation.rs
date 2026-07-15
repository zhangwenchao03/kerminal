//! 历史查询和诊断工具目录。
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::ToolCategory,
    services::mcp_tool_catalog_service::{ToolDescriptor, ToolId},
};

use super::super::schema::{
    enum_field, number_field, object_schema, string_field, tool, ToolEffect,
};

pub(super) fn automation_tools() -> Vec<ToolDescriptor> {
    vec![
        tool(
            ToolId::HistorySearch,
            "搜索命令历史",
            "读取本地命令历史摘要；不会执行命令。",
            ToolCategory::History,
            ToolEffect::Read,
            object_schema(vec![
                string_field("query", "搜索关键词。", false),
                enum_field("target", "目标类型。", false, vec!["local", "ssh"]),
                enum_field(
                    "source",
                    "命令来源。",
                    false,
                    vec!["user", "snippet", "broadcast", "tool"],
                ),
                string_field("paneId", "前端 pane id。", false),
                string_field("remoteHostId", "SSH 主机 id。", false),
                string_field("sessionId", "终端 session id。", false),
                number_field("limit", "返回数量上限。", false),
            ]),
        ),
        tool(
            ToolId::DiagnosticsRuntimeHealth,
            "读取运行体检",
            "读取进程、资源和数据目录体检摘要。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool(
            ToolId::DiagnosticsCreateBundle,
            "生成诊断包",
            "生成本地脱敏诊断包，不上传。",
            ToolCategory::Diagnostics,
            ToolEffect::Write,
            object_schema(vec![]),
        ),
    ]
}
