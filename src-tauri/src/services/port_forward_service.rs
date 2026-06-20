//! SSH 端口转发服务。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    process::{Child, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        port_forward::{
            PortForwardCreateRequest, PortForwardKind, PortForwardStatus, PortForwardSummary,
        },
        remote_host::{RemoteHost, RemoteHostAuthType},
    },
    services::process_command::silent_command,
    storage::SqliteStore,
};

/// SSH 端口转发业务入口。
#[derive(Debug, Default)]
pub struct PortForwardService {
    sessions: Mutex<HashMap<String, PortForwardSession>>,
}

#[derive(Debug)]
struct PortForwardSession {
    child: Child,
    summary: PortForwardSummary,
}

impl PortForwardService {
    /// 创建端口转发服务。
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建 SSH 端口转发。
    pub fn create(
        &self,
        storage: &SqliteStore,
        request: PortForwardCreateRequest,
    ) -> AppResult<PortForwardSummary> {
        let host = storage
            .remote_host_by_id(&request.host_id)?
            .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {}", request.host_id)))?;
        let plan = build_forward_plan(&host, resolve_ssh_executable()?, &request)?;
        let mut command = silent_command(&plan.executable);
        let mut child = command
            .args(&plan.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| AppError::PortForward(format!("无法启动 SSH 端口转发: {error}")))?;

        let summary = PortForwardSummary {
            id: Uuid::new_v4().to_string(),
            host_id: host.id.clone(),
            host_name: host.name.clone(),
            name: normalized_name(&request, &host),
            kind: request.kind,
            bind_host: plan.bind_host,
            source_port: request.source_port,
            target_host: plan.target_host,
            target_port: plan.target_port,
            pid: Some(child.id()),
            status: PortForwardStatus::Running,
            created_at: unix_timestamp(),
        };

        if let Some(status) = child
            .try_wait()
            .map_err(|error| AppError::PortForward(format!("无法读取端口转发状态: {error}")))?
        {
            return Err(AppError::PortForward(format!(
                "SSH 端口转发启动后立即退出，退出码: {status}"
            )));
        }

        let mut sessions = self.sessions()?;
        sessions.insert(
            summary.id.clone(),
            PortForwardSession {
                child,
                summary: summary.clone(),
            },
        );
        Ok(summary)
    }

    /// 列出当前端口转发。
    pub fn list(&self) -> AppResult<Vec<PortForwardSummary>> {
        let mut sessions = self.sessions()?;
        for session in sessions.values_mut() {
            if session.summary.status == PortForwardStatus::Running
                && session
                    .child
                    .try_wait()
                    .map_err(|error| {
                        AppError::PortForward(format!("无法读取端口转发状态: {error}"))
                    })?
                    .is_some()
            {
                session.summary.status = PortForwardStatus::Exited;
            }
        }

        let mut summaries: Vec<_> = sessions
            .values()
            .map(|session| session.summary.clone())
            .collect();
        summaries.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(summaries)
    }

    /// 关闭端口转发。
    pub fn close(&self, forward_id: &str) -> AppResult<bool> {
        let mut sessions = self.sessions()?;
        let Some(mut session) = sessions.remove(forward_id) else {
            return Ok(false);
        };

        if session
            .child
            .try_wait()
            .map_err(|error| AppError::PortForward(format!("无法读取端口转发状态: {error}")))?
            .is_none()
        {
            session
                .child
                .kill()
                .map_err(|error| AppError::PortForward(format!("无法停止端口转发: {error}")))?;
        }
        let _ = session.child.wait();
        Ok(true)
    }

