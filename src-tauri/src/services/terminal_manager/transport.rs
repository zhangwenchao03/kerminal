//! TerminalManager 的本地 PTY 与 managed SSH transport 适配器。
//!
//! @author kongweiguang

use super::{
    managed_shell_channel::{
        managed_shell_command_channel, managed_shell_reader_channel, ManagedShellCommand,
        ManagedShellCommandSender, ManagedShellQueueError, ManagedShellReaderMessage,
        ManagedShellReaderSender, QueuedManagedShellCommand,
    },
    TerminalManagedShellRuntime,
};
use crate::{
    error::{AppError, AppResult},
    models::terminal::TerminalSessionStatus,
    services::{
        pty_process_guard::{PtyMasterGuard, PtyProcessGuard},
        ssh_runtime::{ManagedSshShellSession, SshRuntimeShellEvent},
    },
};
use portable_pty::PtySize;
use std::{
    io::{self, Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
};

type WriterHandle = Box<dyn Write + Send>;
pub(super) type SharedWriterHandle = Arc<Mutex<WriterHandle>>;
type SharedPtyMasterHandle = Arc<Mutex<PtyMasterGuard>>;
pub(super) type SharedTerminalTransportHandle = Arc<Mutex<Box<dyn TerminalSessionTransport>>>;

/// 统一终端会话对本地 PTY 与 managed SSH shell 的同步操作契约。
pub(super) trait TerminalSessionTransport: Send {
    fn status(&mut self) -> AppResult<TerminalSessionStatus>;

    fn write(&mut self, data: &[u8]) -> AppResult<()>;

    fn resize(&mut self, size: PtySize) -> AppResult<()>;

    fn close_detached(&mut self);
}

struct PtyTerminalTransport {
    process_guard: Option<PtyProcessGuard>,
    master: SharedPtyMasterHandle,
    writer: SharedWriterHandle,
}

impl TerminalSessionTransport for PtyTerminalTransport {
    fn status(&mut self) -> AppResult<TerminalSessionStatus> {
        let Some(process_guard) = self.process_guard.as_ref() else {
            return Ok(TerminalSessionStatus::Exited);
        };
        let status = if process_guard.try_wait_status()?.is_some() {
            TerminalSessionStatus::Exited
        } else {
            TerminalSessionStatus::Running
        };
        Ok(status)
    }

    fn write(&mut self, data: &[u8]) -> AppResult<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_writer"))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    fn resize(&mut self, size: PtySize) -> AppResult<()> {
        let master = self
            .master
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_master"))?;
        master
            .resize(size)
            .map_err(|error| AppError::Terminal(error.to_string()))
    }

    fn close_detached(&mut self) {
        let Some(process_guard) = self.process_guard.take() else {
            return;
        };
        thread::spawn(move || {
            let _ = process_guard.best_effort_kill();
        });
    }
}

/// 构造本地 PTY transport，并共享同一个 writer 给输出响应链路。
pub(super) fn create_pty_transport(
    process_guard: PtyProcessGuard,
    master: PtyMasterGuard,
    writer: WriterHandle,
) -> (SharedWriterHandle, SharedTerminalTransportHandle) {
    let master = Arc::new(Mutex::new(master));
    let writer = Arc::new(Mutex::new(writer));
    let transport = Arc::new(Mutex::new(Box::new(PtyTerminalTransport {
        process_guard: Some(process_guard),
        master,
        writer: Arc::clone(&writer),
    }) as Box<dyn TerminalSessionTransport>));
    (writer, transport)
}

fn managed_shell_queue_app_error(error: ManagedShellQueueError) -> AppError {
    let message = error.to_string();
    match error {
        ManagedShellQueueError::InputTooLarge { .. } => AppError::InvalidInput(message),
        ManagedShellQueueError::Backpressure { .. }
        | ManagedShellQueueError::QueueFull { .. }
        | ManagedShellQueueError::Closed => AppError::Terminal(message),
    }
}

