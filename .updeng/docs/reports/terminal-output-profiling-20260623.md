# Terminal Output Profiling Report 20260623

## Scope

- TASK: TASK-002 terminal large output profiling report.
- Non-goal: no runtime behavior change, no terminal/workspace/machine-sidebar code edits, no output ordering or side effect semantics changes.
- Generated at: 2026-06-23T14:24:04.857Z.
- Input baseline: `.updeng/docs/verification/terminal-output-baseline.json`.
- Performance baseline: `.updeng/docs/verification/performance-baseline-20260623.json`.

## Scenario Input

| Field | Value |
| --- | --- |
| scenarios | `plain`, `osc`, `long-line`, `mixed` |
| chunks | 400 |
| chunkSize | 4,096 chars |
| maxCharsPerFlush | 65,536 chars |
| viewport | 1280x860 |
| total input | 8,215,886 chars across 4 scenarios |

## Scenario Metrics

| Scenario | Input chars | writeCallback p95 / max | frame gap p95 / max | long tasks | sideEffects counts |
| --- | ---: | ---: | ---: | ---: | --- |
| plain | 1,638,400 | 6.90 ms / 12.60 ms | 16.70 ms / 16.70 ms | 0 count, max 0.00 ms | cwd 0, prewarm 0, history flush 8, tail 20,000 |
| osc | 1,653,890 | 6.10 ms / 6.60 ms | 16.70 ms / 16.70 ms | 0 count, max 0.00 ms | cwd 400, prewarm 400, history flush 8, tail 20,000 |
| long-line | 3,282,000 | 6.50 ms / 6.90 ms | 16.70 ms / 16.70 ms | 0 count, max 0.00 ms | cwd 0, prewarm 0, history flush 8, tail 20,000 |
| mixed | 1,641,596 | 6.40 ms / 6.90 ms | 16.70 ms / 16.70 ms | 0 count, max 0.00 ms | cwd 40, prewarm 40, history flush 8, tail 20,000 |

## Initial Judgment

- Current baseline pass: yes.
- Worst write callback p95: plain 6.90 ms; worst max: plain 12.60 ms.
- Worst frame gap: long-line 16.70 ms; long task ceiling: plain 0.00 ms.
- Side effect pressure is visible in counts before runtime instrumentation: cwd OSC paths 440, remote prewarm schedules 440, history flushes 32, command block tail cap 20,000 chars.
- The current harness measures real xterm write callback and simulated side effect costs. It does not yet prove the cost distribution inside `XtermPane.runtime.ts` `handleOutput`, so optimization should wait for TASK-006 targeted instrumentation or a behavior-preserving model test.

## TASK-006 Candidates

- Add temporary, feature-flagged measurement around `handleOutput` substeps before changing behavior.
- Fast-path cwd OSC parsing so ordinary output skips regex work unless an OSC marker is present.
- Coalesce remote suggestion prewarm scheduling on cwd changes; OSC scenario currently produces one schedule per cwd sequence.
- Evaluate command block append batching, but only with marker range tests that prove command block color bars remain correct.
- Evaluate pending-chunk history buffering only if synchronous `outputHistoryRef.current` visibility can be preserved.

## Explicit No-Behavior-Change Contract

- This report generator only reads JSON baselines and writes a Markdown report.
- It does not import app runtime modules, start Vite/Tauri, modify xterm handling, change store updates, or alter terminal output ordering.
- Any future TASK-006 optimization must keep terminal output order, cwd sync, command block markers, ghost suggestion prewarm semantics, close/reconnect messages, and history visibility stable.

## Source Summary

- Terminal baseline generated at: 2026-06-23T12:22:11.725Z.
- Environment: Node v22.22.0, xterm 6.0.0.
- Git baseline: branch main, commit 160ccca5, dirty true.

