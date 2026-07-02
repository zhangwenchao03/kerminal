//! PTY output pump behavior tests.
//!
//! @author kongweiguang

use kerminal_lib::{
    models::terminal::{TerminalOutputEvent, TerminalOutputKind},
    services::terminal_output_pump::{PtyOutputPump, PtyOutputPumpConfig, PtyOutputSink},
};

const SESSION_ID: &str = "session-output-pump-test";
const KIB: usize = 1024;
const MIB: usize = 1024 * 1024;

#[derive(Default)]
struct RecordingSink {
    events: Vec<TerminalOutputEvent>,
}

impl PtyOutputSink for RecordingSink {
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        self.events.push(event);
        true
    }
}

#[test]
fn terminal_output_pump_coalesces_small_chunks_without_reordering() {
    let mut pump = PtyOutputPump::new(SESSION_ID, test_config(8, 1024));
    let mut sink = RecordingSink::default();

    assert!(pump.push_data("ab", &mut sink));
    assert!(pump.push_data("cd", &mut sink));
    assert!(pump.push_data("ef", &mut sink));
    assert!(sink.events.is_empty());

    assert!(pump.push_data("gh", &mut sink));
    assert_eq!(data_events(&sink.events), vec!["abcdefgh"]);

    assert!(pump.push_data("ij", &mut sink));
    assert!(pump.finish_closed(&mut sink));

    assert_eq!(data_events(&sink.events), vec!["abcdefgh", "ij"]);
    assert_eq!(
        terminal_kinds(&sink.events),
        vec![TerminalOutputKind::Closed]
    );
    assert_eq!(pump.stats().data_events, 2);
    assert_eq!(pump.stats().closed_events, 1);
}

#[test]
fn terminal_output_pump_tracks_pending_and_coalesced_chunk_metrics() {
    let mut pump = PtyOutputPump::new(SESSION_ID, test_config(16, 1024));
    let mut sink = RecordingSink::default();

    assert!(pump.push_data("ab", &mut sink));
    assert!(pump.push_data("cd", &mut sink));
    assert_eq!(pump.pending_bytes(), 4);
    assert_eq!(pump.stats().buffered_chunks, 2);
    assert_eq!(pump.stats().coalesced_chunks, 0);
    assert_eq!(pump.stats().flush_count, 0);

    assert!(pump.flush(&mut sink));

    assert_eq!(data_events(&sink.events), vec!["abcd"]);
    assert_eq!(pump.pending_bytes(), 0);
    assert_eq!(pump.stats().buffered_chunks, 0);
    assert_eq!(pump.stats().coalesced_chunks, 2);
    assert_eq!(pump.stats().flush_count, 1);
    assert_eq!(pump.stats().data_events, 1);
}

#[test]
fn terminal_output_pump_bounds_pending_on_overflow_and_keeps_recent_tail() {
    let mut pump = PtyOutputPump::new(
        SESSION_ID,
        PtyOutputPumpConfig {
            flush_bytes: 1024,
            max_pending_bytes: 64,
            overflow_notice: "NOTICE: dropped stale terminal output\n".to_owned(),
        },
    );
    let mut sink = RecordingSink::default();

    assert!(pump.push_data(&"A".repeat(40), &mut sink));
    assert!(pump.push_data(&"B".repeat(80), &mut sink));

    assert!(pump.pending_bytes() <= 64);
    assert_eq!(pump.stats().overflow_count, 1);
    assert!(pump.stats().max_pending_hit_count >= 1);
    assert!(pump.stats().dropped_bytes > 0);

    assert!(pump.finish_closed(&mut sink));

    let data = sink
        .events
        .iter()
        .find(|event| event.kind == TerminalOutputKind::Data)
        .expect("data event")
        .data
        .as_str();
    assert!(data.contains("NOTICE: dropped stale terminal output"));
    assert!(!data.contains('A'));
    assert!(data.ends_with(&"B".repeat(64 - "NOTICE: dropped stale terminal output\n".len())));
    assert_eq!(
        terminal_kinds(&sink.events),
        vec![TerminalOutputKind::Closed]
    );
}

