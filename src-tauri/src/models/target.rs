//! 统一执行与文件目标 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// 可被终端、文件面板和 AI 上下文引用的目标类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TargetKind {
    /// 本地终端配置或本机文件系统。
    Local,
    /// 已保存 SSH 主机。
    Ssh,
    /// 已保存 Telnet 主机。
    Telnet,
    /// 已保存串口连接。
    Serial,
    /// SSH 主机上的 Docker/Podman 容器。
    DockerContainer,
}

/// 容器运行时类型。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContainerRuntime {
    /// Docker Engine / Docker CLI。
    #[default]
    Docker,
    /// Podman CLI 或兼容 API。
    Podman,
}

impl ContainerRuntime {
    /// 返回运行时稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Podman => "podman",
        }
    }
}

/// 前后端共享的目标引用。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteTargetRef {
    /// 本地目标；可选绑定一个终端 profile。
    #[serde(rename_all = "camelCase")]
    Local {
        /// 本地终端 profile id。
        #[serde(default)]
        profile_id: Option<String>,
    },
    /// SSH 主机目标。
    #[serde(rename_all = "camelCase")]
    Ssh {
        /// 已保存 SSH 主机 id。
        host_id: String,
    },
    /// Telnet 主机目标。
    #[serde(rename_all = "camelCase")]
    Telnet {
        /// 已保存 Telnet 主机 id。
        host_id: String,
    },
    /// 串口连接目标。
    #[serde(rename_all = "camelCase")]
    Serial {
        /// 已保存串口连接 id。
        host_id: String,
    },
    /// SSH 主机上的容器目标。
    #[serde(rename_all = "camelCase")]
    DockerContainer {
        /// 宿主 SSH 主机 id。
        host_id: String,
        /// 容器 id 或稳定名称。
        container_id: String,
        /// 容器运行时。
        #[serde(default)]
        runtime: ContainerRuntime,
        /// 展示用容器名称。
        #[serde(default)]
        container_name: Option<String>,
        /// 默认进入容器的用户。
        #[serde(default)]
        user: Option<String>,
        /// 默认工作目录。
        #[serde(default)]
        workdir: Option<String>,
    },
}

impl RemoteTargetRef {
    /// 返回目标类型。
    pub fn kind(&self) -> TargetKind {
        match self {
            Self::Local { .. } => TargetKind::Local,
            Self::Ssh { .. } => TargetKind::Ssh,
            Self::Telnet { .. } => TargetKind::Telnet,
            Self::Serial { .. } => TargetKind::Serial,
            Self::DockerContainer { .. } => TargetKind::DockerContainer,
        }
    }

    /// 返回适合作为前端 key、日志字段和队列分组的稳定 id。
    pub fn stable_id(&self) -> String {
        match self {
            Self::Local { profile_id } => profile_id
                .as_deref()
                .map(|id| format!("local:{id}"))
                .unwrap_or_else(|| "local".to_owned()),
            Self::Ssh { host_id } => format!("ssh:{host_id}"),
            Self::Telnet { host_id } => format!("telnet:{host_id}"),
            Self::Serial { host_id } => format!("serial:{host_id}"),
            Self::DockerContainer {
                host_id,
                container_id,
                runtime,
                ..
            } => format!("{}:{host_id}:{container_id}", runtime.as_str()),
        }
    }

    /// 返回该目标依附的已保存主机 id。
    pub fn host_id(&self) -> Option<&str> {
        match self {
            Self::Local { .. } => None,
            Self::Ssh { host_id }
            | Self::Telnet { host_id }
            | Self::Serial { host_id }
            | Self::DockerContainer { host_id, .. } => Some(host_id),
        }
    }

    /// 校验目标引用是否足够完整。
    pub fn validate(&self) -> AppResult<()> {
        match self {
            Self::Local { profile_id } => {
                validate_optional_id("本地 profile id", profile_id.as_deref())
            }
            Self::Ssh { host_id } => validate_required_id("SSH 主机 id", host_id),
            Self::Telnet { host_id } => validate_required_id("Telnet 主机 id", host_id),
            Self::Serial { host_id } => validate_required_id("串口连接 id", host_id),
            Self::DockerContainer {
                host_id,
                container_id,
                container_name,
                user,
                workdir,
                ..
            } => {
                validate_required_id("容器宿主 SSH 主机 id", host_id)?;
                validate_required_id("容器 id", container_id)?;
                validate_optional_id("容器名称", container_name.as_deref())?;
                validate_optional_id("容器用户", user.as_deref())?;
                validate_optional_path("容器工作目录", workdir.as_deref())
            }
        }
    }
}

