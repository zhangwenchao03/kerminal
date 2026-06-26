//! 本机网络代理服务。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    net::{SocketAddr, ToSocketAddrs},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::{timeout, Duration},
};
use url::Url;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

const DEFAULT_BIND_HOST: &str = "127.0.0.1";
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HEADER_BYTES: usize = 64 * 1024;

/// 本机代理 entry 创建请求。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalProxyEntryRequest {
    /// 远程主机 id，用于统计归因。
    pub host_id: String,
    /// 端口转发或网络助手 session id。
    pub session_id: String,
    /// 逻辑入口标签，例如 network-assist/http。
    pub tag: Option<String>,
    /// 本机代理监听地址，默认 `127.0.0.1`。
    pub bind_host: Option<String>,
    /// 本机代理监听端口，`None` 或 `0` 表示由系统分配。
    pub port: Option<u16>,
}

/// 本机代理 entry 摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalProxyEntrySummary {
    /// 共享服务 id。
    pub service_id: String,
    /// 代理 entry id。
    pub entry_id: String,
    /// 远程主机 id。
    pub host_id: String,
    /// 端口转发或网络助手 session id。
    pub session_id: String,
    /// 逻辑入口标签。
    pub tag: Option<String>,
    /// 实际监听地址。
    pub bind_host: String,
    /// 实际监听端口。
    pub port: u16,
    /// HTTP proxy URL。
    pub proxy_url: String,
    /// 当前 entry 统计。
    pub stats: LocalProxyEntryStats,
    /// 创建时间，Unix epoch 秒。
    pub created_at: String,
}

/// 本机代理服务快照。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalNetworkProxySnapshot {
    /// 共享服务 id。
    pub service_id: String,
    /// 是否仍有监听中的 entry。
    pub running: bool,
    /// 当前 entry 列表。
    pub entries: Vec<LocalProxyEntrySummary>,
    /// 全服务聚合统计。
    pub stats: LocalProxyEntryStats,
}

/// 本机代理 entry 统计。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LocalProxyEntryStats {
    /// 已接受连接总数。
    pub accepted_connections: u64,
    /// 当前活跃连接数。
    pub active_connections: u64,
    /// 上行字节数，client -> target。
    pub bytes_from_client: u64,
    /// 下行字节数，target -> client。
    pub bytes_from_target: u64,
    /// 最近目标地址。
    pub last_target: Option<String>,
    /// 最近错误。
    pub last_error: Option<String>,
}

/// 受管本机 HTTP CONNECT/absolute-form 代理单例。
#[derive(Debug)]
pub struct LocalNetworkProxyService {
    service_id: String,
    entries: Mutex<HashMap<String, LocalProxyEntry>>,
}

#[derive(Debug)]
struct LocalProxyEntry {
    bind_host: String,
    created_at: String,
    host_id: String,
    port: u16,
    session_id: String,
    tag: Option<String>,
    shutdown: Option<oneshot::Sender<()>>,
    stats: Arc<Mutex<LocalProxyEntryStats>>,
}

#[derive(Debug)]
struct ParsedProxyRequest {
    buffered_body: Vec<u8>,
    header_text: String,
    target: String,
    target_host: String,
    target_port: u16,
    tunnel: bool,
}