struct ManagedSshShellTransport {
    closed: Arc<AtomicBool>,
    close_notify: Arc<tokio::sync::Notify>,
    commands: ManagedShellCommandSender,
}

impl TerminalSessionTransport for ManagedSshShellTransport {
    fn status(&mut self) -> AppResult<TerminalSessionStatus> {
        if self.closed.load(Ordering::SeqCst) {
            Ok(TerminalSessionStatus::Exited)
        } else {
            Ok(TerminalSessionStatus::Running)
        }
    }

    fn write(&mut self, data: &[u8]) -> AppResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::Terminal(
                "managed SSH shell channel is closed".to_owned(),
            ));
        }
        self.commands
            .try_send_write(data.to_vec())
            .map_err(managed_shell_queue_app_error)?;
        debug_assert!(
            self.commands.pending_write_bytes()
                <= super::managed_shell_channel::MANAGED_SSH_WRITE_MAX_PENDING_BYTES
        );
        Ok(())
    }

    fn resize(&mut self, size: PtySize) -> AppResult<()> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(AppError::Terminal(
                "managed SSH shell channel is closed".to_owned(),
            ));
        }
        self.commands
            .try_send_resize(size.cols, size.rows)
            .map_err(managed_shell_queue_app_error)
    }

    fn close_detached(&mut self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        // close 使用独立通知，避免数据队列已满时无法终止；bridge 会先按序排空已接收命令。
        self.close_notify.notify_one();
    }
}

struct ManagedSshShellWriter {
    closed: Arc<AtomicBool>,
    commands: ManagedShellCommandSender,
}

impl Write for ManagedSshShellWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "managed SSH shell channel is closed",
            ));
        }
        self.commands
            .send_write_with_backpressure(buf, || !self.closed.load(Ordering::SeqCst))
            .map_err(ManagedShellQueueError::into_io_error)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct ManagedSshShellReader {
    pending: Vec<u8>,
    pending_offset: usize,
    receiver: mpsc::Receiver<ManagedShellReaderMessage>,
}

impl Read for ManagedSshShellReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }

        loop {
            if self.pending_offset < self.pending.len() {
                let remaining = &self.pending[self.pending_offset..];
                let bytes_to_copy = remaining.len().min(buf.len());
                buf[..bytes_to_copy].copy_from_slice(&remaining[..bytes_to_copy]);
                self.pending_offset += bytes_to_copy;
                if self.pending_offset >= self.pending.len() {
                    self.pending.clear();
                    self.pending_offset = 0;
                }
                return Ok(bytes_to_copy);
            }

            match self.receiver.recv() {
                Ok(ManagedShellReaderMessage::Data(data)) if data.is_empty() => {}
                Ok(ManagedShellReaderMessage::Data(data)) => {
                    self.pending = data;
                    self.pending_offset = 0;
                }
                Ok(ManagedShellReaderMessage::Error(error)) => {
                    return Err(io::Error::other(error));
                }
                Ok(ManagedShellReaderMessage::Closed) | Err(_) => return Ok(0),
            }
        }
    }
}

/// 把异步 managed SSH shell 适配为 TerminalManager 使用的同步 reader/writer/transport。
pub(super) fn spawn_managed_shell_io(
    shell: TerminalManagedShellRuntime,
    startup_input: Option<String>,
) -> (
    Box<dyn Read + Send>,
    SharedWriterHandle,
    SharedTerminalTransportHandle,
) {
    let (reader_sender, reader_receiver) = managed_shell_reader_channel();
    let (command_sender, command_receiver) = managed_shell_command_channel();
    let closed = Arc::new(AtomicBool::new(false));
    let close_notify = Arc::new(tokio::sync::Notify::new());

    spawn_managed_shell_bridge(
        shell,
        startup_input,
        reader_sender,
        command_receiver,
        Arc::clone(&closed),
        Arc::clone(&close_notify),
    );

    let reader = Box::new(ManagedSshShellReader {
        pending: Vec::new(),
        pending_offset: 0,
        receiver: reader_receiver,
    });
    let writer = Arc::new(Mutex::new(Box::new(ManagedSshShellWriter {
        closed: Arc::clone(&closed),
        commands: command_sender.clone(),
    }) as WriterHandle));
    let transport = Arc::new(Mutex::new(Box::new(ManagedSshShellTransport {
        closed,
        close_notify,
        commands: command_sender,
    }) as Box<dyn TerminalSessionTransport>));
    (reader, writer, transport)
}

