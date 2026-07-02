//! 终端会话轻量句柄。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalAgentSignalSummary, TerminalOutputSnapshot, TerminalPtyOutputPumpStats,
        TerminalSessionLogState, TerminalSessionStatus, TerminalSessionSummary,
    },
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use super::{
    safe_session_suffix, unix_timestamp_string, ActiveTerminalLog, SharedPtyChildHandle,
    SharedPtyMasterHandle, SharedWriterHandle, TerminalOutputBuffer,
};

pub(super) struct TerminalSessionHandle {
    pub(super) process_child: SharedPtyChildHandle,
    pub(super) cols: u16,
    pub(super) cwd: Option<PathBuf>,
    pub(super) id: String,
    pub(super) master: SharedPtyMasterHandle,
    pub(super) pid: Option<u32>,
    pub(super) rows: u16,
    pub(super) shell: String,
    pub(super) shell_integration: crate::models::terminal::TerminalShellIntegrationSummary,
    pub(super) target_ref: Option<String>,
    pub(super) target_token: Option<String>,
    pub(super) output_buffer: Arc<Mutex<TerminalOutputBuffer>>,
    pub(super) log_sink: Arc<Mutex<Option<ActiveTerminalLog>>>,
    pub(super) latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>>,
    pub(super) pump_stats: Arc<Mutex<TerminalPtyOutputPumpStats>>,
    pub(super) agent_session_id: Option<String>,
    pub(super) writer: SharedWriterHandle,
}

impl TerminalSessionHandle {
    pub(super) fn summary(&self) -> AppResult<TerminalSessionSummary> {
        let status = if self
            .process_child
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_child"))?
            .try_wait()?
            .is_some()
        {
            TerminalSessionStatus::Exited
        } else {
            TerminalSessionStatus::Running
        };

        Ok(TerminalSessionSummary {
            id: self.id.clone(),
            shell: self.shell.clone(),
            cwd: self
                .cwd
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            cols: self.cols,
            rows: self.rows,
            pid: self.pid,
            status,
            target_ref: self.target_ref.clone(),
            target_token: self.target_token.clone(),
            shell_integration: self.shell_integration.clone(),
            agent_session_id: self.agent_session_id.clone(),
            agent_signal: self
                .latest_agent_signal
                .lock()
                .ok()
                .and_then(|signal| signal.clone()),
        })
    }

    pub(super) fn output_snapshot(&self, max_bytes: usize) -> AppResult<TerminalOutputSnapshot> {
        let output_buffer = self
            .output_buffer
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_output_buffer"))?;
        Ok(output_buffer.snapshot(max_bytes))
    }

    pub(super) fn pty_output_pump_stats(&self) -> AppResult<TerminalPtyOutputPumpStats> {
        self.pump_stats
            .lock()
            .map(|stats| stats.clone())
            .map_err(|_| AppError::StateLockPoisoned("terminal_pty_output_pump_stats"))
    }

    pub(super) fn start_log(&self, logs_root: &Path) -> AppResult<TerminalSessionLogState> {
        let mut log_sink = self
            .log_sink
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_log_sink"))?;
        if let Some(active_log) = log_sink.as_ref() {
            return Ok(active_log.state(true));
        }

        let started_at = unix_timestamp_string();
        let session_log_dir = logs_root.join("sessions");
        fs::create_dir_all(&session_log_dir)?;
        let path = session_log_dir.join(format!(
            "session-{}-{}.log",
            started_at,
            safe_session_suffix(&self.id)
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)?;

        let header = format!(
            "Kerminal session log\nsession_id: {}\nshell: {}\ncwd: {}\nstarted_at: {}\n\n",
            self.id,
            self.shell,
            self.cwd
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|| "-".to_owned()),
            started_at
        );
        file.write_all(header.as_bytes())?;
        file.flush()?;

        let active_log = ActiveTerminalLog {
            bytes_written: header.len() as u64,
            file,
            pending_text: String::new(),
            path,
            started_at,
        };
        let state = active_log.state(true);
        *log_sink = Some(active_log);
        Ok(state)
    }

    pub(super) fn stop_log(&self) -> AppResult<TerminalSessionLogState> {
        let mut log_sink = self
            .log_sink
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_log_sink"))?;
        let Some(mut active_log) = log_sink.take() else {
            return Ok(TerminalSessionLogState::inactive());
        };
        active_log.flush_pending()?;
        Ok(active_log.state(false))
    }

    pub(super) fn log_state(&self) -> AppResult<TerminalSessionLogState> {
        let log_sink = self
            .log_sink
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_log_sink"))?;
        Ok(log_sink
            .as_ref()
            .map(|active_log| active_log.state(true))
            .unwrap_or_else(TerminalSessionLogState::inactive))
    }
}
