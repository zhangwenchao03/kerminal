//! PTY output pump metrics helpers.
//!
//! @author kongweiguang

use crate::{
    models::terminal::{TerminalPtyOutputPumpFlushReason, TerminalPtyOutputPumpStats},
    services::terminal_output_pump::PtyOutputPump,
};
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

pub(super) type SharedPtyOutputPumpStats = Arc<Mutex<TerminalPtyOutputPumpStats>>;

pub(super) fn flush_metadata_since(
    flush_count_before: u64,
    pump: &PtyOutputPump,
    first_pending_started_at: Instant,
    now: Instant,
) -> Option<u64> {
    (pump.stats().flush_count > flush_count_before).then(|| {
        u64::try_from(
            now.saturating_duration_since(first_pending_started_at)
                .as_millis(),
        )
        .unwrap_or(u64::MAX)
    })
}

pub(super) fn publish_pump_stats(
    shared_stats: &SharedPtyOutputPumpStats,
    session_id: &str,
    pump: &PtyOutputPump,
    flush_metadata: Option<(u64, TerminalPtyOutputPumpFlushReason)>,
    ended: bool,
) {
    let Ok(mut snapshot) = shared_stats.lock() else {
        return;
    };
    let previous_flush_interval_ms = snapshot.last_flush_interval_ms;
    let previous_flush_reason = snapshot.last_flush_reason;
    let pump_stats = pump.stats();
    let (last_flush_interval_ms, last_flush_reason) = flush_metadata
        .map(|(interval_ms, reason)| (Some(interval_ms), Some(reason)))
        .unwrap_or((previous_flush_interval_ms, previous_flush_reason));

    *snapshot = TerminalPtyOutputPumpStats {
        session_id: session_id.to_owned(),
        pending_bytes: pump.pending_bytes(),
        buffered_chunks: pump_stats.buffered_chunks,
        input_chunks: pump_stats.input_chunks,
        input_bytes: pump_stats.input_bytes,
        data_events: pump_stats.data_events,
        closed_events: pump_stats.closed_events,
        error_events: pump_stats.error_events,
        output_bytes: pump_stats.output_bytes,
        flush_count: pump_stats.flush_count,
        coalesced_chunks: pump_stats.coalesced_chunks,
        max_pending_bytes: pump_stats.max_pending_bytes,
        max_pending_hit_count: pump_stats.max_pending_hit_count,
        dropped_bytes: pump_stats.dropped_bytes,
        overflow_count: pump_stats.overflow_count,
        final_tail_flush_count: pump_stats.final_tail_flush_count,
        last_flush_interval_ms,
        last_flush_reason,
        finished: pump.is_finished() || ended,
    };
}
