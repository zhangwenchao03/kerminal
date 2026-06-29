//! 连接启动 Tauri Commands。
//!
//! @author kongweiguang

use std::{
    fs,
    time::{Duration, Instant},
};

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
        connection::{
            ConnectionTestMode, ConnectionTestRequest, ConnectionTestResult, RdpOpenRequest,
            RdpOpenResult,
        },
        remote_host::{
            parse_vault_secret_ref, RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest,
        },
    },
    services::encrypted_vault_service::EncryptedVaultService,
    state::AppState,
};
use tauri::State;
use tokio::net::TcpStream;

#[doc(hidden)]
pub mod rules {
    use crate::{
        error::AppResult,
        models::{
            connection::RdpOpenRequest,
            remote_host::{RemoteHost, RemoteHostCreateRequest},
        },
        state::AppState,
    };

    pub fn build_rdp_file_content(request: &RdpOpenRequest, password_blob: Option<&str>) -> String {
        super::build_rdp_file_content(request, password_blob)
    }

    pub fn format_rdp_full_address(host: &str, port: u16) -> String {
        super::format_rdp_full_address(host, port)
    }

    pub fn remote_host_from_create_request(
        label: &str,
        request: RemoteHostCreateRequest,
    ) -> AppResult<RemoteHost> {
        super::remote_host_from_create_request(label, request)
    }

    pub fn saved_rdp_password(state: &AppState, host: &RemoteHost) -> AppResult<Option<String>> {
        super::saved_rdp_password(state, host)
    }

    pub async fn test_tcp_endpoint(
        label: &str,
        host: &str,
        port: u16,
        timeout_seconds: u64,
    ) -> AppResult<()> {
        super::test_tcp_endpoint(label, host, port, timeout_seconds).await
    }
}

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