#[test]
fn terminal_output_pump_flushes_final_tail_before_closed_once() {
    let mut pump = PtyOutputPump::new(SESSION_ID, test_config(1024, 4096));
    let mut sink = RecordingSink::default();

    assert!(pump.push_data("last line without newline", &mut sink));
    assert!(pump.finish_closed(&mut sink));
    assert!(!pump.finish_closed(&mut sink));
    assert!(!pump.push_data("late output", &mut sink));

    assert_eq!(sink.events.len(), 2);
    assert_eq!(sink.events[0].kind, TerminalOutputKind::Data);
    assert_eq!(sink.events[0].data, "last line without newline");
    assert_eq!(sink.events[1].kind, TerminalOutputKind::Closed);
    assert_eq!(pump.stats().closed_events, 1);
    assert_eq!(pump.stats().final_tail_flush_count, 1);
    assert_eq!(pump.stats().flush_count, 1);
}

#[test]
fn terminal_output_pump_flushes_final_tail_before_error_once() {
    let mut pump = PtyOutputPump::new(SESSION_ID, test_config(1024, 4096));
    let mut sink = RecordingSink::default();

    assert!(pump.push_data("stderr tail", &mut sink));
    assert!(pump.finish_error("read failed", &mut sink));
    assert!(!pump.finish_closed(&mut sink));

    assert_eq!(sink.events.len(), 2);
    assert_eq!(sink.events[0].kind, TerminalOutputKind::Data);
    assert_eq!(sink.events[0].data, "stderr tail");
    assert_eq!(sink.events[1].kind, TerminalOutputKind::Error);
    assert_eq!(sink.events[1].data, "read failed");
    assert_eq!(pump.stats().error_events, 1);
    assert_eq!(pump.stats().closed_events, 0);
    assert_eq!(pump.stats().final_tail_flush_count, 1);
}

#[test]
fn terminal_output_pump_counts_max_pending_hits_without_storing_raw_output_in_stats() {
    let mut pump = PtyOutputPump::new(SESSION_ID, test_config(1024, 8));
    let mut sink = RecordingSink::default();

    assert!(pump.push_data("12345678", &mut sink));
    assert_eq!(pump.pending_bytes(), 8);
    assert_eq!(pump.stats().max_pending_bytes, 8);
    assert_eq!(pump.stats().max_pending_hit_count, 1);
    assert!(pump.push_data("raw-output-text-that-must-not-appear", &mut sink));

    let stats_debug = format!("{:?}", pump.stats());
    assert!(!stats_debug.contains("raw-output-text-that-must-not-appear"));
    assert!(pump.stats().max_pending_hit_count >= 2);
    assert!(pump.stats().dropped_bytes > 0);
}

#[test]
fn terminal_output_pump_delivers_transformed_data_to_snapshot_log_then_event() {
    let mut pump = PtyOutputPump::new(SESSION_ID, test_config(8, 4096));
    let mut sink = OrderedDeliverySink::default();
    let redacted = "token=raw-secret-value\n".replace("raw-secret-value", "[redacted]");

    assert!(pump.push_data(&redacted, &mut sink));
    assert!(pump.finish_closed(&mut sink));

    assert_eq!(
        sink.steps,
        vec!["snapshot:data", "log:data", "event:data", "event:closed"]
    );
    assert_eq!(sink.snapshot_tail, "token=[redacted]\n");
    assert_eq!(sink.log_text, "token=[redacted]\n");
    assert_eq!(sink.events[0].data, "token=[redacted]\n");
    assert!(!sink.snapshot_tail.contains("raw-secret-value"));
    assert!(!sink.log_text.contains("raw-secret-value"));
    assert!(!sink.events[0].data.contains("raw-secret-value"));
}

#[test]
fn terminal_output_pump_records_high_frequency_baselines() {
    let cases = [
        BaselineCase {
            name: "1-byte",
            total_bytes: 1,
            chunk_bytes: 1,
        },
        BaselineCase {
            name: "1-kib",
            total_bytes: KIB,
            chunk_bytes: 17,
        },
        BaselineCase {
            name: "64-kib",
            total_bytes: 64 * KIB,
            chunk_bytes: KIB,
        },
        BaselineCase {
            name: "16-mib",
            total_bytes: 16 * MIB,
            chunk_bytes: 8 * KIB,
        },
        BaselineCase {
            name: "100-mib",
            total_bytes: 100 * MIB,
            chunk_bytes: 8 * KIB,
        },
    ];

    for case in cases {
        let result = run_baseline(case);
        eprintln!(
            "terminal_output_pump_baseline name={} total_bytes={} data_events={} max_pending_bytes={} tail_len={}",
            case.name,
            case.total_bytes,
            result.data_events,
            result.max_pending_bytes,
            result.tail.len()
        );

        assert_eq!(result.total_data_bytes, case.total_bytes as u64);
        assert_eq!(result.terminal_kinds, vec![TerminalOutputKind::Closed]);
        assert!(result.data_events > 0);
        assert!(result.max_pending_bytes <= 4 * MIB);
        assert_eq!(result.tail, "x".repeat(case.total_bytes.min(64)));
    }
}

