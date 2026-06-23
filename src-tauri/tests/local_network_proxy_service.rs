//! 本机网络代理服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    services::local_network_proxy_service::{
        LocalNetworkProxyService, LocalProxyEntryRequest, LocalProxyEntrySummary,
    },
};
use std::{net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    task::JoinHandle,
    time::timeout,
};

#[tokio::test]
async fn connect_tunnel_forwards_to_local_http_service() {
    let upstream = TestHttpServer::start().await;
    let service = LocalNetworkProxyService::new();
    let entry = service
        .acquire_entry(entry_request("host-a", "session-a"))
        .expect("start proxy entry");

    let mut client = connect_to_entry(&entry).await;
    let connect_request = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n",
        upstream.addr.ip(),
        upstream.addr.port(),
        upstream.addr.ip(),
        upstream.addr.port()
    );
    client
        .write_all(connect_request.as_bytes())
        .await
        .expect("send connect request");
    let connect_response = read_until_header_end(&mut client).await;
    assert!(
        String::from_utf8_lossy(&connect_response).starts_with("HTTP/1.1 200"),
        "unexpected CONNECT response: {}",
        String::from_utf8_lossy(&connect_response)
    );

    client
        .write_all(b"GET /via-connect HTTP/1.1\r\nHost: local.test\r\nConnection: close\r\n\r\n")
        .await
        .expect("send tunneled request");
    client
        .shutdown()
        .await
        .expect("shutdown tunneled write side");
    let response = read_to_end(&mut client).await;
    let response_text = String::from_utf8_lossy(&response);
    assert!(response_text.contains("HTTP/1.1 200 OK"));
    assert!(response_text.contains("path=/via-connect"));

    let snapshot = service.snapshot().expect("snapshot");
    let entry_snapshot = snapshot
        .entries
        .iter()
        .find(|snapshot| snapshot.entry_id == entry.entry_id)
        .expect("entry stats");
    assert_eq!(entry_snapshot.stats.accepted_connections, 1);
    assert!(entry_snapshot.stats.bytes_from_client > 0);
    assert!(entry_snapshot.stats.bytes_from_target > 0);
    assert_eq!(entry_snapshot.stats.last_error, None);

    assert!(service
        .release_entry(&entry.entry_id)
        .expect("release entry"));
    upstream.stop().await;
}

#[tokio::test]
async fn absolute_form_http_request_is_forwarded() {
    let upstream = TestHttpServer::start().await;
    let service = LocalNetworkProxyService::new();
    let entry = service
        .acquire_entry(entry_request("host-a", "session-a"))
        .expect("start proxy entry");

    let mut client = connect_to_entry(&entry).await;
    let request = format!(
        "GET http://{}:{}/absolute-form?source=proxy HTTP/1.1\r\nHost: ignored.example\r\nProxy-Connection: keep-alive\r\n\r\n",
        upstream.addr.ip(),
        upstream.addr.port()
    );
    client
        .write_all(request.as_bytes())
        .await
        .expect("send absolute-form request");
    client.shutdown().await.expect("shutdown write side");

    let response = read_to_end(&mut client).await;
    let response_text = String::from_utf8_lossy(&response);
    assert!(response_text.contains("HTTP/1.1 200 OK"));
    assert!(response_text.contains("path=/absolute-form?source=proxy"));

    let snapshot = service.snapshot().expect("snapshot");
    assert_eq!(snapshot.stats.accepted_connections, 1);
    assert!(snapshot.stats.bytes_from_client > 0);
    assert!(snapshot.stats.bytes_from_target > 0);

    assert!(service
        .release_entry(&entry.entry_id)
        .expect("release entry"));
    upstream.stop().await;
}

#[tokio::test]
async fn multiple_entries_share_one_service_core() {
    let service = LocalNetworkProxyService::new();
    let first = service
        .acquire_entry(entry_request("host-a", "session-a"))
        .expect("start first entry");
    let second = service
        .acquire_entry(entry_request("host-b", "session-b"))
        .expect("start second entry");

    assert_eq!(first.service_id, second.service_id);
    assert_ne!(first.port, 0);
    assert_ne!(second.port, 0);
    assert_eq!(first.tag.as_deref(), Some("network-assist/http"));
    assert_eq!(second.tag.as_deref(), Some("network-assist/http"));

    let snapshot = service.snapshot().expect("snapshot");
    assert!(snapshot.running);
    assert_eq!(snapshot.service_id, first.service_id);
    assert_eq!(snapshot.entries.len(), 2);

    assert!(service
        .release_entry(&first.entry_id)
        .expect("release first entry"));
    let after_first_release = service.snapshot().expect("snapshot after one release");
    assert!(after_first_release.running);
    assert_eq!(after_first_release.entries.len(), 1);
    assert_eq!(after_first_release.entries[0].entry_id, second.entry_id);

    assert!(service
        .release_entry(&second.entry_id)
        .expect("release second entry"));
    let after_all_release = service.snapshot().expect("snapshot after all release");
    assert!(!after_all_release.running);
    assert!(after_all_release.entries.is_empty());
}