/// 目标能力摘要，用于前端决定启用哪些操作。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TargetCapabilities {
    /// 能否创建交互式终端。
    pub terminal: bool,
    /// 能否执行短命令。
    pub exec: bool,
    /// 能否浏览文件。
    pub files: bool,
    /// 能否上传文件。
    pub upload: bool,
    /// 能否下载文件。
    pub download: bool,
    /// 能否监听/上报端口。
    pub ports: bool,
}

impl TargetCapabilities {
    /// 本地目标的默认能力。
    pub fn local() -> Self {
        Self {
            terminal: true,
            exec: true,
            files: false,
            upload: false,
            download: false,
            ports: false,
        }
    }

    /// SSH 主机的默认能力。
    pub fn ssh() -> Self {
        Self {
            terminal: true,
            exec: true,
            files: true,
            upload: true,
            download: true,
            ports: true,
        }
    }

    /// Telnet 主机的默认能力。
    pub fn telnet() -> Self {
        Self {
            terminal: true,
            exec: false,
            files: false,
            upload: false,
            download: false,
            ports: false,
        }
    }

    /// 串口连接的默认能力。
    pub fn serial() -> Self {
        Self {
            terminal: true,
            exec: false,
            files: false,
            upload: false,
            download: false,
            ports: false,
        }
    }

    /// 容器目标的默认能力。
    pub fn docker_container() -> Self {
        Self {
            terminal: true,
            exec: true,
            files: true,
            upload: true,
            download: true,
            ports: false,
        }
    }
}

/// 可展示的目标节点。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TargetDescriptor {
    /// 目标稳定 id。
    pub id: String,
    /// 用户可见名称。
    pub name: String,
    /// 用户可见说明。
    pub description: String,
    /// 目标引用。
    pub target: RemoteTargetRef,
    /// 能力摘要。
    pub capabilities: TargetCapabilities,
}

impl TargetDescriptor {
    /// 创建目标描述并自动填充稳定 id。
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        target: RemoteTargetRef,
        capabilities: TargetCapabilities,
    ) -> AppResult<Self> {
        target.validate()?;
        Ok(Self {
            id: target.stable_id(),
            name: name.into(),
            description: description.into(),
            target,
            capabilities,
        })
    }
}

/// 文件系统位置，由目标和目标内路径共同确定。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileLocation {
    /// 文件所在目标。
    pub target: RemoteTargetRef,
    /// 目标内路径。
    pub path: String,
}

impl FileLocation {
    /// 创建并规范化文件位置。
    pub fn new(target: RemoteTargetRef, path: impl AsRef<str>) -> AppResult<Self> {
        target.validate()?;
        Ok(Self {
            target,
            path: normalize_remote_path(path.as_ref())?,
        })
    }
}

/// 规范化远端 POSIX 风格路径。
pub fn normalize_remote_path(path: &str) -> AppResult<String> {
    if path.contains('\0') {
        return Err(AppError::InvalidInput(
            "远程路径不能包含 NUL 字符".to_owned(),
        ));
    }

    let mut normalized = path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Ok("/".to_owned());
    }
    if !normalized.starts_with('/') {
        normalized.insert(0, '/');
    }
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    if normalized.len() > 1 {
        normalized = normalized.trim_end_matches('/').to_owned();
    }
    Ok(normalized)
}

fn validate_required_id(field: &str, value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    ensure_plain_text(field, value)
}

fn validate_optional_id(field: &str, value: Option<&str>) -> AppResult<()> {
    if let Some(value) = value {
        if value.trim().is_empty() {
            return Ok(());
        }
        ensure_plain_text(field, value)?;
    }
    Ok(())
}

