//! Native russh-backed managed SSH runtime backend.
//!
//! @author kongweiguang

use std::{
    collections::VecDeque,
    io::{ErrorKind, Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, TcpListener as StdTcpListener},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc,
    },
    thread,
    time::Duration,
};

use async_trait::async_trait;
use russh::{client, Channel, ChannelMsg, ChannelReadHalf, ChannelWriteHalf};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc as tokio_mpsc, oneshot, Mutex},
};

use crate::{
    error::{AppError, AppResult},
    services::{
        ssh_command_service::native::{
            build_native_connection_execution_for_known_hosts,
            cancel_remote_tcpip_forward_on_native_connection,
            connect_native_command_target_with_remote_forward_registry,
            disconnect_native_connection_ref, execute_script_on_native_connection,
            open_direct_tcpip_channel_on_native_connection, open_sftp_on_native_connection,
            open_shell_on_native_connection, open_streaming_exec_on_native_connection,
            ping_native_connection_ref, proxy_direct_tcpip_channel_to_stream,
            start_remote_tcpip_forward_on_native_connection, NativeDirectTcpipProxyRequest,
            NativeHostKeyPolicy, NativeRemoteForwardRegistry, NativeRemoteForwardTarget,
            NativeSshCommandExecution, NativeSshConnectionChain,
        },
        ssh_runtime::{
            SshChannelKind, SshRuntimeBackend, SshRuntimeConnectRequest, SshRuntimeConnection,
            SshRuntimeDynamicForwardRequest, SshRuntimeExecRawOutput, SshRuntimeExecRequest,
            SshRuntimeForwardTask, SshRuntimeHostKeyPolicy, SshRuntimeLocalForwardRequest,
            SshRuntimeRemoteDynamicForwardRequest, SshRuntimeRemoteForwardRequest,
            SshRuntimeSftpStream, SshRuntimeShellEvent, SshRuntimeShellRequest,
            SshRuntimeShellSession, SshRuntimeStreamingExecExit, SshRuntimeStreamingExecReader,
            SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
            SshRuntimeStreamingExecWriter,
        },
    },
};