fn spawn_managed_shell_bridge(
    shell: TerminalManagedShellRuntime,
    startup_input: Option<String>,
    reader_sender: ManagedShellReaderSender,
    mut command_receiver: tokio::sync::mpsc::Receiver<QueuedManagedShellCommand>,
    closed: Arc<AtomicBool>,
    close_notify: Arc<tokio::sync::Notify>,
) {
    thread::spawn(move || {
        let TerminalManagedShellRuntime { mut shell, runtime } = shell;

        runtime.block_on(async move {
            if let Some(startup_input) = startup_input {
                if let Err(error) = shell.write(startup_input.into_bytes()).await {
                    let _ = reader_sender.send_error(error.to_string());
                    let _ = shell.close().await;
                    closed.store(true, Ordering::SeqCst);
                    let _ = reader_sender.send_closed();
                    return;
                }
            }

            loop {
                tokio::select! {
                    _ = close_notify.notified() => {
                        // close 之后不再接收新写入；这里按 FIFO 排空已成功入队的命令。
                        while let Ok(command) = command_receiver.try_recv() {
                            if let Err(error) = execute_managed_shell_command(&shell, command).await {
                                let _ = reader_sender.send_error(error.to_string());
                                break;
                            }
                        }
                        break;
                    }
                    command = command_receiver.recv() => {
                        match command {
                            Some(command) => {
                                if let Err(error) = execute_managed_shell_command(&shell, command).await {
                                    let _ = reader_sender.send_error(error.to_string());
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                    event = shell.read_event() => {
                        match event {
                            Ok(SshRuntimeShellEvent::Data(data))
                            | Ok(SshRuntimeShellEvent::ExtendedData { data, .. }) => {
                                if !reader_sender.send_data_while(data, || {
                                    !closed.load(Ordering::SeqCst)
                                }) {
                                    break;
                                }
                            }
                            Ok(SshRuntimeShellEvent::Eof) | Ok(SshRuntimeShellEvent::Closed) => {
                                break;
                            }
                            Ok(SshRuntimeShellEvent::ExitSignal { error_message, signal_name }) => {
                                let message = if error_message.is_empty() {
                                    format!("SSH shell exited by signal {signal_name}")
                                } else {
                                    format!("SSH shell exited by signal {signal_name}: {error_message}")
                                };
                                let _ = reader_sender.send_error(message);
                                break;
                            }
                            Ok(SshRuntimeShellEvent::ExitStatus(status)) => {
                                if status != 0 {
                                    let _ = reader_sender.send_error(format!(
                                        "SSH shell exited with status {status}"
                                    ));
                                }
                                break;
                            }
                            Err(error) => {
                                let _ = reader_sender.send_error(error.to_string());
                                break;
                            }
                        }
                    }
                }
            }

            let _ = shell.close().await;
            closed.store(true, Ordering::SeqCst);
            let _ = reader_sender.send_closed();
        });
    });
}

/// 执行一个已取得字节许可的 managed shell 命令；许可在 await 完成后释放。
async fn execute_managed_shell_command(
    shell: &ManagedSshShellSession,
    mut queued: QueuedManagedShellCommand,
) -> AppResult<()> {
    match queued.take_command() {
        ManagedShellCommand::Write(data) => shell.write(data).await,
        ManagedShellCommand::Resize { cols, rows } => shell.resize(cols, rows).await,
    }
}
