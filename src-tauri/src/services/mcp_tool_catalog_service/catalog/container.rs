//! Docker/Podman 容器工具目录。
//!
//! @author kongweiguang

use crate::models::mcp_server::{ToolCategory, ToolDefinition};

use super::super::schema::{
    boolean_field, enum_field, number_field, object_schema, string_field, tool, ToolEffect,
};

pub(super) fn container_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "container.list",
            "列出容器",
            "读取 Docker/Podman 容器列表。",
            ToolCategory::Container,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                runtime_field(),
                boolean_field("includeStopped", "是否包含已停止容器。", false),
            ]),
        ),
        tool(
            "container.files.list",
            "列出容器目录",
            "读取容器目录。",
            ToolCategory::Container,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                string_field("containerId", "容器 id 或名称。", true),
                runtime_field(),
                string_field("path", "容器内目录路径。", true),
            ]),
        ),
        tool(
            "container.files.preview",
            "预览容器文件",
            "读取容器文本文件预览。",
            ToolCategory::Container,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                string_field("containerId", "容器 id 或名称。", true),
                runtime_field(),
                string_field("path", "容器内文件路径。", true),
                number_field("maxBytes", "最多读取字节数。", false),
            ]),
        ),
    ]
}

fn runtime_field() -> super::super::schema::FieldSchema {
    enum_field(
        "runtime",
        "容器运行时；为空时使用 Docker。",
        false,
        vec!["docker", "podman"],
    )
}
