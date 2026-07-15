import {
  getManagedSshRuntimeSnapshot,
  type ManagedSshRuntimeSnapshot,
} from "../../lib/diagnosticsApi";
import type { TerminalPtyOutputPumpStats } from "../../lib/terminalApi";
import { getTerminalPtyOutputPumpStats } from "../../lib/terminalApi";
import { getSftpRuntimeDiagnosticsSnapshot } from "../sftp/runtime/index";
import { terminalRendererRegistry } from "./terminalRendererRegistry";
import { terminalChromeRuntimeStore } from "./terminalChromeRuntimeStore";
import {
  createRuntimePerformanceSnapshot,
  createRuntimeTerminalOutputPaneSnapshot,
  type RuntimeDiagnosticsDegradeState,
  type RuntimePerformanceSnapshot,
  type RuntimePtyPumpSessionSnapshot,
  type RuntimeSftpSnapshot,
  type RuntimeSuggestionSchedulerSnapshot,
  type RuntimeTerminalOutputPaneSnapshotInput,
} from "./terminalRuntimeDiagnostics";
import type { SshTerminalFailure } from "./terminalSshFailurePolicy";
import { runtimeCompatibilityDiagnostics } from "../../platform/runtime/compatibilityDiagnostics";

interface TerminalReconnectRuntimeDiagnostics {
  reconnecting: boolean;
  sshReconnectAttempt: number;
}

interface TerminalRuntimeDiagnosticsPaneProviderSnapshot
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
type ManagedSshSnapshotReader = () => Promise<
  ManagedSshRuntimeSnapshot | undefined
>;
type SuggestionSnapshotReader = () => Promise<RuntimeSuggestionSchedulerSnapshot>;
type SftpSnapshotReader = () => RuntimeSftpSnapshot;

export interface TerminalRuntimeDiagnosticsStore {
  collect(
    options?: TerminalRuntimeDiagnosticsCollectionOptions,
  ): Promise<RuntimePerformanceSnapshot>;
  getProviderCount(): number;
  register(provider: TerminalRuntimeDiagnosticsPaneProvider): () => void;
  subscribe(listener: () => void): () => void;
}

interface TerminalRuntimeDiagnosticsCollectionOptions {
  generatedAt?: string;
  readManagedSshSnapshot?: ManagedSshSnapshotReader;
  readPtyPumpStats?: PtyPumpStatsReader;
  readSftpSnapshot?: SftpSnapshotReader;
  readSuggestionSnapshot?: SuggestionSnapshotReader;
}

/** 创建实例级诊断注册表，避免测试与多窗口生命周期共享 provider。 */
export function createTerminalRuntimeDiagnosticsStore(): TerminalRuntimeDiagnosticsStore {
  const paneProviders = new Set<TerminalRuntimeDiagnosticsPaneProvider>();
  const listeners = new Set<() => void>();
  const emitChange = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    collect: (options) =>
      collectTerminalRuntimePerformanceSnapshotFrom(paneProviders, options),
    getProviderCount: () => paneProviders.size,
    register(provider) {
      paneProviders.add(provider);
      emitChange();
      return () => {
        paneProviders.delete(provider);
        emitChange();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const defaultTerminalRuntimeDiagnosticsStore =
  createTerminalRuntimeDiagnosticsStore();

export function registerTerminalRuntimeDiagnosticsPane(
  provider: TerminalRuntimeDiagnosticsPaneProvider,
) {
  return defaultTerminalRuntimeDiagnosticsStore.register(provider);
}

async function collectTerminalRuntimePerformanceSnapshotFrom(
  paneProviders: ReadonlySet<TerminalRuntimeDiagnosticsPaneProvider>,
  {
    generatedAt,
    readManagedSshSnapshot = readManagedSshRuntimeDiagnosticsSnapshot,
    readPtyPumpStats = getTerminalPtyOutputPumpStats,
    readSftpSnapshot = getSftpRuntimeDiagnosticsSnapshot,
    readSuggestionSnapshot = readTerminalSuggestionDiagnosticsSnapshot,
  }: TerminalRuntimeDiagnosticsCollectionOptions = {},
): Promise<RuntimePerformanceSnapshot> {
  const paneSnapshots = Array.from(paneProviders, (provider) =>
    provider.getSnapshot(),
  );
  const terminalOutputPanes = paneSnapshots.map((snapshot) =>
    createRuntimeTerminalOutputPaneSnapshot(snapshot),
  );
  const managedSsh = await readManagedSshSnapshot();
  const ptyPumpSessions = await collectPtyPumpSessions(
    paneSnapshots,
    readPtyPumpStats,
  );
  const suggestions = await readSuggestionSnapshot();
  const degraded = collectDegradedStates(paneSnapshots, suggestions);

  return createRuntimePerformanceSnapshot({
    compatibility: runtimeCompatibilityDiagnostics.getSnapshot(),
    degraded,
    generatedAt,
    managedSsh,
    ptyPump: {
      sessions: ptyPumpSessions,
      totalPendingBytes: ptyPumpSessions.reduce(
        (sum, session) => sum + session.pendingBytes,
        0,
      ),
    },
    sftp: readSftpSnapshot(),
    ssh: createSshRuntimeSnapshot(paneSnapshots),
    suggestions,
    terminalChromeActivity: terminalChromeRuntimeStore.diagnosticsSnapshot(),
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

async function readManagedSshRuntimeDiagnosticsSnapshot() {
  try {
    return await getManagedSshRuntimeSnapshot();
  } catch {
    return undefined;
  }
}
