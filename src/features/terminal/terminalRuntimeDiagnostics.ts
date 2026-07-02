import type { TerminalRendererRegistrySnapshot } from "./terminalRendererRegistry";
import type { TerminalOutputHistoryBufferStats } from "./terminalOutputHistoryBuffer";
import type { TerminalOutputWriterStats } from "./terminalOutputWriter";

export const RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type RuntimeDiagnosticsWorkMode =
  | "full"
  | "visible-degraded"
  | "hidden-tail-only"
  | "suspended-renderer";

export type RuntimeDiagnosticsSystem =
  | "renderer"
  | "terminal-output"
  | "output-history"
  | "pty-pump"
  | "suggestions"
  | "sftp"
  | "ssh"
  | "config-watcher";

export type RuntimeDiagnosticsSeverity = "info" | "warning" | "error";

export interface RuntimeDiagnosticsDegradeState {
  disabledReason?: string;
  effectiveMode: string;
  enabled: boolean;
  lastFailureAt?: number;
  lastRecoveredAt?: number;
  retryAfterMs?: number;
  system: RuntimeDiagnosticsSystem;
}

export interface RuntimeTerminalOutputPaneSnapshot {
  coldSnapshotChars: number;
  droppedTailChars: number;
  flushCount: number;
  focused: boolean;
  historyFlushCount?: number;
  historyLastFlushMs?: number;
  historySlowFlushCount?: number;
  lastFlushMs?: number;
  lastSlowFlushAt?: number;
  maxFlushMs?: number;
  paneId: string;
  pendingBytes: number;
  pendingChars?: number;
  pendingChunks: number;
  runtimeWorkMode: RuntimeDiagnosticsWorkMode;
  slowFlushCount: number;
  storeUpdateCount?: number;
  tailChars: number;
  truncatedTail?: boolean;
  visible: boolean;
  writerFlushCount?: number;
  writerLastFlushMs?: number;
  writerSlowFlushCount?: number;
}

export interface RuntimeTerminalOutputSnapshot {
  panes: RuntimeTerminalOutputPaneSnapshot[];
  storeUpdateCount?: number;
  totalColdSnapshotChars: number;
  totalPendingBytes: number;
}

export interface RuntimePtyPumpSessionSnapshot {
  bufferedChunks: number;
  closed: boolean;
  coalescedChunks: number;
  finalFlushCount: number;
  flushCount: number;
  lastFlushMs?: number;
  maxPendingBytes: number;
  maxPendingHitCount: number;
  pendingBytes: number;
  sessionId: string;
}

export interface RuntimePtyPumpSnapshot {
  sessions: RuntimePtyPumpSessionSnapshot[];
  totalPendingBytes: number;
}

export type RuntimeSuggestionProbeKind =
  | "git"
  | "remoteCommand"
  | "remoteHistory"
  | "remotePath";

export interface RuntimeSuggestionProbeSnapshot {
  failureCount: number;
  inFlight: boolean;
  kind: RuntimeSuggestionProbeKind;
  nextAllowedInMs?: number;
  ownerCount: number;
  timerPending: boolean;
}

export interface RuntimeSuggestionSchedulerSnapshot {
  activeTasks: number;
  disabledReasons: Record<string, number>;
  inFlight: number;
  maxConcurrent: number;
  queued: number;
  tasks?: RuntimeSuggestionProbeSnapshot[];
}

export interface RuntimeSftpPreflightSnapshot {
  active: number;
  cancelRequested: boolean;
  completed: number;
  concurrencyLimit: number;
  failed: number;
  queued: number;
}

export interface RuntimeSftpTransferSnapshot {
  activeTransfers: number;
  failedRecent: number;
  prunedCompleted: number;
  recentCompleted: number;
  retryableFailedRecent?: number;
}

export interface RuntimeSftpSnapshot {
  preflight?: RuntimeSftpPreflightSnapshot;
  transfers: RuntimeSftpTransferSnapshot;
}

export interface RuntimeSshSnapshot {
  activeConnections: number;
  errorClasses: Record<string, number>;
  failedRecent: number;
  reconnecting: number;
}

export interface RuntimeConfigDiagnosticSnapshot {
  column?: number;
  fileKind:
    | "settings"
    | "profile"
    | "host"
    | "host-group"
    | "snippet"
    | "workflow"
    | "unknown";
  key?: string;
  line?: number;
  reason: string;
  severity: RuntimeDiagnosticsSeverity;
}

export interface RuntimeConfigWatcherSnapshot {
  diagnostics: RuntimeConfigDiagnosticSnapshot[];
  invalidFileCount: number;
  lastInvalidAt?: number;
  lastValidAt?: number;
}

export interface RuntimePerformanceSnapshot {
  configWatcher?: RuntimeConfigWatcherSnapshot;
  degraded?: RuntimeDiagnosticsDegradeState[];
  generatedAt: string;
  ptyPump?: RuntimePtyPumpSnapshot;
  schemaVersion: typeof RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION;
  sftp?: RuntimeSftpSnapshot;
  ssh?: RuntimeSshSnapshot;
  suggestions?: RuntimeSuggestionSchedulerSnapshot;
  terminalOutput?: RuntimeTerminalOutputSnapshot;
  terminalRenderer?: TerminalRendererRegistrySnapshot;
}