    fn sessions(
        &self,
    ) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, PortForwardSession>>> {
        self.sessions
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("port forward sessions"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ForwardCommandPlan {
    executable: String,
    args: Vec<String>,
    bind_host: String,
    target_host: Option<String>,
    target_port: Option<u16>,
}

fn build_forward_plan(
    host: &RemoteHost,
    executable: String,
    request: &PortForwardCreateRequest,
) -> AppResult<ForwardCommandPlan> {
    if request.source_port == 0 {
        return Err(AppError::InvalidInput("监听端口必须大于 0".to_owned()));
    }

    let bind_host = validate_host_like(
        request
            .bind_host
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("127.0.0.1"),
        "监听地址",
    )?;
    let forward_arg = match request.kind {
        PortForwardKind::Local => {
            let target_host = required_target_host(request)?;
            let target_port = required_target_port(request)?;
            format!(
                "{}:{}:{}:{}",
                bind_host, request.source_port, target_host, target_port
            )
        }
        PortForwardKind::Remote => {
            let target_host = required_target_host(request)?;
            let target_port = required_target_port(request)?;
            format!(
                "{}:{}:{}:{}",
                bind_host, request.source_port, target_host, target_port
            )
        }
        PortForwardKind::Dynamic => format!("{}:{}", bind_host, request.source_port),
    };

    let mut args = vec![
        "-N".to_owned(),
        "-T".to_owned(),
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "BatchMode=yes".to_owned(),
        "-o".to_owned(),
        "ExitOnForwardFailure=yes".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.push(forward_flag(request.kind).to_owned());
    args.push(forward_arg);
    args.push(format!("{}@{}", host.username, host.host));

    Ok(ForwardCommandPlan {
        executable,
        args,
        bind_host,
        target_host: request.target_host.clone(),
        target_port: request.target_port,
    })
}

fn required_target_host(request: &PortForwardCreateRequest) -> AppResult<String> {
    let target_host = request
        .target_host
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("目标主机不能为空".to_owned()))?;
    validate_host_like(target_host, "目标主机")
}

fn required_target_port(request: &PortForwardCreateRequest) -> AppResult<u16> {
    match request.target_port {
        Some(port) if port > 0 => Ok(port),
        _ => Err(AppError::InvalidInput("目标端口必须大于 0".to_owned())),
    }
}

fn validate_host_like(value: &str, label: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.contains('\0')
        || trimmed.contains('\r')
        || trimmed.contains('\n')
        || trimmed.split_whitespace().count() > 1
    {
        return Err(AppError::InvalidInput(format!("{label}不合法")));
    }
    Ok(trimmed.to_owned())
}

fn forward_flag(kind: PortForwardKind) -> &'static str {
    match kind {
        PortForwardKind::Local => "-L",
        PortForwardKind::Remote => "-R",
        PortForwardKind::Dynamic => "-D",
    }
}

fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn resolve_ssh_executable() -> AppResult<String> {
    which::which("ssh")
        .or_else(|_| which::which("ssh.exe"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|_| {
            AppError::PortForward(
                "未找到 OpenSSH 客户端，请安装 ssh 或确认 ssh 已加入 PATH".to_owned(),
            )
        })
}

fn normalized_name(request: &PortForwardCreateRequest, host: &RemoteHost) -> String {
    request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{} {}", host.name, forward_flag(request.kind)))
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
        RemoteHost {
            id: "host-1".to_owned(),
            group_id: Some("group-1".to_owned()),
            name: "dev".to_owned(),
            host: "dev.internal".to_owned(),
            port: 2222,
            username: "deploy".to_owned(),
            auth_type,
            credential_ref: Some("credential:ssh/dev".to_owned()),
            tags: vec!["dev".to_owned()],
            production: false,
            ssh_options: Default::default(),
            sort_order: 10,
            created_at: "now".to_owned(),
            updated_at: "now".to_owned(),
        }
    }

    #[test]
    fn build_local_forward_plan_uses_parameterized_openssh_args() {
        let request = PortForwardCreateRequest {
            host_id: "host-1".to_owned(),
            name: Some("pg tunnel".to_owned()),
            kind: PortForwardKind::Local,
            bind_host: Some("127.0.0.1".to_owned()),
            source_port: 15432,
            target_host: Some("127.0.0.1".to_owned()),
            target_port: Some(5432),
        };

        let plan = build_forward_plan(
            &remote_host(RemoteHostAuthType::Key),
            "ssh".to_owned(),
            &request,
        )
        .expect("build plan");

        assert_eq!(plan.executable, "ssh");
        assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2222"]));
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair == ["-L", "127.0.0.1:15432:127.0.0.1:5432"]));
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair == ["-o", "BatchMode=yes"]));
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair == ["-o", "ExitOnForwardFailure=yes"]));
        assert!(plan
            .args
            .contains(&"PreferredAuthentications=publickey".to_owned()));
        assert_eq!(
            plan.args.last().map(String::as_str),
            Some("deploy@dev.internal")
        );
        assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
    }

    #[test]
    fn build_dynamic_forward_plan_does_not_require_target() {
        let request = PortForwardCreateRequest {
            host_id: "host-1".to_owned(),
            name: None,
            kind: PortForwardKind::Dynamic,
            bind_host: None,
            source_port: 1080,
            target_host: None,
            target_port: None,
        };

        let plan = build_forward_plan(
            &remote_host(RemoteHostAuthType::Agent),
            "ssh".to_owned(),
            &request,
        )
        .expect("build dynamic plan");

        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair == ["-D", "127.0.0.1:1080"]));
        assert_eq!(plan.target_host, None);
        assert_eq!(plan.target_port, None);
    }

    #[test]
    fn build_forward_plan_rejects_invalid_ports_and_hosts() {
        let mut request = PortForwardCreateRequest {
            host_id: "host-1".to_owned(),
            name: None,
            kind: PortForwardKind::Local,
            bind_host: Some("127.0.0.1".to_owned()),
            source_port: 0,
            target_host: Some("127.0.0.1".to_owned()),
            target_port: Some(5432),
        };

        let error = build_forward_plan(
            &remote_host(RemoteHostAuthType::Key),
            "ssh".to_owned(),
            &request,
        )
        .expect_err("reject zero source port");
        assert!(matches!(error, AppError::InvalidInput(_)));

        request.source_port = 15432;
        request.target_host = Some("bad host".to_owned());
        let error = build_forward_plan(
            &remote_host(RemoteHostAuthType::Key),
            "ssh".to_owned(),
            &request,
        )
        .expect_err("reject host whitespace");
        assert!(matches!(error, AppError::InvalidInput(_)));
    }
}
