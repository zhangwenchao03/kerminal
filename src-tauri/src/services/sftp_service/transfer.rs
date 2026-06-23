//! SFTP 传输运行时状态、事件和进度跟踪。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt, io,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll},
    time::Duration,
};

#[cfg(not(test))]
use tauri::{Emitter, Window};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::Notify,
};

use crate::{
    error::{AppError, AppResult},
    models::sftp::{SftpTransferStatus, SftpTransferSummary},
};

#[cfg(not(test))]
use super::unix_timestamp_millis;
use super::{unix_timestamp, SftpRuntimeSettings};

#[cfg(not(test))]
const SFTP_TRANSFER_UPDATED_EVENT: &str = "sftp-transfer-updated";
#[cfg(not(test))]
const SFTP_TRANSFER_PROGRESS_EMIT_INTERVAL_MS: u64 = 200;

#[derive(Debug, Clone)]
pub(super) struct TransferTask {
    pub(super) summary: SftpTransferSummary,
    pub(super) cancel_requested: Arc<AtomicBool>,
}

#[cfg(not(test))]
#[derive(Clone)]
pub(super) struct TransferEventEmitter {
    state: Arc<Mutex<TransferEventEmitterState>>,
    window: Window,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(super) struct TransferEventEmitter;

#[cfg(not(test))]
impl fmt::Debug for TransferEventEmitter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TransferEventEmitter")
            .field("event", &SFTP_TRANSFER_UPDATED_EVENT)
            .finish()
    }
}

#[derive(Debug, Default)]
#[cfg(not(test))]
struct TransferEventEmitterState {
    last_emit_ms: u64,
}

#[cfg(not(test))]
impl TransferEventEmitter {
    pub(super) fn new(window: Window) -> Self {
        Self {
            state: Arc::new(Mutex::new(TransferEventEmitterState::default())),
            window,
        }
    }

    pub(super) fn emit(&self, summary: &SftpTransferSummary, force: bool) {
        let now_ms = unix_timestamp_millis();
        let should_emit = if force {
            true
        } else if let Ok(mut state) = self.state.lock() {
            let due = now_ms.saturating_sub(state.last_emit_ms)
                >= SFTP_TRANSFER_PROGRESS_EMIT_INTERVAL_MS;
            if due {
                state.last_emit_ms = now_ms;
            }
            due
        } else {
            true
        };

        if should_emit {
            if let Ok(mut state) = self.state.lock() {
                state.last_emit_ms = now_ms;
            }
            let _ = self
                .window
                .emit(SFTP_TRANSFER_UPDATED_EVENT, summary.clone());
        }
    }
}

#[cfg(test)]
impl TransferEventEmitter {
    pub(super) fn emit(&self, _summary: &SftpTransferSummary, _force: bool) {}
}

#[derive(Debug, Default)]
pub(super) struct TransferLimiter {
    state: Mutex<TransferLimiterState>,
    notify: Notify,
}

#[derive(Debug, Default)]
struct TransferLimiterState {
    global_running: usize,
    host_running: HashMap<String, usize>,
}

impl TransferLimiter {
    pub(super) async fn acquire(
        self: &Arc<Self>,
        host_id: String,
        settings: SftpRuntimeSettings,
        progress: TransferProgress,
    ) -> AppResult<TransferLimitPermit> {
        loop {
            progress.ensure_not_cancelled()?;
            {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| AppError::StateLockPoisoned("sftp transfer limits"))?;
                if state.can_start(&host_id, settings) {
                    state.global_running = state.global_running.saturating_add(1);
                    *state.host_running.entry(host_id.clone()).or_insert(0) += 1;
                    return Ok(TransferLimitPermit {
                        limiter: self.clone(),
                        host_id,
                    });
                }
            }

            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }
    }

    pub(super) async fn acquire_many(
        self: &Arc<Self>,
        host_ids: Vec<String>,
        settings: SftpRuntimeSettings,
        progress: TransferProgress,
    ) -> AppResult<Vec<TransferLimitPermit>> {
        let mut required_by_host = HashMap::<String, usize>::new();
        for host_id in &host_ids {
            *required_by_host.entry(host_id.clone()).or_insert(0) += 1;
        }
        let required_global = host_ids.len();

        loop {
            progress.ensure_not_cancelled()?;
            {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| AppError::StateLockPoisoned("sftp transfer limits"))?;
                if state.can_start_many(&required_by_host, required_global, settings) {
                    state.global_running = state.global_running.saturating_add(required_global);
                    for (host_id, count) in &required_by_host {
                        *state.host_running.entry(host_id.clone()).or_insert(0) += count;
                    }
                    return Ok(host_ids
                        .into_iter()
                        .map(|host_id| TransferLimitPermit {
                            limiter: self.clone(),
                            host_id,
                        })
                        .collect());
                }
            }

            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }
    }
}

impl TransferLimiterState {
    fn can_start(&self, host_id: &str, settings: SftpRuntimeSettings) -> bool {
        let host_running = self.host_running.get(host_id).copied().unwrap_or(0);
        self.global_running < settings.global_transfers && host_running < settings.host_transfers
    }

    fn can_start_many(
        &self,
        required_by_host: &HashMap<String, usize>,
        required_global: usize,
        settings: SftpRuntimeSettings,
    ) -> bool {
        if self.global_running.saturating_add(required_global) > settings.global_transfers {
            return false;
        }
        required_by_host.iter().all(|(host_id, required)| {
            self.host_running
                .get(host_id)
                .copied()
                .unwrap_or(0)
                .saturating_add(*required)
                <= settings.host_transfers
        })
    }
}