const SOCKS5_SUCCESS_REPLY: &[u8] = &[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
const SOCKS5_GENERAL_FAILURE_REPLY: &[u8] = &[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
const REMOTE_FORWARD_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
const REMOTE_FORWARD_RECONNECT_MIN_MILLIS: u64 = 250;
const REMOTE_FORWARD_RECONNECT_MAX_MILLIS: u64 = 5_000;

#[derive(Clone)]
struct NativeForwardConnectionContext {
    connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    execution: NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
}

struct NativeRemoteForwardRegistration {
    bind_host: String,
    bind_port: u16,
    target: NativeRemoteForwardTarget,
    label: &'static str,
}

#[derive(Debug, Default)]
pub struct NativeSshRuntimeBackend;

impl NativeSshRuntimeBackend {
    pub fn new() -> Self {
        Self
    }
}

impl SshRuntimeBackend for NativeSshRuntimeBackend {
    fn connect(
        &self,
        request: SshRuntimeConnectRequest,
    ) -> AppResult<Arc<dyn SshRuntimeConnection>> {
        let host = request
            .native_host()
            .ok_or_else(|| {
                AppError::SshCommand(
                    "managed SSH native backend requires connection material".to_owned(),
                )
            })?
            .clone();
        let known_hosts_path = request
            .native_known_hosts_path()
            .ok_or_else(|| {
                AppError::SshCommand(
                    "managed SSH native backend requires known_hosts material".to_owned(),
                )
            })?
            .to_path_buf();
        let connect_timeout_seconds = request.native_connect_timeout_seconds().unwrap_or(30);
        let keepalive_interval = request
            .native_keepalive_seconds()
            .filter(|seconds| *seconds > 0)
            .map(Duration::from_secs);
        let execution = build_native_connection_execution_for_known_hosts(
            &host,
            known_hosts_path,
            connect_timeout_seconds,
        )?;
        Ok(Arc::new(NativeSshRuntimeConnection::new(
            execution,
            native_host_key_policy(request.native_host_key_policy()),
            keepalive_interval,
        )))
    }
}

fn native_host_key_policy(policy: Option<SshRuntimeHostKeyPolicy>) -> NativeHostKeyPolicy {
    match policy {
        Some(SshRuntimeHostKeyPolicy::TrustUnknown) => NativeHostKeyPolicy::TrustUnknown,
        Some(SshRuntimeHostKeyPolicy::RequireKnown) | None => NativeHostKeyPolicy::RequireKnown,
    }
}

struct NativeSshRuntimeConnection {
    channel_sequence: AtomicUsize,
    connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    execution: NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    keepalive_interval: Option<Duration>,
    remote_forwards: NativeRemoteForwardRegistry,
}

impl NativeSshRuntimeConnection {
    fn new(
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        keepalive_interval: Option<Duration>,
    ) -> Self {
        Self {
            channel_sequence: AtomicUsize::new(0),
            connection: Arc::new(Mutex::new(None)),
            execution,
            host_key_policy,
            keepalive_interval,
            remote_forwards: NativeRemoteForwardRegistry::default(),
        }
    }

    async fn connection(&self) -> AppResult<Arc<NativeSshConnectionChain>> {
        native_connection_from_state(
            &self.connection,
            &self.execution,
            self.host_key_policy,
            self.remote_forwards.clone(),
            self.keepalive_interval,
        )
        .await
    }
}

#[async_trait]
impl SshRuntimeConnection for NativeSshRuntimeConnection {
    fn open_channel(&self, kind: SshChannelKind) -> AppResult<String> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(format!("native-russh-{}-{next}", kind.as_str()))
    }

    fn supports_shell(&self) -> bool {
        true
    }

    async fn open_shell(
        &self,
        request: SshRuntimeShellRequest,
    ) -> AppResult<Box<dyn SshRuntimeShellSession>> {
        let connection = self.connection().await?;
        let channel = match open_shell_on_native_connection(&connection, request.clone()).await {
            Ok(channel) => channel,
            Err(error) => {
                if !should_clear_native_connection_after_channel_error(&error) {
                    return Err(error);
                }
                let reason = format!("managed SSH shell channel failed: {error}");
                clear_native_connection_if_current(&self.connection, &connection, &reason).await;
                let retry_connection = self.connection().await?;
                open_shell_on_native_connection(&retry_connection, request).await?
            }
        };
        Ok(Box::new(NativeSshShellSession::new(channel)))
    }

    fn supports_exec(&self) -> bool {
        true
    }

    async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecRawOutput> {
        let connection = self.connection().await?;
        let result = execute_script_on_native_connection(
            &connection,
            request.script,
            request.max_output_bytes.saturating_add(1),
        )
        .await;
        if let Err(error) = &result {
            if !should_clear_native_connection_after_channel_error(error) {
                return result;
            }
            clear_native_connection_if_current(
                &self.connection,
                &connection,
                &format!("managed SSH exec channel failed: {error}"),
            )
            .await;
        }
        result
    }

    fn supports_streaming_exec(&self) -> bool {
        true
    }

    async fn open_streaming_exec(
        &self,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<Box<dyn SshRuntimeStreamingExecSession>> {
        let command = request.command;
        let connection = self.connection().await?;
        let channel = match open_streaming_exec_on_native_connection(&connection, command.clone())
            .await
        {
            Ok(channel) => channel,
            Err(error) => {
                if !should_clear_native_connection_after_channel_error(&error) {
                    return Err(error);
                }
                let reason = format!("managed SSH streaming exec channel failed: {error}");
                clear_native_connection_if_current(&self.connection, &connection, &reason).await;
                let retry_connection = self.connection().await?;
                open_streaming_exec_on_native_connection(&retry_connection, command).await?
            }
        };
        Ok(Box::new(NativeStreamingExecSession::new(channel)))
    }

    fn supports_sftp(&self) -> bool {
        true
    }

    async fn open_sftp(&self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        let connection = self.connection().await?;
        match open_sftp_on_native_connection(&connection).await {
            Ok(stream) => Ok(stream),
            Err(error) => {
                if !should_clear_native_connection_after_channel_error(&error) {
                    return Err(error);
                }
                let reason = format!("managed SSH SFTP channel failed: {error}");
                clear_native_connection_if_current(&self.connection, &connection, &reason).await;
                let retry_connection = self.connection().await?;
                open_sftp_on_native_connection(&retry_connection).await
            }
        }
    }

    fn supports_local_forward(&self) -> bool {
        true
    }

    fn start_local_forward(
        &self,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeLocalForwardTask::start(
            format!("native-russh-local-forward-{next}"),
            Arc::clone(&self.connection),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn supports_dynamic_forward(&self) -> bool {
        true
    }

    fn start_dynamic_forward(
        &self,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeDynamicForwardTask::start(
            format!("native-russh-dynamic-forward-{next}"),
            Arc::clone(&self.connection),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn supports_remote_forward(&self) -> bool {
        true
    }

    fn start_remote_forward(
        &self,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeRemoteForwardTask::start(
            format!("native-russh-remote-forward-{next}"),
            Arc::clone(&self.connection),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn supports_remote_dynamic_forward(&self) -> bool {
        true
    }

    fn start_remote_dynamic_forward(
        &self,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<Box<dyn SshRuntimeForwardTask>> {
        let next = self.channel_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let task = NativeRemoteForwardTask::start_dynamic(
            format!("native-russh-remote-dynamic-forward-{next}"),
            Arc::clone(&self.connection),
            self.execution.clone(),
            self.host_key_policy,
            self.remote_forwards.clone(),
            request,
        )?;
        Ok(Box::new(task))
    }

    fn disconnect(&self, reason: &str) {
        let reason = reason.to_owned();
        let connection = Arc::clone(&self.connection);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let mut guard = connection.lock().await;
                if let Some(connection) = guard.take() {
                    disconnect_native_connection_ref(&connection, &reason).await;
                }
            });
        }
    }
}

#[derive(Debug)]
struct NativeSshShellSession {
    reader: Mutex<ChannelReadHalf>,
    writer: ChannelWriteHalf<client::Msg>,
}

impl NativeSshShellSession {
    fn new(channel: Channel<client::Msg>) -> Self {
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

#[derive(Debug)]
struct NativeStreamingExecSession {
    exit_status: Receiver<AppResult<SshRuntimeStreamingExecExit>>,
    kill: Option<oneshot::Sender<()>>,
    stderr: Option<NativeStreamingExecReader>,
    stdin: Option<NativeStreamingExecWriter>,
    stdout: Option<NativeStreamingExecReader>,
}

impl NativeStreamingExecSession {
    fn new(channel: Channel<client::Msg>) -> Self {
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
    fn new(receiver: tokio_mpsc::Receiver<Vec<u8>>) -> Self {
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
    fn new(sender: tokio_mpsc::Sender<Vec<u8>>) -> Self {
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

#[derive(Debug)]
struct NativeLocalForwardTask {
    id: String,
    shutdown: Option<oneshot::Sender<()>>,
    status: Receiver<String>,
    worker: Option<thread::JoinHandle<()>>,
}

impl NativeLocalForwardTask {
    fn start(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<Self> {
        let listener = bind_local_forward_listener(&request)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (status_tx, status_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread_name = format!("kerminal-ssh-forward-{id}");
        let context = NativeForwardConnectionContext {
            connection,
            execution,
            host_key_policy,
            remote_forwards,
        };
        let worker = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let status = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(run_local_forward_listener(
                        listener,
                        shutdown_rx,
                        context,
                        request,
                        ready_tx,
                    )),
                    Err(error) => {
                        let status = format!("无法启动受管 SSH local forward 运行时: {error}");
                        let _ = ready_tx.send(Err(status.clone()));
                        status
                    }
                };
                let _ = status_tx.send(status);
            })
            .map_err(|error| {
                AppError::PortForward(format!("无法启动受管 SSH local forward 线程: {error}"))
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                id,
                shutdown: Some(shutdown_tx),
                status: status_rx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(format!(
                    "受管 SSH local forward 启动确认超时: {error}"
                )))
            }
        }
    }
}

impl SshRuntimeForwardTask for NativeLocalForwardTask {
    fn id(&self) -> Option<String> {
        Some(self.id.clone())
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self.status.try_recv() {
            Ok(status) => Ok(Some(status)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => {
                Ok(Some("受管 SSH local forward 线程已结束".to_owned()))
            }
        }
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(())
    }

    fn wait(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn bind_local_forward_listener(
    request: &SshRuntimeLocalForwardRequest,
) -> AppResult<StdTcpListener> {
    let address = format!("{}:{}", request.bind_host, request.bind_port);
    let listener = StdTcpListener::bind(&address).map_err(|error| {
        AppError::PortForward(format!("无法监听本地端口转发 {address}: {error}"))
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        AppError::PortForward(format!("无法设置本地端口转发非阻塞监听 {address}: {error}"))
    })?;
    Ok(listener)
}

async fn run_local_forward_listener(
    listener: StdTcpListener,
    mut shutdown: oneshot::Receiver<()>,
    context: NativeForwardConnectionContext,
    request: SshRuntimeLocalForwardRequest,
    ready: mpsc::Sender<Result<(), String>>,
) -> String {
    let listener = match TcpListener::from_std(listener) {
        Ok(listener) => listener,
        Err(error) => {
            let status = format!("无法创建受管 SSH local forward listener: {error}");
            let _ = ready.send(Err(status.clone()));
            return status;
        }
    };
    let _ = ready.send(Ok(()));
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                return "受管 SSH local forward 已停止".to_owned();
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer_addr)) => {
                            let context = context.clone();
                            let request = request.clone();
                            tokio::spawn(async move {
                            let originator_host = peer_addr.ip().to_string();
                            let originator_port = peer_addr.port();
                            let _ = proxy_local_forward_connection(
                                context,
                                request,
                                stream,
                                originator_host,
                                originator_port,
                            ).await;
                        });
                    }
                    Err(error) if is_recoverable_listener_accept_error(&error) => {
                        continue;
                    }
                    Err(error) => {
                        return format!("受管 SSH local forward 接受连接失败: {error}");
                    }
                }
            }
        }
    }
}

async fn proxy_local_forward_connection(
    context: NativeForwardConnectionContext,
    request: SshRuntimeLocalForwardRequest,
    stream: TcpStream,
    originator_host: String,
    originator_port: u16,
) -> AppResult<(u64, u64)> {
    let proxy_request = NativeDirectTcpipProxyRequest {
        target_host: request.target_host,
        target_port: request.target_port,
        originator_host,
        originator_port,
    };
    let (connection, channel) =
        open_direct_tcpip_channel_with_reconnect(&context, &proxy_request).await?;
    let result = proxy_direct_tcpip_channel_to_stream(
        channel,
        stream,
        &proxy_request.target_host,
        proxy_request.target_port,
    )
    .await;
    if let Err(error) = &result {
        if should_clear_native_connection_after_channel_error(error) {
            clear_native_connection_if_current(
                &context.connection,
                &connection,
                &format!("managed SSH local forward direct-tcpip failed: {error}"),
            )
            .await;
        }
    }
    result
}

#[derive(Debug)]
struct NativeDynamicForwardTask {
    id: String,
    shutdown: Option<oneshot::Sender<()>>,
    status: Receiver<String>,
    worker: Option<thread::JoinHandle<()>>,
}

impl NativeDynamicForwardTask {
    fn start(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<Self> {
        let listener = bind_dynamic_forward_listener(&request)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (status_tx, status_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread_name = format!("kerminal-ssh-forward-{id}");
        let context = NativeForwardConnectionContext {
            connection,
            execution,
            host_key_policy,
            remote_forwards,
        };
        let worker = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let status = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(run_dynamic_forward_listener(
                        listener,
                        shutdown_rx,
                        context,
                        ready_tx,
                    )),
                    Err(error) => {
                        let status = format!("无法启动受管 SSH dynamic forward 运行时: {error}");
                        let _ = ready_tx.send(Err(status.clone()));
                        status
                    }
                };
                let _ = status_tx.send(status);
            })
            .map_err(|error| {
                AppError::PortForward(format!("无法启动受管 SSH dynamic forward 线程: {error}"))
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                id,
                shutdown: Some(shutdown_tx),
                status: status_rx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(format!(
                    "受管 SSH dynamic forward 启动确认超时: {error}"
                )))
            }
        }
    }
}

impl SshRuntimeForwardTask for NativeDynamicForwardTask {
    fn id(&self) -> Option<String> {
        Some(self.id.clone())
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self.status.try_recv() {
            Ok(status) => Ok(Some(status)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => {
                Ok(Some("受管 SSH dynamic forward 线程已结束".to_owned()))
            }
        }
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(())
    }

    fn wait(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn bind_dynamic_forward_listener(
    request: &SshRuntimeDynamicForwardRequest,
) -> AppResult<StdTcpListener> {
    let address = format!("{}:{}", request.bind_host, request.bind_port);
    let listener = StdTcpListener::bind(&address).map_err(|error| {
        AppError::PortForward(format!("无法监听本地 SOCKS 转发 {address}: {error}"))
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        AppError::PortForward(format!(
            "无法设置本地 SOCKS 转发非阻塞监听 {address}: {error}"
        ))
    })?;
    Ok(listener)
}

async fn run_dynamic_forward_listener(
    listener: StdTcpListener,
    mut shutdown: oneshot::Receiver<()>,
    context: NativeForwardConnectionContext,
    ready: mpsc::Sender<Result<(), String>>,
) -> String {
    let listener = match TcpListener::from_std(listener) {
        Ok(listener) => listener,
        Err(error) => {
            let status = format!("无法创建受管 SSH dynamic forward listener: {error}");
            let _ = ready.send(Err(status.clone()));
            return status;
        }
    };
    let _ = ready.send(Ok(()));
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                return "受管 SSH dynamic forward 已停止".to_owned();
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer_addr)) => {
                        let context = context.clone();
                        tokio::spawn(async move {
                            let originator_host = peer_addr.ip().to_string();
                            let originator_port = peer_addr.port();
                            let _ = proxy_dynamic_forward_connection(
                                context,
                                stream,
                                originator_host,
                                originator_port,
                            ).await;
                        });
                    }
                    Err(error) if is_recoverable_listener_accept_error(&error) => {
                        continue;
                    }
                    Err(error) => {
                        return format!("受管 SSH dynamic forward 接受连接失败: {error}");
                    }
                }
            }
        }
    }
}

fn is_recoverable_listener_accept_error(error: &std::io::Error) -> bool {
    matches!(error.kind(), ErrorKind::Interrupted | ErrorKind::WouldBlock)
}

async fn proxy_dynamic_forward_connection(
    context: NativeForwardConnectionContext,
    mut stream: TcpStream,
    originator_host: String,
    originator_port: u16,
) -> AppResult<(u64, u64)> {
    let request = match read_socks5_connect_request(&mut stream).await {
        Ok(request) => request,
        Err(error) => {
            let _ = stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
            return Err(error);
        }
    };
    let proxy_request = NativeDirectTcpipProxyRequest {
        target_host: request.target_host,
        target_port: request.target_port,
        originator_host,
        originator_port,
    };
    let (connection, channel) =
        match open_direct_tcpip_channel_with_reconnect(&context, &proxy_request).await {
            Ok(opened) => opened,
            Err(error) => {
                let _ = stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
                return Err(error);
            }
        };
    stream
        .write_all(SOCKS5_SUCCESS_REPLY)
        .await
        .map_err(|error| {
            AppError::PortForward(format!("SOCKS5 CONNECT 成功响应写入失败: {error}"))
        })?;
    let result = proxy_direct_tcpip_channel_to_stream(
        channel,
        stream,
        &proxy_request.target_host,
        proxy_request.target_port,
    )
    .await;
    if let Err(error) = &result {
        if should_clear_native_connection_after_proxy_error(error) {
            clear_native_connection_if_current(
                &context.connection,
                &connection,
                &format!("managed SSH dynamic forward direct-tcpip failed: {error}"),
            )
            .await;
        }
    }
    result
}

async fn open_direct_tcpip_channel_with_reconnect(
    context: &NativeForwardConnectionContext,
    request: &NativeDirectTcpipProxyRequest,
) -> AppResult<(Arc<NativeSshConnectionChain>, Channel<client::Msg>)> {
    let connection = native_connection_from_state(
        &context.connection,
        &context.execution,
        context.host_key_policy,
        context.remote_forwards.clone(),
        None,
    )
    .await?;
    match open_direct_tcpip_channel_on_native_connection(&connection, request).await {
        Ok(channel) => return Ok((connection, channel)),
        Err(error) if should_clear_native_connection_after_channel_error(&error) => {
            clear_native_connection_if_current(
                &context.connection,
                &connection,
                &format!("managed SSH forward direct-tcpip open failed: {error}"),
            )
            .await;
        }
        Err(error) => return Err(error),
    }
    let retry_connection = native_connection_from_state(
        &context.connection,
        &context.execution,
        context.host_key_policy,
        context.remote_forwards.clone(),
        None,
    )
    .await?;
    let retry_channel =
        open_direct_tcpip_channel_on_native_connection(&retry_connection, request).await?;
    Ok((retry_connection, retry_channel))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Socks5ConnectRequest {
    target_host: String,
    target_port: u16,
}

async fn read_socks5_connect_request(stream: &mut TcpStream) -> AppResult<Socks5ConnectRequest> {
    let mut greeting = [0_u8; 2];
    stream
        .read_exact(&mut greeting)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 握手读取失败: {error}")))?;
    if greeting[0] != 0x05 {
        return Err(AppError::PortForward("只支持 SOCKS5 协议".to_owned()));
    }
    let method_count = usize::from(greeting[1]);
    let mut methods = vec![0_u8; method_count];
    stream
        .read_exact(&mut methods)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 认证方法读取失败: {error}")))?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await.map_err(|error| {
            AppError::PortForward(format!("SOCKS5 认证拒绝响应写入失败: {error}"))
        })?;
        return Err(AppError::PortForward(
            "SOCKS5 客户端未提供 no-auth 方法".to_owned(),
        ));
    }
    stream
        .write_all(&[0x05, 0x00])
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 认证响应写入失败: {error}")))?;

    let mut header = [0_u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 CONNECT 请求读取失败: {error}")))?;
    if header[0] != 0x05 {
        return Err(AppError::PortForward(
            "SOCKS5 CONNECT 请求版本无效".to_owned(),
        ));
    }
    if header[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await
            .map_err(|error| AppError::PortForward(format!("SOCKS5 拒绝响应写入失败: {error}")))?;
        return Err(AppError::PortForward(
            "SOCKS5 只支持 CONNECT 命令".to_owned(),
        ));
    }
    let target_host = match header[3] {
        0x01 => {
            let mut octets = [0_u8; 4];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::PortForward(format!("SOCKS5 IPv4 地址读取失败: {error}"))
            })?;
            IpAddr::V4(Ipv4Addr::from(octets)).to_string()
        }
        0x03 => {
            let mut length = [0_u8; 1];
            stream.read_exact(&mut length).await.map_err(|error| {
                AppError::PortForward(format!("SOCKS5 域名长度读取失败: {error}"))
            })?;
            let mut domain = vec![0_u8; usize::from(length[0])];
            stream
                .read_exact(&mut domain)
                .await
                .map_err(|error| AppError::PortForward(format!("SOCKS5 域名读取失败: {error}")))?;
            String::from_utf8(domain)
                .map_err(|_| AppError::PortForward("SOCKS5 域名不是有效 UTF-8".to_owned()))?
        }
        0x04 => {
            let mut octets = [0_u8; 16];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::PortForward(format!("SOCKS5 IPv6 地址读取失败: {error}"))
            })?;
            IpAddr::V6(Ipv6Addr::from(octets)).to_string()
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(|error| {
                    AppError::PortForward(format!("SOCKS5 地址类型拒绝响应写入失败: {error}"))
                })?;
            return Err(AppError::PortForward(
                "SOCKS5 CONNECT 地址类型不支持".to_owned(),
            ));
        }
    };
    let mut port_bytes = [0_u8; 2];
    stream
        .read_exact(&mut port_bytes)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 目标端口读取失败: {error}")))?;
    let target_port = u16::from_be_bytes(port_bytes);
    if target_port == 0 {
        return Err(AppError::PortForward(
            "SOCKS5 CONNECT 目标端口必须大于 0".to_owned(),
        ));
    }
    Ok(Socks5ConnectRequest {
        target_host,
        target_port,
    })
}

