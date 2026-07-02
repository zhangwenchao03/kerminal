import type { TerminalPtyOutputPumpStats } from "../../lib/terminalApi";
import { getTerminalPtyOutputPumpStats } from "../../lib/terminalApi";
import { getSftpRuntimeDiagnosticsSnapshot } from "../sftp/sftpRuntimeDiagnostics";
import { terminalRendererRegistry } from "./terminalRendererRegistry";
import {
  createRuntimePerformanceSnapshot,
  createRuntimeTerminalOutputPaneSnapshot,
  type RuntimeDiagnosticsDegradeState,
  type RuntimePerformanceSnapshot,
  type RuntimePtyPumpSessionSnapshot,
  type RuntimeSuggestionSchedulerSnapshot,
  type RuntimeTerminalOutputPaneSnapshotInput,
} from "./terminalRuntimeDiagnostics";
import type { SshTerminalFailure } from "./terminalSshFailurePolicy";

export interface TerminalReconnectRuntimeDiagnostics {
  reconnecting: boolean;
  sshReconnectAttempt: number;
}

export interface TerminalRuntimeDiagnosticsPaneProviderSnapshot
  extends RuntimeTerminalOutputPaneSnapshotInput {
  sessionId?: string;
  sshFailure?: SshTerminalFailure;
  sshReconnect?: TerminalReconnectRuntimeDiagnostics;
  sshTarget?: boolean;
}

export interface TerminalRuntimeDiagnosticsPaneProvider {
  getSnapshot(): TerminalRuntimeDiagnosticsPaneProviderSnapshot;
}

type PtyPumpStatsReader = (
  sessionId: string,
) => Promise<TerminalPtyOutputPumpStats>;
type SuggestionSnapshotReader = () => Promise<RuntimeSuggestionSchedulerSnapshot>;

const paneProviders = new Set<TerminalRuntimeDiagnosticsPaneProvider>();
const listeners = new Set<() => void>();

export function registerTerminalRuntimeDiagnosticsPane(
  provider: TerminalRuntimeDiagnosticsPaneProvider,
) {
  paneProviders.add(provider);
  emitChange();
  return () => {
    paneProviders.delete(provider);
    emitChange();
  };
}

export function subscribeTerminalRuntimeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTerminalRuntimeDiagnosticsProviderCount() {
  return paneProviders.size;
}

export async function collectTerminalRuntimePerformanceSnapshot({
  generatedAt,
  readPtyPumpStats = getTerminalPtyOutputPumpStats,
  readSuggestionSnapshot = readTerminalSuggestionDiagnosticsSnapshot,
}: {
  generatedAt?: string;
  readPtyPumpStats?: PtyPumpStatsReader;
  readSuggestionSnapshot?: SuggestionSnapshotReader;
} = {}): Promise<RuntimePerformanceSnapshot> {
  const paneSnapshots = Array.from(paneProviders, (provider) =>
    provider.getSnapshot(),
  );
  const terminalOutputPanes = paneSnapshots.map((snapshot) =>
    createRuntimeTerminalOutputPaneSnapshot(snapshot),
  );
  const ptyPumpSessions = await collectPtyPumpSessions(
    paneSnapshots,
    readPtyPumpStats,
  );
  const suggestions = await readSuggestionSnapshot();
  const degraded = collectDegradedStates(paneSnapshots, suggestions);

  return createRuntimePerformanceSnapshot({
    degraded,
    generatedAt,
    ptyPump: {
      sessions: ptyPumpSessions,
      totalPendingBytes: ptyPumpSessions.reduce(
        (sum, session) => sum + session.pendingBytes,
        0,
      ),
    },
    sftp: getSftpRuntimeDiagnosticsSnapshot(),
    ssh: createSshRuntimeSnapshot(paneSnapshots),
    suggestions,
    terminalOutput: {
      panes: terminalOutputPanes,
      storeUpdateCount: terminalOutputPanes.reduce(
        (sum, pane) => sum + (pane.storeUpdateCount ?? 0),
        0,
      ),
      totalColdSnapshotChars: terminalOutputPanes.reduce(
        (sum, pane) => sum + pane.coldSnapshotChars,
        0,
      ),
      totalPendingBytes: terminalOutputPanes.reduce(
        (sum, pane) => sum + pane.pendingBytes,
        0,
      ),
    },
    terminalRenderer: terminalRendererRegistry.getSnapshot(),
  });
}

