//! Managed SSH shell 的有界输入与读取通道。
//!
//! @author kongweiguang

use std::{
    fmt, io,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
};

/// 单次 terminal write 的 UTF-8 字节上限；保持既有 1 MiB 粘贴合同，同时拒绝无界请求。
pub(crate) const TERMINAL_WRITE_MAX_BYTES: usize = 1024 * 1024;
/// Managed SSH 尚未完成的写入总预算，包含排队和正在执行的写入。
pub(crate) const MANAGED_SSH_WRITE_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const MANAGED_SSH_COMMAND_CHANNEL_CAPACITY: usize = 64;
const CHANNEL_BACKPRESSURE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(1);

/// SSH shell 读取消息的固定分片大小。
pub(crate) const MANAGED_SSH_READER_CHUNK_BYTES: usize = 16 * 1024;
/// SSH shell 读取队列的字节预算。
pub(crate) const MANAGED_SSH_READER_MAX_PENDING_BYTES: usize = 1024 * 1024;
/// 固定分片与消息容量共同保证队列在读取下一批数据前保持有界。
pub(crate) const MANAGED_SSH_READER_CHANNEL_CAPACITY: usize =
    MANAGED_SSH_READER_MAX_PENDING_BYTES / MANAGED_SSH_READER_CHUNK_BYTES;

/// Managed SSH bridge 串行执行的控制命令。
#[derive(Debug)]
pub(crate) enum ManagedShellCommand {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
}

/// 输入队列拒绝原因；调用层据此区分非法输入、可重试背压和已关闭会话。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ManagedShellQueueError {
    InputTooLarge {
        actual_bytes: usize,
        max_bytes: usize,
    },
    Backpressure {
        pending_bytes: usize,
        requested_bytes: usize,
        max_pending_bytes: usize,
    },
    QueueFull {
        capacity: usize,
    },
    Closed,
}

impl ManagedShellQueueError {
    pub(crate) fn into_io_error(self) -> io::Error {
        let kind = match &self {
            Self::InputTooLarge { .. } => io::ErrorKind::InvalidInput,
            Self::Backpressure { .. } | Self::QueueFull { .. } => io::ErrorKind::WouldBlock,
            Self::Closed => io::ErrorKind::BrokenPipe,
        };
        io::Error::new(kind, self)
    }
}

impl fmt::Display for ManagedShellQueueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InputTooLarge {
                actual_bytes,
                max_bytes,
            } => write!(
                formatter,
                "terminal input exceeds per-write limit: {actual_bytes} bytes > {max_bytes} bytes"
            ),
            Self::Backpressure {
                pending_bytes,
                requested_bytes,
                max_pending_bytes,
            } => write!(
                formatter,
                "managed SSH shell input backpressure: {pending_bytes} pending bytes plus {requested_bytes} requested bytes exceed the {max_pending_bytes}-byte high-water mark"
            ),
            Self::QueueFull { capacity } => write!(
                formatter,
                "managed SSH shell input backpressure: command queue reached its {capacity}-message capacity"
            ),
            Self::Closed => formatter.write_str("managed SSH shell channel is closed"),
        }
    }
}

impl std::error::Error for ManagedShellQueueError {}

#[derive(Debug, Default)]
struct PendingWriteBudget {
    bytes: AtomicUsize,
}

impl PendingWriteBudget {
    fn try_reserve(
        self: &Arc<Self>,
        requested_bytes: usize,
    ) -> Result<WritePermit, ManagedShellQueueError> {
        let mut pending_bytes = self.bytes.load(Ordering::Acquire);
        loop {
            let Some(next_bytes) = pending_bytes.checked_add(requested_bytes) else {
                return Err(ManagedShellQueueError::Backpressure {
                    pending_bytes,
                    requested_bytes,
                    max_pending_bytes: MANAGED_SSH_WRITE_MAX_PENDING_BYTES,
                });
            };
            if next_bytes > MANAGED_SSH_WRITE_MAX_PENDING_BYTES {
                return Err(ManagedShellQueueError::Backpressure {
                    pending_bytes,
                    requested_bytes,
                    max_pending_bytes: MANAGED_SSH_WRITE_MAX_PENDING_BYTES,
                });
            }
            match self.bytes.compare_exchange_weak(
                pending_bytes,
                next_bytes,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    return Ok(WritePermit {
                        budget: Arc::clone(self),
                        bytes: requested_bytes,
                    });
                }
                Err(actual) => pending_bytes = actual,
            }
        }
    }
}

#[derive(Debug)]
struct WritePermit {
    budget: Arc<PendingWriteBudget>,
    bytes: usize,
}

