import { describe, expect, it } from "vitest";
import {
  createRuntimePerformanceSnapshot,
  createRuntimeTerminalOutputPaneSnapshot,
  findRuntimePerformanceSnapshotSensitiveKeys,
  isSensitiveRuntimeDiagnosticsKey,
  RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION,
  type RuntimePerformanceSnapshot,
} from "../../../../src/features/terminal/terminalRuntimeDiagnostics";

describe("terminalRuntimeDiagnostics", () => {
  it("creates a versioned runtime performance snapshot", () => {
    const snapshot = createRuntimePerformanceSnapshot({
      generatedAt: "2026-07-01T15:20:00.000Z",
      terminalRenderer: {
        activeControllers: 2,
        effectiveGpuPanes: 1,
        hiddenControllers: 1,
        panes: [
          {
            backend: "gpu",
            canvasCount: 1,
            failureCount: 0,
            focused: true,
            paneId: "pane-1",
            visible: true,
          },
        ],
        requestedMode: "auto",
        webglCanvasCount: 1,
      },
      terminalOutput: {
        panes: [
          {
            coldSnapshotChars: 2048,
            droppedTailChars: 0,
            flushCount: 12,
            focused: true,
            historyFlushCount: 4,
            paneId: "pane-1",
            pendingBytes: 0,
            pendingChars: 0,
            pendingChunks: 0,
            runtimeWorkMode: "full",
            slowFlushCount: 0,
            storeUpdateCount: 3,
            tailChars: 4096,
            truncatedTail: false,
            visible: true,
            writerFlushCount: 8,
          },
        ],
        totalColdSnapshotChars: 2048,
        totalPendingBytes: 0,
      },
    });

    expect(snapshot.schemaVersion).toBe(
      RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION,
    );
    expect(snapshot.generatedAt).toBe("2026-07-01T15:20:00.000Z");
    expect(snapshot.terminalRenderer?.effectiveGpuPanes).toBe(1);
    expect(findRuntimePerformanceSnapshotSensitiveKeys(snapshot)).toEqual([]);
  });

  it("builds terminal output pane snapshots from writer and history metrics", () => {
    const pane = createRuntimeTerminalOutputPaneSnapshot({
      focused: false,
      historyStats: {
        appendCount: 5,
        appendedChars: 96,
        coldSnapshotChars: 64,
        droppedTailChars: 32,
        flushCount: 2,
        lastFlushMs: 14,
        lastSlowFlushAt: 124,
        manualFlushCount: 1,
        maxFlushMs: 14,
        pendingFlush: true,
        pendingSnapshotChars: 48,
        runtimeBufferStats: {
          chunkCount: 3,
          maxChars: 128,
          totalChars: 96,
          truncatedChars: 32,
        },
        scheduledFlushCount: 1,
        skippedUnchangedSnapshotCount: 1,
        slowFlushCount: 1,
        storeUpdateCount: 1,
        tailChars: 96,
        truncatedTail: true,
      },
      paneId: "pane-1",
      runtimeWorkMode: "visible-degraded",
      visible: true,
      writerStats: {
        flushCount: 3,
        lastFlushChars: 42,
        lastFlushMs: 7,
        lastSlowFlushAt: 118,
        maxFlushMs: 11,
        pendingBytes: 42,
        pendingChars: 42,
        pendingChunks: 2,
        slowFlushCount: 1,
        splitFrameCount: 1,
        totalFlushChars: 512,
        writeNowCount: 1,
      },
    });

    expect(pane).toMatchObject({
      coldSnapshotChars: 64,
      droppedTailChars: 32,
      flushCount: 5,
      historyFlushCount: 2,
      lastFlushMs: 14,
      lastSlowFlushAt: 124,
      maxFlushMs: 14,
      pendingBytes: 42,
      pendingChars: 42,
      pendingChunks: 2,
      slowFlushCount: 2,
      storeUpdateCount: 1,
      tailChars: 96,
      truncatedTail: true,
      writerFlushCount: 3,
    });
    expect(findRuntimePerformanceSnapshotSensitiveKeys(pane)).toEqual([]);
    expect(JSON.stringify(pane)).not.toContain("visible output");
  });

  it("keeps all planned diagnostic sections expressible without raw output", () => {
    const snapshot: RuntimePerformanceSnapshot = createRuntimePerformanceSnapshot({
      generatedAt: "2026-07-01T15:21:00.000Z",
      configWatcher: {
        diagnostics: [
          {
            fileKind: "settings",
            key: "terminal.rendererType",
            line: 12,
            reason: "invalid enum value",
            severity: "warning",
          },
        ],
        invalidFileCount: 1,
      },
      degraded: [
        {
          disabledReason: "hidden-pane",
          effectiveMode: "hidden-tail-only",
          enabled: false,
          retryAfterMs: 30_000,
          system: "suggestions",
        },
      ],
      ptyPump: {
        sessions: [
          {
            bufferedChunks: 3,
            closed: false,
            coalescedChunks: 20,
            finalFlushCount: 0,
            flushCount: 4,
            maxPendingBytes: 65536,
            maxPendingHitCount: 1,
            pendingBytes: 1024,
            sessionId: "session-1",
          },
        ],
        totalPendingBytes: 1024,
      },
      sftp: {
        preflight: {
          active: 2,
          cancelRequested: false,
          completed: 10,
          concurrencyLimit: 8,
          failed: 1,
          queued: 5,
        },
        transfers: {
          activeTransfers: 1,
          failedRecent: 2,
          prunedCompleted: 100,
          recentCompleted: 50,
        },
      },
      ssh: {
        activeConnections: 2,
        errorClasses: {
          "auth-failed": 1,
          "network-unreachable": 1,
        },
        failedRecent: 2,
        reconnecting: 1,
      },
      suggestions: {
        activeTasks: 3,
        disabledReasons: {
          "hidden-pane": 2,
        },
        inFlight: 1,
        maxConcurrent: 2,
        queued: 2,
        tasks: [
          {
            failureCount: 0,
            inFlight: false,
            kind: "remotePath",
            ownerCount: 1,
            timerPending: true,
          },
        ],
      },
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.sftp?.preflight?.concurrencyLimit).toBe(8);
    expect(snapshot.configWatcher?.diagnostics[0]?.fileKind).toBe("settings");
    expect(findRuntimePerformanceSnapshotSensitiveKeys(snapshot)).toEqual([]);
  });

  it("detects keys that would leak raw output, paths, or credentials", () => {
    expect(isSensitiveRuntimeDiagnosticsKey("stdout")).toBe(true);
    expect(isSensitiveRuntimeDiagnosticsKey("terminalOutput")).toBe(false);

    expect(
      findRuntimePerformanceSnapshotSensitiveKeys({
        nested: {
          password: "secret",
          remotePath: "/srv/private",
        },
        stdout: "full terminal output",
        terminalOutput: {
          totalPendingBytes: 0,
        },
      }),
    ).toEqual(["nested.password", "nested.remotePath", "stdout"]);
  });
});
