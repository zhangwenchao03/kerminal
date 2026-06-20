//! Docker/Podman 容器目标 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::{
    sftp::{SftpEntry, SftpFileRevision, SftpTransferKind},
    target::{ContainerRuntime, RemoteTargetRef, TargetCapabilities},
};

/// 容器运行状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DockerContainerStatus {
    /// 容器正在运行。
    Running,
    /// 容器已停止。
    Exited,
    /// 容器暂停。
    Paused,
    /// 容器正在重启。
    Restarting,
    /// 容器已创建但未运行。
    Created,
    /// 容器处于 dead 状态。
    Dead,
    /// 无法识别的状态。
    Unknown,
}

impl DockerContainerStatus {
    /// 从 Docker/Podman CLI 输出的 state/status 字段推断状态。
    pub fn from_cli_fields(state: &str, status: &str) -> Self {
        let normalized_state = state.trim().to_ascii_lowercase();
        match normalized_state.as_str() {
            "running" => return Self::Running,
            "exited" | "stopped" => return Self::Exited,
            "paused" => return Self::Paused,
            "restarting" => return Self::Restarting,
            "created" => return Self::Created,
            "dead" => return Self::Dead,
            _ => {}
        }

        let normalized_status = status.trim().to_ascii_lowercase();
        if normalized_status.starts_with("up ") {
            Self::Running
        } else if normalized_status.starts_with("exited ") {
            Self::Exited
        } else if normalized_status.contains("paused") {
            Self::Paused
        } else if normalized_status.contains("restarting") {
            Self::Restarting
        } else if normalized_status.contains("created") {
            Self::Created
        } else if normalized_status.contains("dead") {
            Self::Dead
        } else {
            Self::Unknown
        }
    }
}

/// 容器列表请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerListRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 是否包含已停止容器。
    #[serde(default)]
    pub include_stopped: bool,
}

/// 容器终端创建请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerTerminalCreateRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 进入容器后执行的 shell 脚本；为空时自动选择 bash/sh。
    pub shell: Option<String>,
    /// docker exec --user。
    pub user: Option<String>,
    /// docker exec --workdir。
    pub workdir: Option<String>,
    /// 初始列数。
    pub cols: u16,
    /// 初始行数。
    pub rows: u16,
}

/// 容器摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerSummary {
    /// 宿主 SSH 主机 id。
    pub host_id: String,
    /// 容器完整 id。
    pub id: String,
    /// 容器短 id。
    pub short_id: String,
    /// 展示名称。
    pub name: String,
    /// 镜像。
    pub image: String,
    /// 原始状态文本。
    pub status_text: String,
    /// 规范化状态。
    pub status: DockerContainerStatus,
    /// 原始 state 字段。
    pub state: String,
    /// 端口摘要。
    pub ports: Vec<String>,
    /// 容器运行时。
    pub runtime: ContainerRuntime,
    /// 统一目标引用。
    pub target: RemoteTargetRef,
    /// 容器目标能力。
    pub capabilities: TargetCapabilities,
}

/// 容器内路径请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerPathRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内路径。
    pub path: String,
}

/// 容器目录列表响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerDirectoryListing {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 当前容器路径。
    pub path: String,
    /// 上级目录。
    pub parent_path: Option<String>,
    /// 当前目录条目。
    pub entries: Vec<SftpEntry>,
}

/// 容器文件预览请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerPreviewRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内文件路径。
    pub path: String,
    /// 最多读取字节数；为空时使用服务默认值。
    pub max_bytes: Option<usize>,
}

/// 容器文件预览响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerFilePreview {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器内文件路径。
    pub path: String,
    /// 文本预览内容。
    pub content: String,
    /// 实际返回字节数。
    pub bytes_read: usize,
    /// 本次请求允许读取的最大字节数。
    pub max_bytes: usize,
    /// 是否因为读取上限被截断。
    pub truncated: bool,
    /// 当前预览使用的编码说明。
    pub encoding: String,
}

/// 容器文本文件读取请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerReadTextFileRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内文件路径。
    pub path: String,
    /// 最大读取字节数；为空时使用编辑器默认上限。
    pub max_bytes: Option<usize>,
}

/// 容器文本文件读取响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerReadTextFileResponse {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器内文件路径。
    pub path: String,
    /// 文本内容。
    pub content: String,
    /// 实际返回字节数。
    pub bytes_read: usize,
    /// 本次读取允许的最大字节数。
    pub max_bytes: usize,
    /// 是否因为读取上限被截断。
    pub truncated: bool,
    /// 当前读取使用的编码说明。
    pub encoding: String,
    /// 检测到的行尾类型。
    pub line_ending: String,
    /// 打开文件时的容器文件 revision。
    pub revision: SftpFileRevision,
    /// 是否检测到二进制内容。
    pub binary: bool,
    /// 是否建议前端只读展示。
    pub readonly: bool,
}

/// 容器文本文件写入请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerWriteTextFileRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内文件路径。
    pub path: String,
    /// 要写入的文本内容。
    pub content: String,
    /// 文本编码，目前只接受 `utf-8` 或 `utf-8-lossy`。
    pub encoding: String,
    /// 打开文件时记录的 revision，用于保存前冲突检测。
    pub expected_revision: Option<SftpFileRevision>,
    /// 是否按新建文件处理。
    pub create: bool,
    /// 是否在 revision 冲突时显式覆盖远端内容。
    pub overwrite_on_conflict: bool,
}

/// 容器文本文件写入响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerWriteTextFileResponse {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器内文件路径。
    pub path: String,
    /// 写入字节数。
    pub bytes_written: usize,
    /// 保存后的编码说明。
    pub encoding: String,
    /// 保存后的行尾类型。
    pub line_ending: String,
    /// 保存完成后的新 revision。
    pub revision: SftpFileRevision,
}

/// 容器删除请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerDeleteRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内路径。
    pub path: String,
    /// 是否按目录删除。
    pub directory: bool,
}

/// 容器重命名请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerRenameRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 原容器内路径。
    pub from_path: String,
    /// 新容器内路径。
    pub to_path: String,
}

/// 容器 chmod 请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerChmodRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内路径。
    pub path: String,
    /// 八进制权限模式。
    pub mode: String,
}

/// 容器上传/下载请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerTransferRequest {
    /// 已保存 SSH 宿主 id。
    pub host_id: String,
    /// 容器 id 或名称。
    pub container_id: String,
    /// 容器运行时；为空时使用 Docker。
    #[serde(default)]
    pub runtime: ContainerRuntime,
    /// 容器内路径。
    pub remote_path: String,
    /// 本地路径。
    pub local_path: String,
    /// 传输对象类型。
    pub kind: SftpTransferKind,
}