/// 测试连接配置，不启动终端或系统客户端。
#[tauri::command]
pub async fn connection_test(
    state: State<'_, AppState>,
    request: ConnectionTestRequest,
) -> Result<ConnectionTestResult, String> {
    test_connection(&state, request)
        .await
        .map_err(|error| error.to_string())
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

    let host = state.remote_hosts().require_host(host_id)?;
    if !is_rdp_host(&host) {
        return Err(AppError::InvalidInput(
            "该连接不是已保存的 RDP 配置".to_string(),
        ));
    }

    let password = saved_rdp_password(state, &host)?;

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

fn saved_rdp_password(state: &AppState, host: &RemoteHost) -> AppResult<Option<String>> {
    match host.auth_type {
        RemoteHostAuthType::Password => {
            if let Some(secret_ref) = host
                .secret_ref
                .as_deref()
                .filter(|secret_ref| !secret_ref.trim().is_empty())
            {
                return Ok(Some(decrypt_vault_password_secret_ref(
                    &EncryptedVaultService::new(state.paths().clone()),
                    secret_ref,
                )?));
            }

            Err(AppError::Credential(
                "RDP 密码认证缺少已保存密码".to_string(),
            ))
        }
        RemoteHostAuthType::Agent | RemoteHostAuthType::Key => Ok(None),
    }
}

fn decrypt_vault_password_secret_ref(
    vault: &EncryptedVaultService,
    secret_ref: &str,
) -> AppResult<String> {
    let parsed = parse_vault_secret_ref(secret_ref).map_err(AppError::InvalidInput)?;
    if parsed.kind != "rdp-host" {
        return Err(AppError::InvalidInput(format!(
            "RDP 只能使用 rdp-host 类型的 vault 凭据，当前为 {}",
            parsed.kind
        )));
    }
    if parsed.material != "password" {
        return Err(AppError::InvalidInput(format!(
            "RDP 只能使用 password 类型的 vault 凭据，当前为 {}",
            parsed.material
        )));
    }
    let key = vault
        .read_key()
        .map_err(|_| AppError::Credential("RDP vault key is missing or unreadable".to_owned()))?;
    let entry_id = parsed.entry_id();
    let entry = vault
        .entry_by_id(&entry_id)?
        .ok_or_else(|| AppError::Credential(format!("未找到 RDP vault 凭据: {entry_id}")))?;
    let plaintext = vault
        .decrypt_secret(&key, &entry, secret_ref.as_bytes())
        .map_err(|_| AppError::Credential(format!("RDP vault 凭据无法解密: {entry_id}")))?;
    String::from_utf8(plaintext)
        .map_err(|_| AppError::Credential(format!("RDP vault 凭据不是 UTF-8 文本: {entry_id}")))
}

async fn test_connection(
    state: &AppState,
    request: ConnectionTestRequest,
) -> AppResult<ConnectionTestResult> {
    let started = Instant::now();
    match request {
        ConnectionTestRequest::Ssh { host } => {
            let host = remote_host_from_create_request("SSH", host)?;
            state
                .ssh_commands()
                .test_connection(state.paths(), &host)
                .await?;
            Ok(connection_test_result(
                ConnectionTestMode::Ssh,
                started,
                format!(
                    "SSH 连接测试通过：{}@{}:{}",
                    host.username, host.host, host.port
                ),
            ))
        }
        ConnectionTestRequest::Rdp { request } => {
            validate_rdp_request(&request)?;
            test_tcp_endpoint("RDP", &request.host, request.port, 10).await?;
            Ok(connection_test_result(
                ConnectionTestMode::Rdp,
                started,
                format!("RDP 端口可连接：{}:{}", request.host.trim(), request.port),
            ))
        }
        ConnectionTestRequest::Telnet { host } => {
            let host = remote_host_from_create_request("Telnet", host)?;
            test_tcp_endpoint("Telnet", &host.host, host.port, 10).await?;
            Ok(connection_test_result(
                ConnectionTestMode::Telnet,
                started,
                format!("Telnet 端口可连接：{}:{}", host.host, host.port),
            ))
        }
        ConnectionTestRequest::Serial { host } => {
            let host = remote_host_from_create_request("Serial", host)?;
            state.serial_terminals().test_connection(&host)?;
            Ok(connection_test_result(
                ConnectionTestMode::Serial,
                started,
                format!("Serial 串口可打开：{}", host.host),
            ))
        }
    }
}

fn connection_test_result(
    mode: ConnectionTestMode,
    started: Instant,
    message: String,
) -> ConnectionTestResult {
    let latency_ms = started.elapsed().as_millis();
    ConnectionTestResult {
        mode,
        connected: true,
        latency_ms,
        message: format!("{message}（{latency_ms} ms）"),
    }
}

async fn test_tcp_endpoint(
    label: &str,
    host: &str,
    port: u16,
    timeout_seconds: u64,
) -> AppResult<()> {
    let host = host.trim();
    if host.is_empty() {
        return Err(AppError::InvalidInput(format!("{label} 主机地址不能为空")));
    }
    if port == 0 {
        return Err(AppError::InvalidInput(format!("{label} 端口必须大于 0")));
    }

    let timeout = Duration::from_secs(timeout_seconds);
    match tokio::time::timeout(timeout, TcpStream::connect((host, port))).await {
        Ok(Ok(stream)) => {
            drop(stream);
            Ok(())
        }
        Ok(Err(error)) => Err(AppError::InvalidInput(format!(
            "{label} 连接失败：{host}:{port}（{error}）"
        ))),
        Err(_) => Err(AppError::InvalidInput(format!(
            "{label} 连接超时（{} 秒）：{host}:{port}",
            timeout.as_secs()
        ))),
    }
}

fn remote_host_from_create_request(
    label: &str,
    request: RemoteHostCreateRequest,
) -> AppResult<RemoteHost> {
    let tags = normalize_tags(request.tags);
    let name = normalize_required_text(&format!("{label} 名称"), request.name)?;
    let host = normalize_required_text(&format!("{label} 主机地址"), request.host)?;
    if host.chars().any(char::is_whitespace) {
        return Err(AppError::InvalidInput(format!(
            "{label} 主机地址不能包含空白字符"
        )));
    }
    if request.port == 0 {
        return Err(AppError::InvalidInput(format!("{label} 端口必须大于 0")));
    }
    let username = request.username.trim().to_owned();
    if label == "SSH" && username.is_empty() {
        return Err(AppError::InvalidInput("SSH 用户名不能为空".to_owned()));
    }
    let (credential_ref, credential_secret) = normalize_test_credential(
        request.auth_type,
        request.credential_ref,
        request.credential_secret,
    )?;

    Ok(RemoteHost {
        id: "connection-test".to_owned(),
        group_id: normalize_optional_text(request.group_id),
        name,
        host,
        port: request.port,
        username,
        auth_type: request.auth_type,
        credential_ref,
        secret_ref: None,
        key_passphrase_ref: None,
        credential_secret,
        credential_status: Default::default(),
        tags,
        production: request.production,
        ssh_options: request.ssh_options,
        sort_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
    })
}

fn normalize_test_credential(
    auth_type: RemoteHostAuthType,
    credential_ref: Option<String>,
    credential_secret: Option<String>,
) -> AppResult<(Option<String>, Option<String>)> {
    let credential_ref = normalize_optional_text(credential_ref);
    let credential_secret = credential_secret.filter(|secret| !secret.trim().is_empty());
    match auth_type {
        RemoteHostAuthType::Agent => Ok((None, None)),
        RemoteHostAuthType::Password => {
            if credential_ref.is_some() {
                return Err(AppError::InvalidInput(
                    "密码认证不再使用凭据引用，请直接填写明文密码".to_owned(),
                ));
            }
            let Some(secret) = credential_secret else {
                return Err(AppError::InvalidInput(
                    "密码认证需要填写明文密码".to_owned(),
                ));
            };
            Ok((None, Some(secret)))
        }
        RemoteHostAuthType::Key => {
            if credential_ref
                .as_deref()
                .is_some_and(|value| value.starts_with("credential:"))
            {
                return Err(AppError::InvalidInput(
                    "密钥认证不再支持 credential: 凭据引用，请填写私钥路径或直接粘贴私钥内容"
                        .to_owned(),
                ));
            }
            match (credential_ref, credential_secret) {
                (Some(_), Some(_)) => Err(AppError::InvalidInput(
                    "密钥认证的私钥路径和私钥内容只能填写一项".to_owned(),
                )),
                (Some(path), None) => Ok((Some(path), None)),
                (None, Some(secret)) => Ok((None, Some(secret))),
                (None, None) => Err(AppError::InvalidInput(
                    "密钥认证需要填写私钥路径或直接粘贴私钥内容".to_owned(),
                )),
            }
        }
    }
}

fn normalize_required_text(field: &str, value: String) -> AppResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    Ok(value)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    tags.into_iter()
        .map(|tag| tag.trim().to_owned())
        .filter(|tag| !tag.is_empty())
        .collect()
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