#[derive(Debug)]
pub(super) struct TransferLimitPermit {
    limiter: Arc<TransferLimiter>,
    host_id: String,
}

impl Drop for TransferLimitPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.limiter.state.lock() {
            state.global_running = state.global_running.saturating_sub(1);
            if let Some(host_running) = state.host_running.get_mut(&self.host_id) {
                *host_running = host_running.saturating_sub(1);
                if *host_running == 0 {
                    state.host_running.remove(&self.host_id);
                }
            }
        }
        self.limiter.notify.notify_waiters();
    }
}

#[derive(Clone)]
pub(super) struct TransferProgress {
    transfer_id: Option<String>,
    transfers: Option<Arc<Mutex<HashMap<String, TransferTask>>>>,
    pub(super) cancel_requested: Arc<AtomicBool>,
    event_emitter: Option<TransferEventEmitter>,
}

impl fmt::Debug for TransferProgress {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TransferProgress")
            .field("transfer_id", &self.transfer_id)
            .field(
                "cancel_requested",
                &self.cancel_requested.load(Ordering::SeqCst),
            )
            .field("event_emitter", &self.event_emitter.is_some())
            .finish()
    }
}

impl TransferProgress {
    pub(super) fn detached() -> Self {
        Self {
            transfer_id: None,
            transfers: None,
            cancel_requested: Arc::new(AtomicBool::new(false)),
            event_emitter: None,
        }
    }

    pub(super) fn detached_with_cancel(cancel_requested: Arc<AtomicBool>) -> Self {
        Self {
            transfer_id: None,
            transfers: None,
            cancel_requested,
            event_emitter: None,
        }
    }

    pub(super) fn tracked(
        transfer_id: String,
        transfers: Arc<Mutex<HashMap<String, TransferTask>>>,
        cancel_requested: Arc<AtomicBool>,
        event_emitter: Option<TransferEventEmitter>,
    ) -> Self {
        Self {
            transfer_id: Some(transfer_id),
            transfers: Some(transfers),
            cancel_requested,
            event_emitter,
        }
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub(super) fn ensure_not_cancelled(&self) -> AppResult<()> {
        if self.is_cancelled() {
            return Err(AppError::Sftp("传输已取消".to_owned()));
        }
        Ok(())
    }

    pub(super) fn mark_running(&self) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Running;
            summary.phase = Some("running".to_owned());
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn mark_phase(&self, phase: impl Into<String>, current_item: Option<String>) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Running;
            summary.phase = Some(phase.into());
            summary.current_item = current_item;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn set_total_bytes(&self, total_bytes: u64) {
        self.update_summary(true, |summary| {
            summary.total_bytes = Some(total_bytes);
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn add_total_bytes(&self, bytes: u64) {
        self.update_summary(false, |summary| {
            summary.total_bytes = Some(summary.total_bytes.unwrap_or(0).saturating_add(bytes));
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn add_bytes(&self, bytes: u64) {
        self.update_summary(false, |summary| {
            summary.bytes_transferred = summary.bytes_transferred.saturating_add(bytes);
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn succeed(&self) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Succeeded;
            summary.error = None;
            summary.phase = Some("done".to_owned());
            summary.current_item = None;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn cancel(&self) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Canceled;
            summary.cancel_requested = true;
            summary.phase = Some("canceled".to_owned());
            summary.current_item = None;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn cancel_with_message(&self, error: &AppError) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Canceled;
            summary.cancel_requested = true;
            summary.error = Some(error.to_string());
            summary.phase = Some("canceled".to_owned());
            summary.current_item = None;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn fail(&self, error: impl Into<String>) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Failed;
            summary.error = Some(error.into());
            summary.phase = Some("failed".to_owned());
            summary.updated_at = unix_timestamp();
        });
    }

    fn update_summary(&self, force_event: bool, update: impl FnOnce(&mut SftpTransferSummary)) {
        let (Some(transfer_id), Some(transfers)) = (&self.transfer_id, &self.transfers) else {
            return;
        };
        let next_summary = if let Ok(mut transfers) = transfers.lock() {
            transfers.get_mut(transfer_id).map(|task| {
                update(&mut task.summary);
                task.summary.clone()
            })
        } else {
            None
        };
        if let (Some(summary), Some(emitter)) = (next_summary, &self.event_emitter) {
            emitter.emit(&summary, force_event);
        }
    }
}

pub(super) struct ProgressReader<R> {
    inner: R,
    progress: TransferProgress,
}

impl<R> ProgressReader<R> {
    pub(super) fn new(inner: R, progress: TransferProgress) -> Self {
        Self { inner, progress }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for ProgressReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.progress.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "transfer canceled",
            )));
        }

        let before = buf.filled().len();
        let poll = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = &poll {
            let after = buf.filled().len();
            if after > before {
                self.progress.add_bytes((after - before) as u64);
            }
        }
        poll
    }
}

pub(super) struct ProgressWriter<W> {
    inner: W,
    progress: TransferProgress,
}

impl<W> ProgressWriter<W> {
    pub(super) fn new(inner: W, progress: TransferProgress) -> Self {
        Self { inner, progress }
    }
}

impl<W: AsyncWrite + Unpin> AsyncWrite for ProgressWriter<W> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.progress.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "transfer canceled",
            )));
        }
        let poll = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(bytes)) = poll {
            self.progress.add_bytes(bytes as u64);
            return Poll::Ready(Ok(bytes));
        }
        poll
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
