use std::{
    collections::VecDeque,
    io::{Read, Write},
    sync::mpsc::{self, Receiver, RecvTimeoutError},
    time::Duration,
};

use russh::{client, Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use tokio::sync::{mpsc as tokio_mpsc, oneshot};

use crate::{
    error::{AppError, AppResult},
    services::ssh_runtime::{
        SshRuntimeStreamingExecExit, SshRuntimeStreamingExecReader, SshRuntimeStreamingExecSession,
        SshRuntimeStreamingExecWriter,
    },
};

#[derive(Debug)]
pub(super) struct NativeStreamingExecSession {
    exit_status: Receiver<AppResult<SshRuntimeStreamingExecExit>>,
    kill: Option<oneshot::Sender<()>>,
    stderr: Option<NativeStreamingExecReader>,
    stdin: Option<NativeStreamingExecWriter>,
    stdout: Option<NativeStreamingExecReader>,
}

impl NativeStreamingExecSession {
    pub(super) fn new(channel: Channel<client::Msg>) -> Self {
        let (reader, writer) = channel.split();
        let (stdin_tx, stdin_rx) = tokio_mpsc::channel::<Vec<u8>>(8);
        let (stdout_tx, stdout_rx) = tokio_mpsc::channel::<Vec<u8>>(8);
        let (stderr_tx, stderr_rx) = tokio_mpsc::channel::<Vec<u8>>(8);
        let (exit_tx, exit_rx) = mpsc::channel();
        let (kill_tx, kill_rx) = oneshot::channel();

        tokio::spawn(run_streaming_exec_stdin(writer, stdin_rx, kill_rx));
        tokio::spawn(run_streaming_exec_reader(
            reader, stdout_tx, stderr_tx, exit_tx,
        ));

        Self {
            exit_status: exit_rx,
            kill: Some(kill_tx),
            stderr: Some(NativeStreamingExecReader::new(stderr_rx)),
            stdin: Some(NativeStreamingExecWriter::new(stdin_tx)),
            stdout: Some(NativeStreamingExecReader::new(stdout_rx)),
        }
    }
}

impl SshRuntimeStreamingExecSession for NativeStreamingExecSession {
    fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        self.stdin
            .take()
            .map(|writer| Box::new(writer) as Box<dyn SshRuntimeStreamingExecWriter>)
            .ok_or_else(|| AppError::SshCommand("streaming exec stdin is already taken".to_owned()))
    }

    fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stdout
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| {
                AppError::SshCommand("streaming exec stdout is already taken".to_owned())
            })
    }

    fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.stderr
            .take()
            .map(|reader| Box::new(reader) as Box<dyn SshRuntimeStreamingExecReader>)
            .ok_or_else(|| {
                AppError::SshCommand("streaming exec stderr is already taken".to_owned())
            })
    }

    fn close_stdin(&mut self) -> AppResult<()> {
        self.stdin = None;
        Ok(())
    }

    fn wait(&mut self, timeout: Duration) -> AppResult<SshRuntimeStreamingExecExit> {
        match self.exit_status.recv_timeout(timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                let _ = self.kill();
                Err(AppError::SshCommand(format!(
                    "远程流式命令执行超时（{} 秒）",
                    timeout.as_secs()
                )))
            }
            Err(RecvTimeoutError::Disconnected) => Err(AppError::SshCommand(
                "远程流式命令状态通道已关闭".to_owned(),
            )),
        }
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(kill) = self.kill.take() {
            let _ = kill.send(());
        }
        self.stdin = None;
        Ok(())
    }
}

#[derive(Debug)]
struct NativeStreamingExecReader {
    buffer: VecDeque<u8>,
    receiver: tokio_mpsc::Receiver<Vec<u8>>,
}

impl NativeStreamingExecReader {
    pub(super) fn new(receiver: tokio_mpsc::Receiver<Vec<u8>>) -> Self {
        Self {
            buffer: VecDeque::new(),
            receiver,
        }
    }
}

impl Read for NativeStreamingExecReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        while self.buffer.is_empty() {
            match self.receiver.blocking_recv() {
                Some(chunk) if !chunk.is_empty() => self.buffer.extend(chunk),
                Some(_) => continue,
                None => return Ok(0),
            }
        }
        let count = output.len().min(self.buffer.len());
        for slot in &mut output[..count] {
            if let Some(byte) = self.buffer.pop_front() {
                *slot = byte;
            }
        }
        Ok(count)
    }
}

#[derive(Debug)]
struct NativeStreamingExecWriter {
    sender: tokio_mpsc::Sender<Vec<u8>>,
}

impl NativeStreamingExecWriter {
    pub(super) fn new(sender: tokio_mpsc::Sender<Vec<u8>>) -> Self {
        Self { sender }
    }
}

impl Write for NativeStreamingExecWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        if input.is_empty() {
            return Ok(0);
        }
        self.sender
            .blocking_send(input.to_vec())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "stdin closed"))?;
        Ok(input.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

async fn run_streaming_exec_stdin(
    writer: ChannelWriteHalf<client::Msg>,
    mut stdin: tokio_mpsc::Receiver<Vec<u8>>,
    mut kill: oneshot::Receiver<()>,
) {
    let writer = writer;
    loop {
        tokio::select! {
            _ = &mut kill => {
                let _ = writer.close().await;
                return;
            }
            chunk = stdin.recv() => {
                match chunk {
                    Some(chunk) => {
                        if writer.data_bytes(chunk).await.is_err() {
                            return;
                        }
                    }
                    None => {
                        let _ = writer.eof().await;
                        return;
                    }
                }
            }
        }
    }
}

async fn run_streaming_exec_reader(
    mut reader: ChannelReadHalf,
    stdout: tokio_mpsc::Sender<Vec<u8>>,
    stderr: tokio_mpsc::Sender<Vec<u8>>,
    exit_status: mpsc::Sender<AppResult<SshRuntimeStreamingExecExit>>,
) {
    let mut exit_code = None;
    let mut exec_request_failed = false;
    while let Some(message) = reader.wait().await {
        match message {
            ChannelMsg::Data { data } if stdout.send(data.to_vec()).await.is_err() => {
                break;
            }
            ChannelMsg::ExtendedData { data, .. } if stderr.send(data.to_vec()).await.is_err() => {
                break;
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).ok();
            }
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                let message = if error_message.trim().is_empty() {
                    format!("remote process terminated by signal: {signal_name:?}\n")
                } else {
                    format!(
                        "{error_message}\nremote process terminated by signal: {signal_name:?}\n"
                    )
                };
                let _ = stderr.send(message.into_bytes()).await;
            }
            ChannelMsg::Failure => {
                exec_request_failed = true;
            }
            ChannelMsg::Close => break,
            ChannelMsg::Success
            | ChannelMsg::WindowAdjusted { .. }
            | ChannelMsg::Open { .. }
            | ChannelMsg::Eof => {}
            _ => {}
        }
    }
    drop(stdout);
    drop(stderr);
    let result = if exec_request_failed {
        Err(AppError::SshCommand("远端拒绝执行流式命令请求".to_owned()))
    } else {
        Ok(SshRuntimeStreamingExecExit { exit_code })
    };
    let _ = exit_status.send(result);
}