#[derive(Debug)]
struct NativeRemoteForwardTask {
    id: String,
    shutdown: Option<oneshot::Sender<()>>,
    status: Receiver<String>,
    worker: Option<thread::JoinHandle<()>>,
}

impl NativeRemoteForwardTask {
    fn start(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<Self> {
        Self::start_registered(
            id,
            NativeForwardConnectionContext {
                connection,
                execution,
                host_key_policy,
                remote_forwards,
            },
            NativeRemoteForwardRegistration {
                bind_host: request.bind_host,
                bind_port: request.bind_port,
                target: NativeRemoteForwardTarget::new(request.target_host, request.target_port),
                label: "remote forward",
            },
        )
    }

    fn start_dynamic(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<Self> {
        Self::start_registered(
            id,
            NativeForwardConnectionContext {
                connection,
                execution,
                host_key_policy,
                remote_forwards,
            },
            NativeRemoteForwardRegistration {
                bind_host: request.bind_host,
                bind_port: request.bind_port,
                target: NativeRemoteForwardTarget::socks5_local_dynamic(),
                label: "remote dynamic forward",
            },
        )
    }

    fn start_registered(
        id: String,
        context: NativeForwardConnectionContext,
        registration: NativeRemoteForwardRegistration,
    ) -> AppResult<Self> {
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (status_tx, status_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread_name = format!("kerminal-ssh-forward-{id}");
        let label = registration.label;
        let worker = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let status = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(run_remote_forward_listener(
                        shutdown_rx,
                        context,
                        registration,
                        ready_tx,
                    )),
                    Err(error) => {
                        let status = format!("无法启动受管 SSH {label} 运行时: {error}");
                        let _ = ready_tx.send(Err(status.clone()));
                        status
                    }
                };
                let _ = status_tx.send(status);
            })
            .map_err(|error| {
                AppError::PortForward(format!("无法启动受管 SSH {label} 线程: {error}"))
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                id,
                shutdown: Some(shutdown_tx),
                status: status_rx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(format!(
                    "受管 SSH {label} 启动确认超时: {error}"
                )))
            }
        }
    }
}

