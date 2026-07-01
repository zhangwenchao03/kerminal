//! 终端输出日志与快照状态。
//!
//! @author kongweiguang

use std::{fs::File, io::Write, path::PathBuf};

use crate::{
    error::AppResult,
    models::terminal::{TerminalOutputSnapshot, TerminalSessionLogState},
    security::redaction::redact_terminal_text,
};

use super::text::next_char_boundary;

const LOG_REDACTION_PENDING_CHARS: usize = 4096;
const TERMINAL_CONTEXT_BUFFER_BYTES: usize = 64 * 1024;

pub(super) struct ActiveTerminalLog {
    pub(super) bytes_written: u64,
    pub(super) file: File,
    pub(super) pending_text: String,
    pub(super) path: PathBuf,
    pub(super) started_at: String,
}

impl ActiveTerminalLog {
    pub(super) fn append(&mut self, data: &str) -> AppResult<()> {
        self.pending_text.push_str(data);
        let Some(flush_end) = self.redactable_prefix_end() else {
            return Ok(());
        };
        let remaining = self.pending_text.split_off(flush_end);
        let data = std::mem::replace(&mut self.pending_text, remaining);
        self.write_redacted(&data)
    }

    pub(super) fn flush_pending(&mut self) -> AppResult<()> {
        if !self.pending_text.is_empty() {
            let data = std::mem::take(&mut self.pending_text);
            self.write_redacted(&data)?;
        }
        self.file.flush()?;
        Ok(())
    }

    fn redactable_prefix_end(&self) -> Option<usize> {
        if let Some(line_end) = self
            .pending_text
            .rfind('\n')
            .map(|index| index + '\n'.len_utf8())
        {
            return Some(line_end);
        }

        split_prefix_before_tail(&self.pending_text, LOG_REDACTION_PENDING_CHARS)
    }

    fn write_redacted(&mut self, data: &str) -> AppResult<()> {
        let (data, _) = redact_terminal_text(data);
        self.file.write_all(data.as_bytes())?;
        self.bytes_written += data.len() as u64;
        Ok(())
    }

    pub(super) fn state(&self, active: bool) -> TerminalSessionLogState {
        TerminalSessionLogState {
            active,
            path: Some(self.path.to_string_lossy().into_owned()),
            started_at: Some(self.started_at.clone()),
            bytes_written: self.bytes_written,
        }
    }
}

fn split_prefix_before_tail(input: &str, tail_chars: usize) -> Option<usize> {
    let split_char_index = input.chars().count().checked_sub(tail_chars)?;
    if split_char_index == 0 {
        return None;
    }
    input
        .char_indices()
        .nth(split_char_index)
        .map(|(byte_index, _)| byte_index)
}

#[derive(Default)]
pub(super) struct TerminalOutputBuffer {
    data: String,
    truncated: bool,
}

impl TerminalOutputBuffer {
    pub(super) fn push(&mut self, data: &str) {
        self.data.push_str(data);
        if self.data.len() <= TERMINAL_CONTEXT_BUFFER_BYTES {
            return;
        }

        let overflow = self.data.len() - TERMINAL_CONTEXT_BUFFER_BYTES;
        let drain_end = next_char_boundary(&self.data, overflow);
        self.data.drain(..drain_end);
        self.truncated = true;
    }

    pub(super) fn snapshot(&self, max_bytes: usize) -> TerminalOutputSnapshot {
        let max_bytes = max_bytes.clamp(1, TERMINAL_CONTEXT_BUFFER_BYTES);
        let (data, truncated_by_request) = tail_by_bytes(&self.data, max_bytes);

        TerminalOutputSnapshot {
            captured_bytes: data.len(),
            data,
            max_bytes,
            truncated: self.truncated || truncated_by_request,
        }
    }
}

fn tail_by_bytes(data: &str, max_bytes: usize) -> (String, bool) {
    if data.len() <= max_bytes {
        return (data.to_owned(), false);
    }

    let start = next_char_boundary(data, data.len() - max_bytes);
    (data[start..].to_owned(), true)
}
