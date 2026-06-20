//! 连接启动 Tauri Commands。
//!
//! @author kongweiguang

use std::fs;

#[cfg(target_os = "windows")]
use std::io::Write;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::process::Command;
#[cfg(target_os = "windows")]
use std::process::Stdio;

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        connection::{RdpOpenRequest, RdpOpenResult},
        remote_host::{RemoteHost, RemoteHostAuthType},
    },
    state::AppState,
};
use tauri::State;

/// 使用系统 RDP 客户端打开连接。
#[tauri::command]
pub fn connection_rdp_open(request: RdpOpenRequest) -> Result<RdpOpenResult, String> {
    open_rdp_connection(request).map_err(|error| error.to_string())
}

/// 使用已保存的 RDP 主机配置打开连接。
#[tauri::command]
pub fn connection_rdp_open_saved(
    state: State<'_, AppState>,
    host_id: String,
) -> Result<RdpOpenResult, String> {
    open_saved_rdp_connection(&state, &host_id).map_err(|error| error.to_string())
}

pub(crate) fn open_rdp_connection(request: RdpOpenRequest) -> AppResult<RdpOpenResult> {
    validate_rdp_request(&request)?;
    let password_blob = encrypted_rdp_password(request.password.as_deref())?;
    let rdp_content = build_rdp_file_content(&request, password_blob.as_deref());
    let file_path = std::env::temp_dir().join(format!(
        "kerminal-{}-{}.rdp",
        sanitize_file_token(&request.name),
        Uuid::new_v4()
    ));
    fs::write(&file_path, rdp_content)?;

    launch_system_rdp_client(&file_path)?;

    Ok(RdpOpenResult {
        launched: true,
        message: "已请求系统 RDP 客户端启动。".to_string(),
        file_path: Some(file_path.to_string_lossy().into_owned()),
    })
}

fn open_saved_rdp_connection(state: &AppState, host_id: &str) -> AppResult<RdpOpenResult> {
    let host_id = host_id.trim();
    if host_id.is_empty() {
        return Err(AppError::InvalidInput("RDP 主机 ID 不能为空".to_string()));
    }

    let host = state
        .storage()
        .remote_host_by_id(host_id)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))?;
    if !is_rdp_host(&host) {
        return Err(AppError::InvalidInput(
            "该连接不是已保存的 RDP 配置".to_string(),
        ));
    }

    let password = match host.auth_type {
        RemoteHostAuthType::Password => {
            let credential_ref = host
                .credential_ref
                .as_deref()
                .ok_or_else(|| AppError::Credential("RDP 密码认证缺少凭据引用".to_string()))?;
            Some(
                state
                    .credentials()
                    .get_secret(credential_ref)?
                    .ok_or_else(|| {
                        AppError::Credential(format!("未找到 RDP 密码凭据: {credential_ref}"))
                    })?,
            )
        }
        RemoteHostAuthType::Agent | RemoteHostAuthType::Key => None,
    };

    open_rdp_connection(RdpOpenRequest {
        desktop_height: None,
        desktop_width: None,
        fullscreen: true,
        host: host.host,
        name: host.name,
        note: None,
        password,
        port: host.port,
        username: Some(host.username).filter(|value| !value.trim().is_empty()),
    })
}

fn validate_rdp_request(request: &RdpOpenRequest) -> AppResult<()> {
    if request.host.trim().is_empty() {
        return Err(AppError::InvalidInput("请输入 RDP 主机地址".to_string()));
    }
    if request.port == 0 {
        return Err(AppError::InvalidInput("RDP 端口必须大于 0".to_string()));
    }
    Ok(())
}

fn build_rdp_file_content(request: &RdpOpenRequest, password_blob: Option<&str>) -> String {
    let mut lines = vec![
        format!(
            "full address:s:{}",
            format_rdp_full_address(request.host.trim(), request.port)
        ),
        "authentication level:i:2".to_string(),
        "enablecredsspsupport:i:1".to_string(),
        "redirectclipboard:i:1".to_string(),
        format!(
            "prompt for credentials:i:{}",
            if password_blob.is_some() { 0 } else { 1 }
        ),
        format!(
            "screen mode id:i:{}",
            if request.fullscreen { 2 } else { 1 }
        ),
    ];

    if let Some(username) = request
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("username:s:{username}"));
    }
    if let Some(width) = request.desktop_width.filter(|value| *value > 0) {
        lines.push(format!("desktopwidth:i:{width}"));
    }
    if let Some(height) = request.desktop_height.filter(|value| *value > 0) {
        lines.push(format!("desktopheight:i:{height}"));
    }
    if let Some(blob) = password_blob {
        lines.push(format!("password 51:b:{blob}"));
    }

    lines.join("\r\n") + "\r\n"
}

fn is_rdp_host(host: &RemoteHost) -> bool {
    host.tags
        .iter()
        .any(|tag| tag.trim().eq_ignore_ascii_case("rdp"))
}

fn format_rdp_full_address(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn encrypted_rdp_password(password: Option<&str>) -> AppResult<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        let Some(password) = password.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(None);
        };

        let mut child = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(AppError::Io)?;

        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(password.as_bytes()).map_err(AppError::Io)?;
        }

        let output = child.wait_with_output().map_err(AppError::Io)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AppError::InvalidInput(format!(
                "RDP 密码加密失败: {stderr}"
            )));
        }

        Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        ))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = password;
        Ok(None)
    }
}

fn launch_system_rdp_client(file_path: &std::path::Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("mstsc")
            .arg(file_path)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(file_path)
            .spawn()
            .map_err(AppError::Io)?;
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = file_path;
        Err(AppError::InvalidInput(
            "当前平台暂不支持通过系统客户端启动 RDP".to_string(),
        ))
    }
}

fn sanitize_file_token(value: &str) -> String {
    let token: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = token.trim_matches('-');
    if trimmed.is_empty() {
        "rdp".to_string()
    } else {
        trimmed.chars().take(32).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_ipv6_full_address_for_rdp_file() {
        assert_eq!(
            format_rdp_full_address("2001:db8::10", 3389),
            "[2001:db8::10]:3389"
        );
    }

    #[test]
    fn builds_rdp_content_with_core_fields() {
        let content = build_rdp_file_content(
            &RdpOpenRequest {
                desktop_height: Some(900),
                desktop_width: Some(1440),
                fullscreen: false,
                host: "rdp.internal".to_string(),
                name: "prod".to_string(),
                note: None,
                password: None,
                port: 3390,
                username: Some("administrator".to_string()),
            },
            Some("encrypted"),
        );

        assert!(content.contains("full address:s:rdp.internal:3390"));
        assert!(content.contains("username:s:administrator"));
        assert!(content.contains("desktopwidth:i:1440"));
        assert!(content.contains("password 51:b:encrypted"));
        assert!(content.contains("prompt for credentials:i:0"));
    }
}