impl SshRuntimeForwardTask for NativeRemoteForwardTask {
    fn id(&self) -> Option<String> {
        Some(self.id.clone())
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self.status.try_recv() {
            Ok(status) => Ok(Some(status)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => {
                Ok(Some("受管 SSH remote forward 线程已结束".to_owned()))
            }
        }
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(())
    }

    fn wait(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum RemoteForwardMonitorStatus {
    Shutdown,
    ConnectionLost(String),
}

async fn run_remote_forward_listener(
    mut shutdown: oneshot::Receiver<()>,
    context: NativeForwardConnectionContext,
    registration: NativeRemoteForwardRegistration,
    ready: mpsc::Sender<Result<(), String>>,
) -> String {
    let NativeRemoteForwardRegistration {
        bind_host,
        bind_port,
        target,
        label,
    } = registration;
    let mut ready = Some(ready);
    let mut reconnect_attempt = 0_usize;
    loop {
        let active_connection = match native_connection_from_state(
            &context.connection,
            &context.execution,
            context.host_key_policy,
            context.remote_forwards.clone(),
            None,
        )
        .await
        {
            Ok(connection) => connection,
            Err(error) => {
                let status = format!("受管 SSH {label} 连接失败: {error}");
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(status.clone()));
                    return status;
                }
                if wait_for_remote_forward_retry(&mut shutdown, reconnect_attempt).await {
                    return format!("受管 SSH {label} 已停止");
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                continue;
            }
        };
        let registered_port = match start_remote_tcpip_forward_on_native_connection(
            &active_connection,
            bind_host.clone(),
            bind_port,
        )
        .await
        {
            Ok(port) => port,
            Err(error) => {
                let status = format!("受管 SSH {label} 启动失败: {error}");
                if should_clear_native_connection_after_channel_error(&error) {
                    clear_native_connection_if_current(
                        &context.connection,
                        &active_connection,
                        &format!("managed SSH {label} start failed: {error}"),
                    )
                    .await;
                }
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Err(status.clone()));
                    return status;
                }
                if wait_for_remote_forward_retry(&mut shutdown, reconnect_attempt).await {
                    return format!("受管 SSH {label} 已停止");
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                continue;
            }
        };
        if let Err(error) =
            context
                .remote_forwards
                .register(bind_host.clone(), registered_port, target.clone())
        {
            let _ = cancel_remote_tcpip_forward_on_native_connection(
                &active_connection,
                bind_host.clone(),
                registered_port,
            )
            .await;
            let status = format!("受管 SSH {label} registry 写入失败: {error}");
            let _ = ready.take().map(|ready| ready.send(Err(status.clone())));
            return status;
        }
        if let Some(ready) = ready.take() {
            let _ = ready.send(Ok(()));
        }
        reconnect_attempt = 0;

        match monitor_remote_forward_connection(&mut shutdown, &active_connection, label).await {
            RemoteForwardMonitorStatus::Shutdown => {
                context
                    .remote_forwards
                    .unregister(&bind_host, registered_port);
                return match cancel_remote_tcpip_forward_on_native_connection(
                    &active_connection,
                    bind_host,
                    registered_port,
                )
                .await
                {
                    Ok(()) => format!("受管 SSH {label} 已停止"),
                    Err(error) => {
                        if should_clear_native_connection_after_channel_error(&error) {
                            clear_native_connection_if_current(
                                &context.connection,
                                &active_connection,
                                &format!("managed SSH {label} cancel failed: {error}"),
                            )
                            .await;
                        }
                        format!("受管 SSH {label} 取消失败: {error}")
                    }
                };
            }
            RemoteForwardMonitorStatus::ConnectionLost(reason) => {
                context
                    .remote_forwards
                    .unregister(&bind_host, registered_port);
                clear_native_connection_if_current(
                    &context.connection,
                    &active_connection,
                    &reason,
                )
                .await;
                if wait_for_remote_forward_retry(&mut shutdown, reconnect_attempt).await {
                    return format!("受管 SSH {label} 已停止");
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
            }
        }
    }
}

async fn monitor_remote_forward_connection(
    shutdown: &mut oneshot::Receiver<()>,
    connection: &Arc<NativeSshConnectionChain>,
    label: &'static str,
) -> RemoteForwardMonitorStatus {
    loop {
        tokio::select! {
            _ = &mut *shutdown => {
                return RemoteForwardMonitorStatus::Shutdown;
            }
            _ = tokio::time::sleep(REMOTE_FORWARD_KEEPALIVE_INTERVAL) => {
                if let Err(error) = ping_native_connection_ref(connection).await {
                    return RemoteForwardMonitorStatus::ConnectionLost(format!(
                        "managed SSH {label} keepalive failed: {error}"
                    ));
                }
            }
        }
    }
}

async fn wait_for_remote_forward_retry(
    shutdown: &mut oneshot::Receiver<()>,
    attempt: usize,
) -> bool {
    tokio::select! {
        _ = &mut *shutdown => true,
        _ = tokio::time::sleep(remote_forward_reconnect_delay(attempt)) => false,
    }
}

fn remote_forward_reconnect_delay(attempt: usize) -> Duration {
    let multiplier = 1_u64 << attempt.min(4);
    let millis = REMOTE_FORWARD_RECONNECT_MIN_MILLIS
        .saturating_mul(multiplier)
        .min(REMOTE_FORWARD_RECONNECT_MAX_MILLIS);
    Duration::from_millis(millis)
}

async fn native_connection_from_state(
    state: &Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
    keepalive_interval: Option<Duration>,
) -> AppResult<Arc<NativeSshConnectionChain>> {
    let mut guard = state.lock().await;
    if let Some(connection) = guard.as_ref() {
        return Ok(Arc::clone(connection));
    }

    let connection = Arc::new(
        connect_native_command_target_with_remote_forward_registry(
            execution,
            host_key_policy,
            remote_forwards,
        )
        .await?,
    );
    *guard = Some(Arc::clone(&connection));
    if let Some(interval) = keepalive_interval {
        spawn_native_connection_keepalive(Arc::clone(state), Arc::clone(&connection), interval);
    }
    Ok(connection)
}

fn spawn_native_connection_keepalive(
    state: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    connection: Arc<NativeSshConnectionChain>,
    interval: Duration,
) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(interval).await;
            let is_current = {
                let guard = state.lock().await;
                guard
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &connection))
            };
            if !is_current {
                break;
            }
            if let Err(error) = ping_native_connection_ref(&connection).await {
                clear_native_connection_if_current(
                    &state,
                    &connection,
                    &format!("managed SSH keepalive failed: {error}"),
                )
                .await;
                break;
            }
        }
    });
}

async fn clear_native_connection_if_current(
    state: &Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    failed_connection: &Arc<NativeSshConnectionChain>,
    reason: &str,
) {
    let stale_connection = {
        let mut guard = state.lock().await;
        match guard.as_ref() {
            Some(current) if Arc::ptr_eq(current, failed_connection) => guard.take(),
            _ => None,
        }
    };
    if let Some(connection) = stale_connection {
        disconnect_native_connection_ref(&connection, reason).await;
    }
}

pub(crate) fn should_clear_native_connection_after_proxy_error(error: &AppError) -> bool {
    should_clear_native_connection_after_channel_error(error)
}

#[doc(hidden)]
pub fn should_clear_native_connection_after_channel_error(error: &AppError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    [
        "broken pipe",
        "connection reset",
        "connection lost",
        "connection aborted",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}
