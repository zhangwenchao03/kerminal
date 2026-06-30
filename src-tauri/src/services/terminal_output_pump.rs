//! Local PTY output coalescing and terminal event ordering.
//!
//! @author kongweiguang

use crate::models::terminal::TerminalOutputEvent;

const DEFAULT_FLUSH_BYTES: usize = 64 * 1024;
const DEFAULT_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_OVERFLOW_NOTICE: &str =
    "\r\n\x1b[0m\x1b[33m[Kerminal] terminal output backlog exceeded; stale output was dropped.\x1b[0m\r\n";

/// Receives already prepared terminal output events from the pump.
pub trait PtyOutputSink {
    /// Returns false when the downstream consumer is no longer available.
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool;
}

impl<F> PtyOutputSink for F
where
    F: FnMut(TerminalOutputEvent) -> bool,
{
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        self(event)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtyOutputPumpConfig {
    /// Flush once pending output reaches this size. Time based idle flushing is
    /// owned by the reader/flusher adapter so the pump remains deterministic.
    pub flush_bytes: usize,
    /// Maximum bytes the pump may hold before dropping stale pending output.
    pub max_pending_bytes: usize,
    /// Notice inserted when stale pending output has to be dropped.
    pub overflow_notice: String,
}

impl Default for PtyOutputPumpConfig {
    fn default() -> Self {
        Self {
            flush_bytes: DEFAULT_FLUSH_BYTES,
            max_pending_bytes: DEFAULT_MAX_PENDING_BYTES,
            overflow_notice: DEFAULT_OVERFLOW_NOTICE.to_owned(),
        }
    }
}

impl PtyOutputPumpConfig {
    fn normalized(mut self) -> Self {
        self.flush_bytes = self.flush_bytes.max(1);
        self.max_pending_bytes = self
            .max_pending_bytes
            .max(1)
            .max(self.overflow_notice.len());
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PtyOutputPumpStats {
    pub input_chunks: u64,
    pub input_bytes: u64,
    pub data_events: u64,
    pub closed_events: u64,
    pub error_events: u64,
    pub output_bytes: u64,
    pub max_pending_bytes: usize,
    pub dropped_bytes: u64,
    pub overflow_count: u64,
}

/// Stateful output pump for a single PTY session.
pub struct PtyOutputPump {
    config: PtyOutputPumpConfig,
    finished: bool,
    pending: String,
    session_id: String,
    stats: PtyOutputPumpStats,
}

impl PtyOutputPump {
    pub fn new(session_id: impl Into<String>, config: PtyOutputPumpConfig) -> Self {
        Self {
            config: config.normalized(),
            finished: false,
            pending: String::new(),
            session_id: session_id.into(),
            stats: PtyOutputPumpStats::default(),
        }
    }

    pub fn push_data(&mut self, data: &str, sink: &mut impl PtyOutputSink) -> bool {
        if self.finished {
            return false;
        }
        if data.is_empty() {
            return true;
        }

        self.stats.input_chunks = self.stats.input_chunks.saturating_add(1);
        self.stats.input_bytes = self.stats.input_bytes.saturating_add(data.len() as u64);
        self.push_pending(data);
        if self.pending.len() >= self.config.flush_bytes {
            return self.flush(sink);
        }
        true
    }

    pub fn flush(&mut self, sink: &mut impl PtyOutputSink) -> bool {
        if self.finished {
            return false;
        }
        if self.pending.is_empty() {
            return true;
        }

        let data = std::mem::take(&mut self.pending);
        self.stats.data_events = self.stats.data_events.saturating_add(1);
        self.stats.output_bytes = self.stats.output_bytes.saturating_add(data.len() as u64);
        let accepted = sink.on_terminal_output(TerminalOutputEvent::data(&self.session_id, data));
        if !accepted {
            self.finished = true;
        }
        accepted
    }

    pub fn finish_closed(&mut self, sink: &mut impl PtyOutputSink) -> bool {
        if self.finished {
            return false;
        }
        if !self.flush(sink) {
            return false;
        }
        self.finished = true;
        self.stats.closed_events = self.stats.closed_events.saturating_add(1);
        sink.on_terminal_output(TerminalOutputEvent::closed(&self.session_id))
    }

    pub fn finish_error(
        &mut self,
        message: impl Into<String>,
        sink: &mut impl PtyOutputSink,
    ) -> bool {
        if self.finished {
            return false;
        }
        if !self.flush(sink) {
            return false;
        }
        self.finished = true;
        self.stats.error_events = self.stats.error_events.saturating_add(1);
        sink.on_terminal_output(TerminalOutputEvent::error(&self.session_id, message.into()))
    }

    pub fn pending_bytes(&self) -> usize {
        self.pending.len()
    }

    pub fn is_finished(&self) -> bool {
        self.finished
    }

    pub fn stats(&self) -> &PtyOutputPumpStats {
        &self.stats
    }

    fn push_pending(&mut self, data: &str) {
        if self.pending.len().saturating_add(data.len()) > self.config.max_pending_bytes {
            self.stats.overflow_count = self.stats.overflow_count.saturating_add(1);
            self.stats.dropped_bytes = self
                .stats
                .dropped_bytes
                .saturating_add(self.pending.len() as u64);
            self.pending.clear();
            self.pending.push_str(&self.config.overflow_notice);
        }

        let remaining = self
            .config
            .max_pending_bytes
            .saturating_sub(self.pending.len());
        if data.len() > remaining {
            let tail_start = tail_start_by_bytes(data, remaining);
            self.stats.dropped_bytes = self.stats.dropped_bytes.saturating_add(tail_start as u64);
            self.pending.push_str(&data[tail_start..]);
        } else {
            self.pending.push_str(data);
        }
        self.stats.max_pending_bytes = self.stats.max_pending_bytes.max(self.pending.len());
    }
}

fn tail_start_by_bytes(data: &str, max_bytes: usize) -> usize {
    if data.len() <= max_bytes {
        return 0;
    }
    let mut index = data.len() - max_bytes;
    while index < data.len() && !data.is_char_boundary(index) {
        index += 1;
    }
    index
}