#[derive(Default)]
struct OrderedDeliverySink {
    events: Vec<TerminalOutputEvent>,
    log_text: String,
    snapshot_tail: String,
    steps: Vec<&'static str>,
}

impl PtyOutputSink for OrderedDeliverySink {
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        match event.kind {
            TerminalOutputKind::Data => {
                self.steps.push("snapshot:data");
                self.snapshot_tail.push_str(&event.data);
                self.steps.push("log:data");
                self.log_text.push_str(&event.data);
                self.steps.push("event:data");
                self.events.push(event);
            }
            TerminalOutputKind::Closed => {
                self.steps.push("event:closed");
                self.events.push(event);
            }
            TerminalOutputKind::AgentSignal => {
                self.steps.push("event:agentSignal");
                self.events.push(event);
            }
            TerminalOutputKind::Error => {
                self.steps.push("event:error");
                self.events.push(event);
            }
        }
        true
    }
}

#[derive(Clone, Copy)]
struct BaselineCase {
    name: &'static str,
    total_bytes: usize,
    chunk_bytes: usize,
}

struct BaselineResult {
    data_events: u64,
    max_pending_bytes: usize,
    tail: String,
    terminal_kinds: Vec<TerminalOutputKind>,
    total_data_bytes: u64,
}

fn run_baseline(case: BaselineCase) -> BaselineResult {
    let mut pump = PtyOutputPump::new(SESSION_ID, PtyOutputPumpConfig::default());
    let mut sink = CountingSink::default();
    let full_chunk = "x".repeat(case.chunk_bytes);
    let mut remaining = case.total_bytes;

    while remaining > 0 {
        let take = remaining.min(case.chunk_bytes);
        assert!(pump.push_data(&full_chunk[..take], &mut sink));
        remaining -= take;
    }
    assert!(pump.finish_closed(&mut sink));

    let stats = pump.stats().clone();
    BaselineResult {
        data_events: stats.data_events,
        max_pending_bytes: stats.max_pending_bytes,
        tail: sink.tail,
        terminal_kinds: sink.terminal_kinds,
        total_data_bytes: sink.total_data_bytes,
    }
}

#[derive(Default)]
struct CountingSink {
    tail: String,
    terminal_kinds: Vec<TerminalOutputKind>,
    total_data_bytes: u64,
}

impl PtyOutputSink for CountingSink {
    fn on_terminal_output(&mut self, event: TerminalOutputEvent) -> bool {
        match event.kind {
            TerminalOutputKind::Data => {
                self.total_data_bytes = self
                    .total_data_bytes
                    .saturating_add(event.data.len() as u64);
                self.tail.push_str(&event.data);
                if self.tail.len() > 64 {
                    self.tail = self.tail[self.tail.len() - 64..].to_owned();
                }
            }
            TerminalOutputKind::AgentSignal
            | TerminalOutputKind::Closed
            | TerminalOutputKind::Error => {
                self.terminal_kinds.push(event.kind);
            }
        }
        true
    }
}

fn test_config(flush_bytes: usize, max_pending_bytes: usize) -> PtyOutputPumpConfig {
    PtyOutputPumpConfig {
        flush_bytes,
        max_pending_bytes,
        overflow_notice: "NOTICE\n".to_owned(),
    }
}

fn data_events(events: &[TerminalOutputEvent]) -> Vec<&str> {
    events
        .iter()
        .filter(|event| event.kind == TerminalOutputKind::Data)
        .map(|event| event.data.as_str())
        .collect()
}

fn terminal_kinds(events: &[TerminalOutputEvent]) -> Vec<TerminalOutputKind> {
    events
        .iter()
        .filter(|event| event.kind != TerminalOutputKind::Data)
        .map(|event| event.kind.clone())
        .collect()
}