impl Default for LocalNetworkProxyService {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalNetworkProxyService {
    /// 创建本机代理服务单例。
    pub fn new() -> Self {
        Self {
            service_id: format!("local-network-proxy-{}", Uuid::new_v4()),
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// 为一个主机/session 分配受管代理入口。
    pub fn acquire_entry(
        &self,
        request: LocalProxyEntryRequest,
    ) -> AppResult<LocalProxyEntrySummary> {
        let bind_host = normalize_host(
            request
                .bind_host
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(DEFAULT_BIND_HOST),
            "本机代理监听地址",
        )?;
        let port = request.port.unwrap_or(0);
        let listener = bind_listener(&bind_host, port)?;
        let local_addr = listener
            .local_addr()
            .map_err(|error| AppError::PortForward(format!("无法读取本机代理监听地址: {error}")))?;
        listener.set_nonblocking(true).map_err(|error| {
            AppError::PortForward(format!("无法设置本机代理非阻塞监听: {error}"))
        })?;
        let listener = TcpListener::from_std(listener)
            .map_err(|error| AppError::PortForward(format!("无法创建本机代理异步监听: {error}")))?;

        let entry_id = Uuid::new_v4().to_string();
        let stats = Arc::new(Mutex::new(LocalProxyEntryStats::default()));
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        spawn_entry_listener(entry_id.clone(), listener, shutdown_rx, Arc::clone(&stats));

        let entry = LocalProxyEntry {
            bind_host: bind_host.clone(),
            created_at: unix_timestamp(),
            host_id: request.host_id,
            port: local_addr.port(),
            session_id: request.session_id,
            tag: request.tag,
            shutdown: Some(shutdown_tx),
            stats,
        };
        let summary = entry.to_summary(&self.service_id, &entry_id)?;
        self.entries()?.insert(entry_id, entry);
        Ok(summary)
    }

    /// 释放一个代理入口。最后一个入口释放后，服务对象仍存在但不再监听端口。
    pub fn release_entry(&self, entry_id: &str) -> AppResult<bool> {
        let Some(mut entry) = self.entries()?.remove(entry_id) else {
            return Ok(false);
        };
        if let Some(shutdown) = entry.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(true)
    }

    /// 停止所有代理入口并释放监听端口。
    pub fn stop(&self) -> AppResult<bool> {
        let mut entries = self.entries()?;
        let had_entries = !entries.is_empty();
        for (_, mut entry) in entries.drain() {
            if let Some(shutdown) = entry.shutdown.take() {
                let _ = shutdown.send(());
            }
        }
        Ok(had_entries)
    }

    /// 列出当前代理入口。
    pub fn list_entries(&self) -> AppResult<Vec<LocalProxyEntrySummary>> {
        let entries = self.entries()?;
        let mut summaries = Vec::with_capacity(entries.len());
        for (entry_id, entry) in entries.iter() {
            summaries.push(entry.to_summary(&self.service_id, entry_id)?);
        }
        summaries.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(summaries)
    }

    /// 返回当前单例服务快照。
    pub fn snapshot(&self) -> AppResult<LocalNetworkProxySnapshot> {
        let entries = self.list_entries()?;
        let stats = entries
            .iter()
            .fold(LocalProxyEntryStats::default(), |mut stats, entry| {
                stats.accepted_connections = stats
                    .accepted_connections
                    .saturating_add(entry.stats.accepted_connections);
                stats.active_connections = stats
                    .active_connections
                    .saturating_add(entry.stats.active_connections);
                stats.bytes_from_client = stats
                    .bytes_from_client
                    .saturating_add(entry.stats.bytes_from_client);
                stats.bytes_from_target = stats
                    .bytes_from_target
                    .saturating_add(entry.stats.bytes_from_target);
                stats.last_target = entry.stats.last_target.clone().or(stats.last_target);
                stats.last_error = entry.stats.last_error.clone().or(stats.last_error);
                stats
            });
        Ok(LocalNetworkProxySnapshot {
            service_id: self.service_id.clone(),
            running: !entries.is_empty(),
            entries,
            stats,
        })
    }

    /// 当前活跃 entry 数量。
    pub fn active_entry_count(&self) -> AppResult<usize> {
        Ok(self.entries()?.len())
    }

    fn entries(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, LocalProxyEntry>>> {
        self.entries
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("local network proxy entries"))
    }
}

impl LocalProxyEntry {
    fn to_summary(&self, service_id: &str, entry_id: &str) -> AppResult<LocalProxyEntrySummary> {
        let stats = self
            .stats
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("local network proxy stats"))?
            .clone();
        Ok(LocalProxyEntrySummary {
            bind_host: self.bind_host.clone(),
            created_at: self.created_at.clone(),
            entry_id: entry_id.to_owned(),
            host_id: self.host_id.clone(),
            port: self.port,
            proxy_url: format!("http://{}:{}", self.bind_host, self.port),
            service_id: service_id.to_owned(),
            session_id: self.session_id.clone(),
            tag: self.tag.clone(),
            stats,
        })
    }
}

fn bind_listener(bind_host: &str, port: u16) -> AppResult<std::net::TcpListener> {
    let address = format!("{bind_host}:{port}");
    std::net::TcpListener::bind(&address)
        .map_err(|error| AppError::PortForward(format!("无法监听本机代理地址 {address}: {error}")))
}

fn spawn_entry_listener(
    entry_id: String,
    listener: TcpListener,
    mut shutdown: oneshot::Receiver<()>,
    stats: Arc<Mutex<LocalProxyEntryStats>>,
) {
    let thread_name = format!("kerminal-local-proxy-{entry_id}");
    let _ = thread::Builder::new().name(thread_name).spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                set_last_error(&stats, format!("无法启动本机代理运行时: {error}"));
                return;
            }
        };

