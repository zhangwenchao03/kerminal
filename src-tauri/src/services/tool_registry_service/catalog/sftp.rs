//! SFTP 与端口转发工具目录。
//!
//! @author kongweiguang

use crate::models::tool_registry::{
    ToolAuditPolicy, ToolCategory, ToolConfirmationPolicy, ToolDefinition, ToolRiskLevel,
};

use super::super::schema::{
    boolean_field, enum_field, number_field, object_schema, string_field, tool, tool_with_policy,
};

pub(super) fn sftp_tools() -> Vec<ToolDefinition> {
    vec![
        tool(
            "sftp.list",
            "列出远程目录",
            "读取当前 SSH 主机上的远程目录内容。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程目录路径。", true),
            ]),
        ),
        tool(
            "sftp.rename",
            "重命名远程路径",
            "重命名当前 SSH 主机上的远程文件或目录路径；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("fromPath", "原远程路径。", true),
                string_field("toPath", "新远程路径。", true),
            ]),
        ),
        tool(
            "sftp.move",
            "移动远程路径",
            "移动当前 SSH 主机上的远程文件或目录路径；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("fromPath", "原远程路径。", true),
                string_field("toPath", "目标远程路径。", true),
            ]),
        ),
        tool(
            "sftp.preview",
            "预览远程文件",
            "读取当前 SSH 主机上的远程文本文件预览；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程文件路径。", true),
                number_field("maxBytes", "最多读取字节数。", false),
            ]),
        ),
        tool(
            "sftp.download",
            "下载远程文件",
            "从当前 SSH 主机下载远程文件到本地路径；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("remotePath", "远程文件路径。", true),
                string_field("localPath", "本地保存路径。", true),
            ]),
        ),
        tool(
            "sftp.upload",
            "上传本地文件",
            "上传本地文件到当前 SSH 主机的远程路径；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("localPath", "本地文件路径。", true),
                string_field("remotePath", "远程保存路径。", true),
            ]),
        ),
        tool_with_policy(
            "sftp.delete",
            "删除远程文件",
            "删除当前 SSH 主机上的远程文件或空目录；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Destructive,
            ToolConfirmationPolicy::Always,
            ToolAuditPolicy::Full,
            true,
            true,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程路径。", true),
                boolean_field("directory", "是否按空目录删除。", false),
            ]),
        ),
        tool(
            "sftp.create_directory",
            "创建远程目录",
            "在当前 SSH 主机上创建远程目录；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程目录路径。", true),
            ]),
        ),
        tool(
            "sftp.chmod",
            "修改远程权限",
            "修改当前 SSH 主机上的远程路径权限；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程路径。", true),
                string_field("mode", "八进制权限模式，例如 644 或 0755。", true),
            ]),
        ),
        tool(
            "sftp.upload_directory",
            "上传本地目录",
            "递归上传本地目录到当前 SSH 主机远程路径；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("localPath", "本地目录路径。", true),
                string_field("remotePath", "远程保存路径。", true),
            ]),
        ),
        tool(
            "sftp.download_directory",
            "下载远程目录",
            "递归下载当前 SSH 主机远程目录到本地路径；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("remotePath", "远程目录路径。", true),
                string_field("localPath", "本地保存路径。", true),
            ]),
        ),
        tool(
            "sftp.transfer.enqueue",
            "创建 SFTP 传输任务",
            "把上传或下载任务加入 SFTP 传输队列，并返回可取消、可查看进度的任务 id。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("remotePath", "远程路径。", true),
                string_field("localPath", "本地路径。", true),
                enum_field("direction", "传输方向。", true, vec!["upload", "download"]),
                enum_field("kind", "传输对象类型。", true, vec!["file", "directory"]),
            ]),
        ),
        tool(
            "sftp.transfer.list",
            "列出 SFTP 传输任务",
            "读取当前运行时 SFTP 传输队列、状态和进度摘要。",
            ToolCategory::Sftp,
            ToolRiskLevel::Read,
            object_schema(vec![]),
        ),
        tool(
            "sftp.transfer.cancel",
            "取消 SFTP 传输任务",
            "请求取消指定 SFTP 传输任务；执行前必须确认。",
            ToolCategory::Sftp,
            ToolRiskLevel::Remote,
            object_schema(vec![string_field("transferId", "SFTP 传输任务 id。", true)]),
        ),
        tool(
            "sftp.transfer.clear_completed",
            "清理已结束 SFTP 任务",
            "从运行时队列中清理已成功、已失败或已取消的 SFTP 传输任务。",
            ToolCategory::Sftp,
            ToolRiskLevel::Write,
            object_schema(vec![]),
        ),
        tool(
            "server_info.snapshot",
            "读取服务器信息",
            "读取 SSH 主机 CPU、内存、磁盘、网络和运行时间摘要。",
            ToolCategory::ServerInfo,
            ToolRiskLevel::Remote,
            object_schema(vec![string_field("hostId", "远程主机 id。", true)]),
        ),
        tool(
            "port_forward.create",
            "创建端口转发",
            "创建 local、remote、dynamic SSH 端口转发，或 hostNetworkAssist 主机网络助手。",
            ToolCategory::PortForward,
            ToolRiskLevel::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("name", "用户可见转发名称。", false),
                enum_field(
                    "kind",
                    "转发类型。",
                    true,
                    vec!["local", "remote", "dynamic"],
                ),
                enum_field(
                    "purpose",
                    "转发用途；hostNetworkAssist 会创建主机使用本机网络的受管代理隧道。",
                    false,
                    vec!["generic", "hostNetworkAssist"],
                ),
                enum_field(
                    "proxyProtocol",
                    "网络助手代理协议。",
                    false,
                    vec!["http", "socks5"],
                ),
                string_field("bindHost", "监听地址，默认 127.0.0.1。", false),
                string_field("localBindHost", "本机侧监听地址或本机代理绑定地址。", false),
                string_field(
                    "remoteBindHost",
                    "远端监听地址，可为 127.0.0.1、0.0.0.0 或指定地址。",
                    false,
                ),
                number_field(
                    "sourcePort",
                    "监听端口，本地/动态时是本机端口，远程时是远端监听端口。",
                    true,
                ),
                string_field("targetHost", "目标主机；dynamic 转发可为空。", false),
                number_field("targetPort", "目标端口；dynamic 转发可为空。", false),
                string_field(
                    "localProxyHost",
                    "HTTP 网络助手的本机代理绑定地址；为空时自动分配共享本机代理入口。",
                    false,
                ),
                number_field(
                    "localProxyPort",
                    "HTTP 网络助手的本机代理端口；为空或 0 时自动分配。",
                    false,
                ),
                enum_field(
                    "remoteAccessScope",
                    "远端监听可见范围；非 loopback 需要远端 sshd GatewayPorts 支持。",
                    false,
                    vec!["loopback", "privateNetwork", "allInterfaces", "custom"],
                ),
                enum_field(
                    "proxyApplyScope",
                    "代理应用范围摘要；AI 工具不会默认写远端 profile。",
                    false,
                    vec![
                        "none",
                        "currentTerminal",
                        "futureTerminals",
                        "userProfile",
                        "toolOnly",
                    ],
                ),
            ]),
        ),
        tool(
            "port_forward.list",
            "列出端口转发",
            "读取已保存 SSH 端口转发配置及当前运行状态摘要。",
            ToolCategory::PortForward,
            ToolRiskLevel::Read,
            object_schema(vec![]),
        ),
        tool(
            "port_forward.close",
            "停止端口转发",
            "停止指定 SSH 端口转发会话并保留配置；执行前必须确认。",
            ToolCategory::PortForward,
            ToolRiskLevel::Remote,
            object_schema(vec![string_field("forwardId", "端口转发会话 id。", true)]),
        ),
    ]
}
