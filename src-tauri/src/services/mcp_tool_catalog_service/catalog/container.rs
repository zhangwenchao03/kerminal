//! Docker/Podman 容器工具目录。
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::ToolCategory,
    services::mcp_tool_catalog_service::{ToolDescriptor, ToolId},
};

use super::super::schema::{
    boolean_field, enum_field, number_field, object_field, object_schema, string_field, tool,
    ToolEffect,
};

pub(super) fn container_tools() -> Vec<ToolDescriptor> {
    vec![
        tool(
            ToolId::ContainerList,
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
            ToolId::ContainerInspect,
            "读取容器详情",
            "读取 Docker/Podman inspect 精简摘要。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_info_schema(),
        ),
        tool(
            ToolId::ContainerLogsTail,
            "读取容器日志",
            "读取容器最近日志；tail 会被服务端限制在安全范围内。",
            ToolCategory::Container,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                string_field("containerId", "容器 id 或名称。", true),
                runtime_field(),
                number_field("tail", "读取最近多少行日志。", false),
            ]),
        ),
        tool(
            ToolId::ContainerStats,
            "读取容器监控",
            "读取一次性 no-stream stats 摘要。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_info_schema(),
        ),
        tool(
            ToolId::ContainerStart,
            "启动容器",
            "启动指定 Docker/Podman 容器。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_lifecycle_schema(false),
        ),
        tool(
            ToolId::ContainerStop,
            "停止容器",
            "停止指定 Docker/Podman 容器。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_lifecycle_schema(false),
        ),
        tool(
            ToolId::ContainerRestart,
            "重启容器",
            "重启指定 Docker/Podman 容器。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_lifecycle_schema(false),
        ),
        tool(
            ToolId::ContainerRemove,
            "删除容器",
            "删除指定 Docker/Podman 容器；force=true 会强制删除运行中容器。",
            ToolCategory::Container,
            ToolEffect::Destructive,
            container_lifecycle_schema(true),
        ),
        tool(
            ToolId::ContainerFilesList,
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
            ToolId::ContainerFilesPreview,
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
        tool(
            ToolId::ContainerFilesWriteText,
            "写入容器文本文件",
            "写入容器内 UTF-8 文本文件；expectedRevision 可用于保存前冲突检测。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_write_text_schema(),
        ),
        tool(
            ToolId::ContainerFilesCreateDirectory,
            "创建容器目录",
            "创建容器内目录；调用前确认由 MCP host 负责。",
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
            ToolId::ContainerFilesRename,
            "重命名容器路径",
            "重命名容器内文件或目录；调用前确认由 MCP host 负责。",
            ToolCategory::Container,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                string_field("containerId", "容器 id 或名称。", true),
                runtime_field(),
                string_field("fromPath", "原容器内路径。", true),
                string_field("toPath", "新容器内路径。", true),
            ]),
        ),
        tool(
            ToolId::ContainerFilesChmod,
            "修改容器路径权限",
            "修改容器内路径权限；调用前确认由 MCP host 负责。",
            ToolCategory::Container,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                string_field("containerId", "容器 id 或名称。", true),
                runtime_field(),
                string_field("path", "容器内路径。", true),
                string_field("mode", "八进制权限模式，例如 644 或 0755。", true),
            ]),
        ),
        tool(
            ToolId::ContainerFilesUpload,
            "上传到容器",
            "上传本地文件或目录到容器；调用前确认由 MCP host 负责。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_transfer_schema(),
        ),
        tool(
            ToolId::ContainerFilesDownload,
            "从容器下载",
            "下载容器内文件或目录到本地；调用前确认由 MCP host 负责。",
            ToolCategory::Container,
            ToolEffect::Remote,
            container_transfer_schema(),
        ),
        tool(
            ToolId::ContainerFilesDelete,
            "删除容器路径",
            "删除容器内文件或目录；directory=true 会递归删除目录。",
            ToolCategory::Container,
            ToolEffect::Destructive,
            object_schema(vec![
                string_field("hostId", "容器宿主 SSH 主机 id。", true),
                string_field("containerId", "容器 id 或名称。", true),
                runtime_field(),
                string_field("path", "容器内路径。", true),
                boolean_field("directory", "是否按目录递归删除。", true),
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

fn container_info_schema() -> serde_json::Value {
    object_schema(vec![
        string_field("hostId", "容器宿主 SSH 主机 id。", true),
        string_field("containerId", "容器 id 或名称。", true),
        runtime_field(),
    ])
}

fn container_lifecycle_schema(include_force: bool) -> serde_json::Value {
    let mut fields = vec![
        string_field("hostId", "容器宿主 SSH 主机 id。", true),
        string_field("containerId", "容器 id 或名称。", true),
        runtime_field(),
    ];
    if include_force {
        fields.push(boolean_field(
            "force",
            "删除容器时是否强制删除运行中的容器。",
            false,
        ));
    }
    object_schema(fields)
}

fn container_write_text_schema() -> serde_json::Value {
    object_schema(vec![
        string_field("hostId", "容器宿主 SSH 主机 id。", true),
        string_field("containerId", "容器 id 或名称。", true),
        runtime_field(),
        string_field("path", "容器内文件路径。", true),
        string_field("content", "要写入的 UTF-8 文本内容。", true),
        enum_field(
            "encoding",
            "文本编码，目前只接受 utf-8 或 utf-8-lossy。",
            true,
            vec!["utf-8", "utf-8-lossy"],
        ),
        object_field(
            "expectedRevision",
            "打开文件时记录的 revision；为空时新建或显式覆盖不做 CAS 比对。",
            false,
            vec![
                number_field("size", "文件大小，单位字节。", true),
                string_field("modified", "修改时间文本。", false),
                string_field("permissions", "权限文本。", false),
                number_field("permissionsMode", "原始权限 mode。", false),
                string_field("contentSha256", "文件内容 SHA-256。", false),
            ],
        ),
        boolean_field("create", "是否按新建文件处理。", true),
        boolean_field(
            "overwriteOnConflict",
            "revision 冲突或目标存在时是否显式覆盖。",
            true,
        ),
    ])
}

fn container_transfer_schema() -> serde_json::Value {
    object_schema(vec![
        string_field("hostId", "容器宿主 SSH 主机 id。", true),
        string_field("containerId", "容器 id 或名称。", true),
        runtime_field(),
        string_field("remotePath", "容器内路径。", true),
        string_field("localPath", "本地路径。", true),
        enum_field("kind", "传输对象类型。", true, vec!["file", "directory"]),
    ])
}