#[tokio::test]
async fn release_entry_stops_listener_and_releases_port() {
    let service = LocalNetworkProxyService::new();
    let entry = service
        .acquire_entry(entry_request("host-a", "session-a"))
        .expect("start proxy entry");
    assert!(service
        .release_entry(&entry.entry_id)
        .expect("release entry"));
    tokio::time::sleep(Duration::from_millis(50)).await;

    let connect_result = timeout(
        Duration::from_millis(500),
        TcpStream::connect((entry.bind_host.as_str(), entry.port)),
    )
    .await;
    assert!(
        !matches!(connect_result, Ok(Ok(_))),
        "released proxy port still accepted connections"
    );
    assert!(!service
        .release_entry(&entry.entry_id)
        .expect("release missing entry"));
}

#[tokio::test]
async fn invalid_bind_and_target_fail_with_friendly_errors() {
    let service = LocalNetworkProxyService::new();
    let invalid_bind_error = service
        .acquire_entry(LocalProxyEntryRequest {
            bind_host: Some("bad host".to_owned()),
            ..entry_request("host-a", "session-a")
        })
        .expect_err("reject invalid bind address");
    assert!(matches!(
        invalid_bind_error,
        AppError::InvalidInput(message) if message.contains("本机代理监听地址不合法")
    ));

    let entry = service
        .acquire_entry(entry_request("host-a", "session-a"))
        .expect("start proxy entry");
    let mut client = connect_to_entry(&entry).await;
    client
        .write_all(b"CONNECT 127.0.0.1:notaport HTTP/1.1\r\nHost: 127.0.0.1:notaport\r\n\r\n")
        .await
        .expect("send invalid target request");
    client.shutdown().await.expect("shutdown write side");

    let response = read_to_end(&mut client).await;
    let response_text = String::from_utf8_lossy(&response);
    assert!(response_text.contains("HTTP/1.1 400 Bad Request"));
    assert!(response_text.contains("目标端口不合法"));

    let snapshot = service.snapshot().expect("snapshot");
    let recent_error = snapshot.entries[0]
        .stats
        .last_error
        .as_deref()
        .expect("recent error");
    assert!(recent_error.contains("目标端口不合法"));

    assert!(service
        .release_entry(&entry.entry_id)
        .expect("release entry"));
}

fn entry_request(host_id: &str, session_id: &str) -> LocalProxyEntryRequest {
    LocalProxyEntryRequest {
        host_id: host_id.to_owned(),
        session_id: session_id.to_owned(),
        tag: Some("network-assist/http".to_owned()),
        bind_host: None,
        port: None,
    }
}

async fn connect_to_entry(entry: &LocalProxyEntrySummary) -> TcpStream {
    TcpStream::connect((entry.bind_host.as_str(), entry.port))
        .await
        .expect("connect to proxy")
}

async fn read_until_header_end(stream: &mut TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    let mut chunk = [0_u8; 512];
    let result = timeout(Duration::from_secs(3), async {
        loop {
            let read_count = stream.read(&mut chunk).await.expect("read response");
            assert!(read_count > 0, "stream closed before header end");
            response.extend_from_slice(&chunk[..read_count]);
            if response.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
    })
    .await;
    result.expect("timed out reading response header");
    response
}

async fn read_to_end(stream: &mut TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    timeout(Duration::from_secs(3), stream.read_to_end(&mut response))
        .await
        .expect("timed out reading response")
        .expect("read response");
    response
}

struct TestHttpServer {
    addr: SocketAddr,
    shutdown_tx: Option<oneshot::Sender<()>>,
    join_handle: Option<JoinHandle<()>>,
}

impl TestHttpServer {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test http server");
        let addr = listener.local_addr().expect("read test server addr");
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        let join_handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        break;
                    }
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((stream, _peer)) => {
                                tokio::spawn(handle_test_http_connection(stream));
                            }
                            Err(_) => {
                                break;
                            }
                        }
                    }
                }
            }
        });

        Self {
            addr,
            shutdown_tx: Some(shutdown_tx),
            join_handle: Some(join_handle),
        }
    }

    async fn stop(mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        if let Some(join_handle) = self.join_handle.take() {
            join_handle.await.expect("join test server");
        }
    }
}

async fn handle_test_http_connection(mut stream: TcpStream) {
    let mut request = Vec::new();
    let mut chunk = [0_u8; 512];
    loop {
        let read_count = stream.read(&mut chunk).await.expect("read test request");
        if read_count == 0 {
            return;
        }
        request.extend_from_slice(&chunk[..read_count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    let request_text = String::from_utf8_lossy(&request);
    let request_line = request_text.lines().next().unwrap_or("GET / HTTP/1.1");
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let body = format!("method=GET;path={path}");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .expect("write test response");
    let _ = stream.shutdown().await;
}