export function resetTerminalRuntimeDiagnosticsForTests() {
  paneProviders.clear();
  emitChange();
}

async function collectPtyPumpSessions(
  paneSnapshots: TerminalRuntimeDiagnosticsPaneProviderSnapshot[],
  readPtyPumpStats: PtyPumpStatsReader,
): Promise<RuntimePtyPumpSessionSnapshot[]> {
  const sessionIds = [
    ...new Set(
      paneSnapshots
        .map((snapshot) => snapshot.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  ];
  const settled = await Promise.allSettled(sessionIds.map(readPtyPumpStats));
  return settled.flatMap((result) =>
    result.status === "fulfilled"
      ? [toRuntimePtyPumpSessionSnapshot(result.value)]
      : [],
  );
}

function toRuntimePtyPumpSessionSnapshot(
  stats: TerminalPtyOutputPumpStats,
): RuntimePtyPumpSessionSnapshot {
  return {
    bufferedChunks: stats.bufferedChunks,
    closed: stats.finished,
    coalescedChunks: stats.coalescedChunks,
    finalFlushCount: stats.finalTailFlushCount,
    flushCount: stats.flushCount,
    lastFlushMs: stats.lastFlushIntervalMs,
    maxPendingBytes: stats.maxPendingBytes,
    maxPendingHitCount: stats.maxPendingHitCount,
    pendingBytes: stats.pendingBytes,
    sessionId: stats.sessionId,
  };
}

function createSshRuntimeSnapshot(
  paneSnapshots: TerminalRuntimeDiagnosticsPaneProviderSnapshot[],
) {
  const sshPanes = paneSnapshots.filter((snapshot) => snapshot.sshTarget);
  const errorClasses: Record<string, number> = {};
  for (const snapshot of sshPanes) {
    const failureClass = snapshot.sshFailure?.class;
    if (failureClass) {
      errorClasses[failureClass] = (errorClasses[failureClass] ?? 0) + 1;
    }
  }
  return {
    activeConnections: sshPanes.filter((snapshot) => snapshot.sessionId).length,
    errorClasses,
    failedRecent: Object.values(errorClasses).reduce(
      (sum, count) => sum + count,
      0,
    ),
    reconnecting: sshPanes.filter(
      (snapshot) => snapshot.sshReconnect?.reconnecting,
    ).length,
  };
}

function collectDegradedStates(
  paneSnapshots: TerminalRuntimeDiagnosticsPaneProviderSnapshot[],
  suggestions: RuntimeSuggestionSchedulerSnapshot,
): RuntimeDiagnosticsDegradeState[] {
  const degraded: RuntimeDiagnosticsDegradeState[] = [];
  for (const snapshot of paneSnapshots) {
    if (snapshot.runtimeWorkMode !== "full") {
      degraded.push({
        disabledReason: snapshot.runtimeWorkMode,
        effectiveMode: snapshot.runtimeWorkMode,
        enabled: true,
        system: "terminal-output",
      });
    }
  }
  for (const [reason, count] of Object.entries(suggestions.disabledReasons)) {
    if (count <= 0) {
      continue;
    }
    degraded.push({
      disabledReason: reason,
      effectiveMode: "deferred",
      enabled: false,
      system: "suggestions",
    });
  }
  return degraded;
}

async function readTerminalSuggestionDiagnosticsSnapshot() {
  try {
    const { terminalSuggestionProbeScheduler } = await import(
      "./terminalSuggestionProbeScheduler"
    );
    return terminalSuggestionProbeScheduler.diagnosticsSnapshot();
  } catch {
    return {
      activeTasks: 0,
      disabledReasons: {},
      inFlight: 0,
      maxConcurrent: 0,
      queued: 0,
      tasks: [],
    };
  }
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}