        runtime.block_on(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown => {
                        break;
                    }
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, _peer)) => {
                                increment_accepted(&stats);
                                let stats = Arc::clone(&stats);
                                tokio::spawn(async move {
                                    handle_proxy_connection(stream, Arc::clone(&stats)).await;
                                    decrement_active(&stats);
                                });
                            }
                            Err(error) => {
                                set_last_error(&stats, format!("代理入口 {entry_id} 接受连接失败: {error}"));
                                break;
                            }
                        }
                    }
                }
            }
        });
    });
}

async fn handle_proxy_connection(mut client: TcpStream, stats: Arc<Mutex<LocalProxyEntryStats>>) {
    if let Err(error) = proxy_connection(&mut client, Arc::clone(&stats)).await {
        let _ = write_proxy_error_response(&mut client, &error).await;
        set_last_error(&stats, error);
    }
}

async fn proxy_connection(
    client: &mut TcpStream,
    stats: Arc<Mutex<LocalProxyEntryStats>>,
) -> Result<(), String> {
    let request = read_proxy_request(client).await?;
    set_last_target(&stats, request.target.clone());

    let mut target = timeout(
        DEFAULT_CONNECT_TIMEOUT,
        TcpStream::connect(resolve_target_addr(
            &request.target_host,
            request.target_port,
        )?),
    )
    .await
    .map_err(|_| format!("连接目标 {} 超时", request.target))?
    .map_err(|error| format!("连接目标 {} 失败: {error}", request.target))?;

    if request.tunnel {
        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await
            .map_err(|error| format!("写入 CONNECT 响应失败: {error}"))?;
        let (from_client, from_target) = tokio::io::copy_bidirectional(client, &mut target)
            .await
            .map_err(|error| format!("代理数据转发失败: {error}"))?;
        add_bytes(&stats, from_client, from_target);
    } else {
        let rewritten = rewrite_absolute_request(&request)?;
        let from_client = rewritten.len().saturating_add(request.buffered_body.len()) as u64;
        target
            .write_all(rewritten.as_bytes())
            .await
            .map_err(|error| format!("转发 HTTP 请求头失败: {error}"))?;
        if !request.buffered_body.is_empty() {
            target
                .write_all(&request.buffered_body)
                .await
                .map_err(|error| format!("转发 HTTP 请求体失败: {error}"))?;
        }
        target
            .shutdown()
            .await
            .map_err(|error| format!("关闭 HTTP 请求写入失败: {error}"))?;
        let from_target = tokio::io::copy(&mut target, client)
            .await
            .map_err(|error| format!("转发 HTTP 响应失败: {error}"))?;
        add_bytes(&stats, from_client, from_target);
    }
    Ok(())
}

async fn write_proxy_error_response(client: &mut TcpStream, error: &str) -> std::io::Result<()> {
    let (status, reason) = if is_bad_request_error(error) {
        (400, "Bad Request")
    } else {
        (502, "Bad Gateway")
    };
    let body = format!("{error}\n");
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    client.write_all(response.as_bytes()).await
}

fn is_bad_request_error(error: &str) -> bool {
    error.contains("不合法")
        || error.contains("缺少")
        || error.contains("过大")
        || error.contains("提前断开")
        || error.contains("不是有效")
}

async fn read_proxy_request(client: &mut TcpStream) -> Result<ParsedProxyRequest, String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = client
            .read(&mut chunk)
            .await
            .map_err(|error| format!("读取代理请求失败: {error}"))?;
        if read == 0 {
            return Err("代理客户端提前断开".to_owned());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("代理请求头过大".to_owned());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let header_bytes = &buffer[..header_end];
    let buffered_body = buffer[header_end + 4..].to_vec();
    let header_text = std::str::from_utf8(header_bytes)
        .map_err(|_| "代理请求头不是有效 UTF-8/ASCII".to_owned())?
        .to_owned();
    let first_line = header_text
        .lines()
        .next()
        .ok_or_else(|| "代理请求缺少请求行".to_owned())?
        .trim()
        .to_owned();
    parse_proxy_request_line(first_line, header_text, buffered_body)
}

