use russh::{client, Channel};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::{
    error::{AppError, AppResult},
    services::ssh_command_service::native::NativeRemoteForwardTarget,
};

const SOCKS5_SUCCESS_REPLY: &[u8] = &[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
const SOCKS5_GENERAL_FAILURE_REPLY: &[u8] = &[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0];

pub(super) async fn proxy_forwarded_tcpip_to_target(
    channel: Channel<client::Msg>,
    target: NativeRemoteForwardTarget,
) -> AppResult<(u64, u64)> {
    match target {
        NativeRemoteForwardTarget::Local { host, port } => {
            proxy_forwarded_tcpip_to_local_target(channel, host, port).await
        }
        NativeRemoteForwardTarget::Socks5LocalDynamic => {
            proxy_forwarded_tcpip_to_local_socks_target(channel).await
        }
    }
}

async fn proxy_forwarded_tcpip_to_local_target(
    channel: Channel<client::Msg>,
    host: String,
    port: u16,
) -> AppResult<(u64, u64)> {
    let mut local_stream = tokio::net::TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法连接 forwarded-tcpip 本机目标 {}:{}: {error}",
                host, port
            ))
        })?;
    let mut channel_stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut channel_stream, &mut local_stream)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "forwarded-tcpip 数据转发失败 {}:{}: {error}",
                host, port
            ))
        })
}

async fn proxy_forwarded_tcpip_to_local_socks_target(
    channel: Channel<client::Msg>,
) -> AppResult<(u64, u64)> {
    let mut channel_stream = channel.into_stream();
    let request = match read_socks5_connect_request(&mut channel_stream).await {
        Ok(request) => request,
        Err(error) => {
            let _ = channel_stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
            return Err(error);
        }
    };
    let mut local_stream =
        match tokio::net::TcpStream::connect((request.target_host.as_str(), request.target_port))
            .await
        {
            Ok(stream) => stream,
            Err(error) => {
                let _ = channel_stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
                return Err(AppError::SshCommand(format!(
                    "无法连接 remote dynamic SOCKS5 本机目标 {}:{}: {error}",
                    request.target_host, request.target_port
                )));
            }
        };
    channel_stream
        .write_all(SOCKS5_SUCCESS_REPLY)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!("SOCKS5 remote dynamic 成功响应写入失败: {error}"))
        })?;
    tokio::io::copy_bidirectional(&mut channel_stream, &mut local_stream)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "remote dynamic SOCKS5 数据转发失败 {}:{}: {error}",
                request.target_host, request.target_port
            ))
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Socks5ConnectRequest {
    target_host: String,
    target_port: u16,
}

async fn read_socks5_connect_request<S>(stream: &mut S) -> AppResult<Socks5ConnectRequest>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut greeting = [0_u8; 2];
    stream
        .read_exact(&mut greeting)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 握手读取失败: {error}")))?;
    if greeting[0] != 0x05 {
        return Err(AppError::SshCommand("只支持 SOCKS5 协议".to_owned()));
    }
    let method_count = usize::from(greeting[1]);
    let mut methods = vec![0_u8; method_count];
    stream
        .read_exact(&mut methods)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 认证方法读取失败: {error}")))?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await.map_err(|error| {
            AppError::SshCommand(format!("SOCKS5 认证拒绝响应写入失败: {error}"))
        })?;
        return Err(AppError::SshCommand(
            "SOCKS5 客户端未提供 no-auth 方法".to_owned(),
        ));
    }
    stream
        .write_all(&[0x05, 0x00])
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 认证响应写入失败: {error}")))?;

    let mut header = [0_u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 CONNECT 请求读取失败: {error}")))?;
    if header[0] != 0x05 {
        return Err(AppError::SshCommand(
            "SOCKS5 CONNECT 请求版本无效".to_owned(),
        ));
    }
    if header[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await
            .map_err(|error| AppError::SshCommand(format!("SOCKS5 拒绝响应写入失败: {error}")))?;
        return Err(AppError::SshCommand(
            "SOCKS5 只支持 CONNECT 命令".to_owned(),
        ));
    }
    let target_host = match header[3] {
        0x01 => {
            let mut octets = [0_u8; 4];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::SshCommand(format!("SOCKS5 IPv4 地址读取失败: {error}"))
            })?;
            std::net::Ipv4Addr::from(octets).to_string()
        }
        0x03 => {
            let mut length = [0_u8; 1];
            stream.read_exact(&mut length).await.map_err(|error| {
                AppError::SshCommand(format!("SOCKS5 域名长度读取失败: {error}"))
            })?;
            let mut domain = vec![0_u8; usize::from(length[0])];
            stream
                .read_exact(&mut domain)
                .await
                .map_err(|error| AppError::SshCommand(format!("SOCKS5 域名读取失败: {error}")))?;
            String::from_utf8(domain)
                .map_err(|_| AppError::SshCommand("SOCKS5 域名不是有效 UTF-8".to_owned()))?
        }
        0x04 => {
            let mut octets = [0_u8; 16];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::SshCommand(format!("SOCKS5 IPv6 地址读取失败: {error}"))
            })?;
            std::net::Ipv6Addr::from(octets).to_string()
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(|error| {
                    AppError::SshCommand(format!("SOCKS5 地址类型拒绝响应写入失败: {error}"))
                })?;
            return Err(AppError::SshCommand(
                "SOCKS5 CONNECT 地址类型不支持".to_owned(),
            ));
        }
    };
    let mut port_bytes = [0_u8; 2];
    stream
        .read_exact(&mut port_bytes)
        .await
        .map_err(|error| AppError::SshCommand(format!("SOCKS5 目标端口读取失败: {error}")))?;
    let target_port = u16::from_be_bytes(port_bytes);
    if target_port == 0 {
        return Err(AppError::SshCommand(
            "SOCKS5 CONNECT 目标端口必须大于 0".to_owned(),
        ));
    }
    Ok(Socks5ConnectRequest {
        target_host,
        target_port,
    })
}