fn validate_optional_path(field: &str, value: Option<&str>) -> AppResult<()> {
    if let Some(value) = value {
        if value.trim().is_empty() {
            return Ok(());
        }
        if value.contains('\0') {
            return Err(AppError::InvalidInput(format!("{field}不能包含 NUL 字符")));
        }
    }
    Ok(())
}

fn ensure_plain_text(field: &str, value: &str) -> AppResult<()> {
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(AppError::InvalidInput(format!("{field}不能包含控制字符")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn target_ref_serializes_as_camel_case_discriminated_union() {
        let target = RemoteTargetRef::DockerContainer {
            host_id: "host-1".to_owned(),
            container_id: "abc123".to_owned(),
            runtime: ContainerRuntime::Docker,
            container_name: Some("api".to_owned()),
            user: Some("app".to_owned()),
            workdir: Some("/srv/app".to_owned()),
        };

        let value = serde_json::to_value(&target).expect("serialize target");

        assert_eq!(
            value,
            json!({
                "kind": "dockerContainer",
                "hostId": "host-1",
                "containerId": "abc123",
                "runtime": "docker",
                "containerName": "api",
                "user": "app",
                "workdir": "/srv/app"
            })
        );
        assert_eq!(target.kind(), TargetKind::DockerContainer);
        assert_eq!(target.host_id(), Some("host-1"));
        assert_eq!(target.stable_id(), "docker:host-1:abc123");
    }

    #[test]
    fn target_ref_rejects_missing_container_identity() {
        let error = RemoteTargetRef::DockerContainer {
            host_id: "host-1".to_owned(),
            container_id: " ".to_owned(),
            runtime: ContainerRuntime::Docker,
            container_name: None,
            user: None,
            workdir: None,
        }
        .validate()
        .expect_err("reject empty container id");

        assert!(matches!(error, AppError::InvalidInput(_)));
    }

    #[test]
    fn telnet_and_serial_targets_are_terminal_only() {
        let telnet = RemoteTargetRef::Telnet {
            host_id: "host-telnet".to_owned(),
        };
        let serial = RemoteTargetRef::Serial {
            host_id: "host-serial".to_owned(),
        };

        assert_eq!(telnet.kind(), TargetKind::Telnet);
        assert_eq!(telnet.host_id(), Some("host-telnet"));
        assert_eq!(telnet.stable_id(), "telnet:host-telnet");
        assert_eq!(serial.kind(), TargetKind::Serial);
        assert_eq!(serial.host_id(), Some("host-serial"));
        assert_eq!(serial.stable_id(), "serial:host-serial");
        assert_eq!(TargetCapabilities::telnet(), TargetCapabilities::serial());
        assert!(TargetCapabilities::telnet().terminal);
        assert!(!TargetCapabilities::serial().exec);
        telnet.validate().expect("valid telnet target");
        serial.validate().expect("valid serial target");
    }

    #[test]
    fn telnet_and_serial_targets_reject_empty_host_id() {
        let telnet_error = RemoteTargetRef::Telnet {
            host_id: " ".to_owned(),
        }
        .validate()
        .expect_err("reject empty telnet host id");
        let serial_error = RemoteTargetRef::Serial {
            host_id: "\n".to_owned(),
        }
        .validate()
        .expect_err("reject invalid serial host id");

        assert!(matches!(telnet_error, AppError::InvalidInput(_)));
        assert!(matches!(serial_error, AppError::InvalidInput(_)));
    }

    #[test]
    fn file_location_normalizes_remote_paths() {
        let location = FileLocation::new(
            RemoteTargetRef::Ssh {
                host_id: "host-1".to_owned(),
            },
            " var//log/ ",
        )
        .expect("normalize file location");

        assert_eq!(location.path, "/var/log");
        assert_eq!(location.target.stable_id(), "ssh:host-1");
    }

    #[test]
    fn target_descriptor_uses_target_stable_id() {
        let descriptor = TargetDescriptor::new(
            "prod",
            "deploy@prod",
            RemoteTargetRef::Ssh {
                host_id: "host-prod".to_owned(),
            },
            TargetCapabilities::ssh(),
        )
        .expect("create descriptor");

        assert_eq!(descriptor.id, "ssh:host-prod");
        assert!(descriptor.capabilities.files);
    }
}