fn parse_proxy_request_line(
    first_line: String,
    header_text: String,
    buffered_body: Vec<u8>,
) -> Result<ParsedProxyRequest, String> {
    let mut parts = first_line.split_whitespace();
    let method = parts.next().ok_or_else(|| "代理请求缺少方法".to_owned())?;
    let target = parts.next().ok_or_else(|| "代理请求缺少目标".to_owned())?;
    let version = parts
        .next()
        .ok_or_else(|| "代理请求缺少 HTTP 版本".to_owned())?;
    if parts.next().is_some() || !version.starts_with("HTTP/") {
        return Err("代理请求行不合法".to_owned());
    }

    if method.eq_ignore_ascii_case("CONNECT") {
        let target = target.to_owned();
        let (target_host, target_port) = parse_host_port(&target, 443)?;
        return Ok(ParsedProxyRequest {
            buffered_body,
            header_text,
            target,
            target_host,
            target_port,
            tunnel: true,
        });
    }

    let url = Url::parse(target).map_err(|error| format!("代理请求目标 URL 不合法: {error}"))?;
    if url.scheme() != "http" {
        return Err("absolute-form 仅支持 http:// 请求，HTTPS 请使用 CONNECT".to_owned());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "代理请求 URL 缺少 host".to_owned())?
        .to_owned();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "代理请求 URL 缺少端口且协议未知".to_owned())?;
    Ok(ParsedProxyRequest {
        buffered_body,
        header_text,
        target: format!("{host}:{port}"),
        target_host: host,
        target_port: port,
        tunnel: false,
    })
}

fn rewrite_absolute_request(request: &ParsedProxyRequest) -> Result<String, String> {
    let mut lines = request.header_text.split("\r\n");
    let first_line = lines
        .next()
        .ok_or_else(|| "代理请求缺少请求行".to_owned())?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().ok_or_else(|| "代理请求缺少方法".to_owned())?;
    let target = parts.next().ok_or_else(|| "代理请求缺少目标".to_owned())?;
    let version = parts
        .next()
        .ok_or_else(|| "代理请求缺少 HTTP 版本".to_owned())?;
    let url = Url::parse(target).map_err(|error| format!("代理请求目标 URL 不合法: {error}"))?;
    let path = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None if url.path().is_empty() => "/".to_owned(),
        None => url.path().to_owned(),
    };
    let mut rewritten = format!("{method} {path} {version}\r\n");
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if line
            .split_once(':')
            .is_some_and(|(name, _)| name.eq_ignore_ascii_case("Proxy-Connection"))
        {
            continue;
        }
        rewritten.push_str(line);
        rewritten.push_str("\r\n");
    }
    rewritten.push_str("\r\n");
    Ok(rewritten)
}

fn parse_host_port(target: &str, default_port: u16) -> Result<(String, u16), String> {
    let (host, port) = match target.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() => {
            let parsed_port = port
                .parse::<u16>()
                .map_err(|_| format!("目标端口不合法: {target}"))?;
            (host.to_owned(), parsed_port)
        }
        _ => (target.to_owned(), default_port),
    };
    let host = normalize_host(&host, "代理目标地址").map_err(|error| error.to_string())?;
    Ok((host, port))
}

fn resolve_target_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let address = format!("{host}:{port}");
    address
        .to_socket_addrs()
        .map_err(|error| format!("解析目标地址 {address} 失败: {error}"))?
        .next()
        .ok_or_else(|| format!("目标地址不可达: {address}"))
}

fn normalize_host(value: &str, label: &str) -> AppResult<String> {
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

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn increment_accepted(stats: &Arc<Mutex<LocalProxyEntryStats>>) {
    if let Ok(mut stats) = stats.lock() {
        stats.accepted_connections = stats.accepted_connections.saturating_add(1);
        stats.active_connections = stats.active_connections.saturating_add(1);
    }
}

fn decrement_active(stats: &Arc<Mutex<LocalProxyEntryStats>>) {
    if let Ok(mut stats) = stats.lock() {
        stats.active_connections = stats.active_connections.saturating_sub(1);
    }
}

fn add_bytes(stats: &Arc<Mutex<LocalProxyEntryStats>>, from_client: u64, from_target: u64) {
    if let Ok(mut stats) = stats.lock() {
        stats.bytes_from_client = stats.bytes_from_client.saturating_add(from_client);
        stats.bytes_from_target = stats.bytes_from_target.saturating_add(from_target);
        stats.last_error = None;
    }
}

fn set_last_target(stats: &Arc<Mutex<LocalProxyEntryStats>>, target: String) {
    if let Ok(mut stats) = stats.lock() {
        stats.last_target = Some(target);
    }
}

fn set_last_error(stats: &Arc<Mutex<LocalProxyEntryStats>>, error: String) {
    if let Ok(mut stats) = stats.lock() {
        stats.last_error = Some(error);
    }
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}