export type RuntimePerformanceSnapshotInput = Partial<
  Omit<RuntimePerformanceSnapshot, "generatedAt" | "schemaVersion">
> & {
  generatedAt?: string;
};

export interface RuntimeTerminalOutputPaneSnapshotInput {
  focused: boolean;
  historyStats?: TerminalOutputHistoryBufferStats;
  paneId: string;
  runtimeWorkMode: RuntimeDiagnosticsWorkMode;
  visible: boolean;
  writerStats?: TerminalOutputWriterStats;
}

const SENSITIVE_RUNTIME_DIAGNOSTICS_KEYS = new Set([
  "credential",
  "credentialsecret",
  "fulloutput",
  "fullpath",
  "hostpassword",
  "inlineprivatekey",
  "localpath",
  "output",
  "outputtext",
  "passphrase",
  "password",
  "privatekey",
  "rawoutput",
  "remotepath",
  "secret",
  "stderr",
  "stdout",
  "terminaltext",
  "token",
]);

export function createRuntimePerformanceSnapshot(
  input: RuntimePerformanceSnapshotInput = {},
): RuntimePerformanceSnapshot {
  const { generatedAt = new Date().toISOString(), ...sections } = input;
  return {
    schemaVersion: RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    ...sections,
  };
}

export function createRuntimeTerminalOutputPaneSnapshot({
  focused,
  historyStats,
  paneId,
  runtimeWorkMode,
  visible,
  writerStats,
}: RuntimeTerminalOutputPaneSnapshotInput): RuntimeTerminalOutputPaneSnapshot {
  const writerFlushCount = writerStats?.flushCount ?? 0;
  const historyFlushCount = historyStats?.flushCount ?? 0;
  const writerSlowFlushCount = writerStats?.slowFlushCount ?? 0;
  const historySlowFlushCount = historyStats?.slowFlushCount ?? 0;
  const snapshot: RuntimeTerminalOutputPaneSnapshot = {
    coldSnapshotChars: historyStats?.coldSnapshotChars ?? 0,
    droppedTailChars: historyStats?.droppedTailChars ?? 0,
    flushCount: writerFlushCount + historyFlushCount,
    focused,
    paneId,
    pendingBytes: writerStats?.pendingBytes ?? 0,
    pendingChars: writerStats?.pendingChars ?? 0,
    pendingChunks: writerStats?.pendingChunks ?? 0,
    runtimeWorkMode,
    slowFlushCount: writerSlowFlushCount + historySlowFlushCount,
    tailChars: historyStats?.tailChars ?? 0,
    visible,
  };

  assignOptionalNumber(snapshot, "historyFlushCount", historyFlushCount);
  assignOptionalNumber(
    snapshot,
    "historyLastFlushMs",
    historyStats?.lastFlushMs,
  );
  assignOptionalNumber(
    snapshot,
    "historySlowFlushCount",
    historySlowFlushCount,
  );
  assignOptionalNumber(
    snapshot,
    "lastFlushMs",
    maxDefinedNumber(writerStats?.lastFlushMs, historyStats?.lastFlushMs),
  );
  assignOptionalNumber(
    snapshot,
    "lastSlowFlushAt",
    maxDefinedNumber(
      writerStats?.lastSlowFlushAt,
      historyStats?.lastSlowFlushAt,
    ),
  );
  assignOptionalNumber(
    snapshot,
    "maxFlushMs",
    maxDefinedNumber(writerStats?.maxFlushMs, historyStats?.maxFlushMs),
  );
  assignOptionalNumber(
    snapshot,
    "storeUpdateCount",
    historyStats?.storeUpdateCount,
  );
  if (historyStats?.truncatedTail !== undefined) {
    snapshot.truncatedTail = historyStats.truncatedTail;
  }
  assignOptionalNumber(snapshot, "writerFlushCount", writerFlushCount);
  assignOptionalNumber(
    snapshot,
    "writerLastFlushMs",
    writerStats?.lastFlushMs,
  );
  assignOptionalNumber(
    snapshot,
    "writerSlowFlushCount",
    writerSlowFlushCount,
  );

  return snapshot;
}

export function isSensitiveRuntimeDiagnosticsKey(key: string): boolean {
  return SENSITIVE_RUNTIME_DIAGNOSTICS_KEYS.has(normalizeDiagnosticKey(key));
}

export function findRuntimePerformanceSnapshotSensitiveKeys(
  value: unknown,
): string[] {
  const hits = new Set<string>();

  const visit = (current: unknown, path: string) => {
    if (!current || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, path ? `${path}.${index}` : String(index));
      });
      return;
    }
    for (const [key, nested] of Object.entries(current)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (isSensitiveRuntimeDiagnosticsKey(key)) {
        hits.add(nextPath);
      }
      visit(nested, nextPath);
    }
  };

  visit(value, "");
  return [...hits].sort();
}

function normalizeDiagnosticKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function maxDefinedNumber(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  return Math.max(first, second);
}

function assignOptionalNumber<
  TKey extends keyof RuntimeTerminalOutputPaneSnapshot,
>(
  snapshot: RuntimeTerminalOutputPaneSnapshot,
  key: TKey,
  value: RuntimeTerminalOutputPaneSnapshot[TKey] | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    snapshot[key] = value;
  }
}
