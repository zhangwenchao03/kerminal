use async_trait::async_trait;
use russh::{client, Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use tokio::sync::Mutex;

use crate::{
    error::{AppError, AppResult},
    services::ssh_runtime::{SshRuntimeShellEvent, SshRuntimeShellSession},
};

#[derive(Debug)]
pub(super) struct NativeSshShellSession {
    reader: Mutex<ChannelReadHalf>,
    writer: ChannelWriteHalf<client::Msg>,
}

impl NativeSshShellSession {
    pub(super) fn new(channel: Channel<client::Msg>) -> Self {
        let (reader, writer) = channel.split();
        Self {
            reader: Mutex::new(reader),
            writer,
        }
    }
}

#[async_trait]
impl SshRuntimeShellSession for NativeSshShellSession {
    async fn read_event(&self) -> AppResult<SshRuntimeShellEvent> {
        let mut reader = self.reader.lock().await;
        loop {
            let Some(message) = reader.wait().await else {
                return Ok(SshRuntimeShellEvent::Closed);
            };
            match message {
                ChannelMsg::Data { data } => {
                    return Ok(SshRuntimeShellEvent::Data(data.to_vec()));
                }
                ChannelMsg::ExtendedData { data, ext } => {
                    return Ok(SshRuntimeShellEvent::ExtendedData {
                        data: data.to_vec(),
                        ext,
                    });
                }
                ChannelMsg::Eof => return Ok(SshRuntimeShellEvent::Eof),
                ChannelMsg::Close => return Ok(SshRuntimeShellEvent::Closed),
                ChannelMsg::ExitStatus { exit_status } => {
                    return Ok(SshRuntimeShellEvent::ExitStatus(
                        i32::try_from(exit_status).unwrap_or(i32::MAX),
                    ));
                }
                ChannelMsg::ExitSignal {
                    signal_name,
                    error_message,
                    ..
                } => {
                    return Ok(SshRuntimeShellEvent::ExitSignal {
                        error_message,
                        signal_name: format!("{signal_name:?}"),
                    });
                }
                ChannelMsg::Failure => {
                    return Err(AppError::SshCommand(
                        "远端拒绝 SSH shell/pty 请求".to_owned(),
                    ));
                }
                ChannelMsg::Success
                | ChannelMsg::WindowAdjusted { .. }
                | ChannelMsg::Open { .. } => {
                    continue;
                }
                _ => continue,
            }
        }
    }

    async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        if data.is_empty() {
            return Ok(());
        }
        self.writer
            .data_bytes(data)
            .await
            .map_err(|error| native_shell_error("SSH shell 写入失败", error))
    }

    async fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        self.writer
            .window_change(u32::from(cols.max(1)), u32::from(rows.max(1)), 0, 0)
            .await
            .map_err(|error| native_shell_error("SSH shell 调整窗口失败", error))
    }

    async fn close(&self) -> AppResult<()> {
        let _ = self.writer.eof().await;
        self.writer
            .close()
            .await
            .map_err(|error| native_shell_error("SSH shell 关闭失败", error))
    }
}

fn native_shell_error(context: &str, error: impl std::fmt::Display) -> AppError {
    AppError::SshCommand(format!("{context}: {error}"))
}