impl Drop for WritePermit {
    fn drop(&mut self) {
        self.budget.bytes.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

/// 队列项持有字节许可直到 bridge 完成对应写入。
#[derive(Debug)]
pub(crate) struct QueuedManagedShellCommand {
    command: Option<ManagedShellCommand>,
    _write_permit: Option<WritePermit>,
}

impl QueuedManagedShellCommand {
    pub(crate) fn take_command(&mut self) -> ManagedShellCommand {
        self.command
            .take()
            .expect("managed shell command may only be taken once")
    }
}

/// 同步调用侧使用的有界 command sender。
#[derive(Clone, Debug)]
pub(crate) struct ManagedShellCommandSender {
    budget: Arc<PendingWriteBudget>,
    sender: tokio::sync::mpsc::Sender<QueuedManagedShellCommand>,
}

impl ManagedShellCommandSender {
    pub(crate) fn try_send_write(&self, data: Vec<u8>) -> Result<(), ManagedShellQueueError> {
        if data.len() > TERMINAL_WRITE_MAX_BYTES {
            return Err(ManagedShellQueueError::InputTooLarge {
                actual_bytes: data.len(),
                max_bytes: TERMINAL_WRITE_MAX_BYTES,
            });
        }
        if data.is_empty() {
            return Ok(());
        }

        let permit = self.budget.try_reserve(data.len())?;
        self.try_send(QueuedManagedShellCommand {
            command: Some(ManagedShellCommand::Write(data)),
            _write_permit: Some(permit),
        })
    }

    pub(crate) fn try_send_resize(
        &self,
        cols: u16,
        rows: u16,
    ) -> Result<(), ManagedShellQueueError> {
        self.try_send(QueuedManagedShellCommand {
            command: Some(ManagedShellCommand::Resize { cols, rows }),
            _write_permit: None,
        })
    }

    pub(crate) fn pending_write_bytes(&self) -> usize {
        self.budget.bytes.load(Ordering::Acquire)
    }

    /// 内部 escape/secret 响应不能因用户输入瞬时高水位而终止 reader，改为受关闭信号约束的等待。
    pub(crate) fn send_write_with_backpressure(
        &self,
        data: &[u8],
        mut should_continue: impl FnMut() -> bool,
    ) -> Result<(), ManagedShellQueueError> {
        loop {
            if !should_continue() {
                return Err(ManagedShellQueueError::Closed);
            }
            match self.try_send_write(data.to_vec()) {
                Ok(()) => return Ok(()),
                Err(
                    ManagedShellQueueError::Backpressure { .. }
                    | ManagedShellQueueError::QueueFull { .. },
                ) => std::thread::sleep(CHANNEL_BACKPRESSURE_RETRY_DELAY),
                Err(error) => return Err(error),
            }
        }
    }

    fn try_send(&self, queued: QueuedManagedShellCommand) -> Result<(), ManagedShellQueueError> {
        match self.sender.try_send(queued) {
            Ok(()) => Ok(()),
            Err(tokio::sync::mpsc::error::TrySendError::Full(queued)) => {
                drop(queued);
                Err(ManagedShellQueueError::QueueFull {
                    capacity: MANAGED_SSH_COMMAND_CHANNEL_CAPACITY,
                })
            }
            Err(tokio::sync::mpsc::error::TrySendError::Closed(queued)) => {
                drop(queued);
                Err(ManagedShellQueueError::Closed)
            }
        }
    }
}

pub(crate) fn managed_shell_command_channel() -> (
    ManagedShellCommandSender,
    tokio::sync::mpsc::Receiver<QueuedManagedShellCommand>,
) {
    let (sender, receiver) = tokio::sync::mpsc::channel(MANAGED_SSH_COMMAND_CHANNEL_CAPACITY);
    let budget = Arc::new(PendingWriteBudget::default());
    (ManagedShellCommandSender { budget, sender }, receiver)
}

/// Managed SSH bridge 交给 blocking reader 的消息。
#[derive(Debug)]
pub(crate) enum ManagedShellReaderMessage {
    Data(Vec<u8>),
    Error(String),
    Closed,
}

/// 大块 SSH channel data 会在进入固定容量队列前切分。
#[derive(Clone, Debug)]
pub(crate) struct ManagedShellReaderSender {
    sender: mpsc::SyncSender<ManagedShellReaderMessage>,
}

impl ManagedShellReaderSender {
    /// reader queue 满时暂停读取；会话关闭后立即放弃等待，让 bridge 进入资源释放。
    pub(crate) fn send_data_while(
        &self,
        data: Vec<u8>,
        mut should_continue: impl FnMut() -> bool,
    ) -> bool {
        for chunk in data.chunks(MANAGED_SSH_READER_CHUNK_BYTES) {
            if !self.send_message_while(
                ManagedShellReaderMessage::Data(chunk.to_vec()),
                &mut should_continue,
            ) {
                return false;
            }
        }
        true
    }

    pub(crate) fn send_error(&self, error: String) -> bool {
        self.sender
            .send(ManagedShellReaderMessage::Error(error))
            .is_ok()
    }

    pub(crate) fn send_closed(&self) -> bool {
        self.sender.send(ManagedShellReaderMessage::Closed).is_ok()
    }

    fn send_message_while(
        &self,
        mut message: ManagedShellReaderMessage,
        should_continue: &mut impl FnMut() -> bool,
    ) -> bool {
        loop {
            if !should_continue() {
                return false;
            }
            match self.sender.try_send(message) {
                Ok(()) => return true,
                Err(mpsc::TrySendError::Full(returned)) => {
                    message = returned;
                    std::thread::sleep(CHANNEL_BACKPRESSURE_RETRY_DELAY);
                }
                Err(mpsc::TrySendError::Disconnected(_)) => return false,
            }
        }
    }
}

pub(crate) fn managed_shell_reader_channel() -> (
    ManagedShellReaderSender,
    mpsc::Receiver<ManagedShellReaderMessage>,
) {
    let (sender, receiver) = mpsc::sync_channel(MANAGED_SSH_READER_CHANNEL_CAPACITY);
    (ManagedShellReaderSender { sender }, receiver)
}
