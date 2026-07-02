import {
  refreshTerminalGitSuggestions,
  refreshTerminalRemoteCommandSuggestions,
  refreshTerminalRemoteHistorySuggestions,
  refreshTerminalRemotePathSuggestions,
  type CommandSuggestionGitRefreshRequest,
  type CommandSuggestionGitRefreshResult,
  type CommandSuggestionRemoteCommandRefreshRequest,
  type CommandSuggestionRemoteCommandRefreshResult,
  type CommandSuggestionRemoteHistoryRefreshRequest,
  type CommandSuggestionRemoteHistoryRefreshResult,
  type CommandSuggestionRemotePathRefreshRequest,
  type CommandSuggestionRemotePathRefreshResult,
} from "../../lib/terminalSuggestionApi";
import type { RuntimeSuggestionSchedulerSnapshot } from "./terminalRuntimeDiagnostics";
import {
  TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG,
  type TerminalSuggestionProbeDisabledReason,
} from "./terminalSuggestionProbePolicy";

type ProbeKind = "git" | "remoteCommand" | "remoteHistory" | "remotePath";
type TimerId = ReturnType<typeof globalThis.setTimeout>;

interface SchedulerClock {
  clearTimeout: (timerId: TimerId) => void;
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimerId;
}

interface SchedulerApi {
  refreshGit: (
    request: CommandSuggestionGitRefreshRequest,
  ) => Promise<CommandSuggestionGitRefreshResult>;
  refreshRemoteCommand: (
    request: CommandSuggestionRemoteCommandRefreshRequest,
  ) => Promise<CommandSuggestionRemoteCommandRefreshResult>;
  refreshRemoteHistory: (
    request: CommandSuggestionRemoteHistoryRefreshRequest,
  ) => Promise<CommandSuggestionRemoteHistoryRefreshResult>;
  refreshRemotePath: (
    request: CommandSuggestionRemotePathRefreshRequest,
  ) => Promise<CommandSuggestionRemotePathRefreshResult>;
}

interface SchedulerOptions {
  api?: Partial<SchedulerApi>;
  clock?: Partial<SchedulerClock>;
  maxConcurrent?: number;
  slowProbeMs?: number;
}

interface BaseProbeRequest {
  delayMs?: number;
  hostId: string;
  ownerId: string;
}

export interface RemoteCommandProbeRequest
  extends BaseProbeRequest,
    CommandSuggestionRemoteCommandRefreshRequest {}

export interface RemoteHistoryProbeRequest
  extends BaseProbeRequest,
    CommandSuggestionRemoteHistoryRefreshRequest {}

export interface RemotePathProbeRequest
  extends BaseProbeRequest,
    CommandSuggestionRemotePathRefreshRequest {}

export interface GitProbeRequest
  extends BaseProbeRequest,
    CommandSuggestionGitRefreshRequest {}

interface ProbeTask {
  failureCount: number;
  inFlight: boolean;
  key: string;
  kind: ProbeKind;
  lastDurationMs?: number;
  nextAllowedAt: number;
  owners: Set<string>;
  request:
    | GitProbeRequest
    | RemoteCommandProbeRequest
    | RemoteHistoryProbeRequest
    | RemotePathProbeRequest;
  slowCount: number;
  timerId: TimerId | null;
}

const DEFAULT_DELAY_MS: Record<ProbeKind, number> = {
  git: 750,
  remoteCommand: 500,
  remoteHistory: 650,
  remotePath: 250,
};
const DEFAULT_TTL_SECONDS: Record<ProbeKind, number> = {
  git: 60,
  remoteCommand: 300,
  remoteHistory: 900,
  remotePath: 30,
};
const MAX_BACKOFF_MS = 30_000;
const RETRY_CONCURRENCY_DELAY_MS = 250;

export class TerminalSuggestionProbeScheduler {
  private readonly api: SchedulerApi;
  private readonly clock: SchedulerClock;
  private readonly maxConcurrent: number;
  private readonly ownerDisabledReasons = new Map<
    string,
    TerminalSuggestionProbeDisabledReason
  >();
  private readonly slowProbeMs: number;
  private inFlightCount = 0;
  private readonly tasks = new Map<string, ProbeTask>();

  constructor(options: SchedulerOptions = {}) {
    this.api = {
      refreshGit: refreshTerminalGitSuggestions,
      refreshRemoteCommand: refreshTerminalRemoteCommandSuggestions,
      refreshRemoteHistory: refreshTerminalRemoteHistorySuggestions,
      refreshRemotePath: refreshTerminalRemotePathSuggestions,
      ...options.api,
    };
    this.clock = {
      clearTimeout: (timerId) => globalThis.clearTimeout(timerId),
      now: () => Date.now(),
      setTimeout: (callback, delayMs) =>
        globalThis.setTimeout(callback, delayMs),
      ...options.clock,
    };
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
    this.slowProbeMs = Math.max(
      0,
      options.slowProbeMs ??
        TERMINAL_SUGGESTION_PROBE_POLICY_DEFAULT_CONFIG.slowProbeMs,
    );
  }

  scheduleRemoteCommand(request: RemoteCommandProbeRequest) {
    return this.schedule("remoteCommand", request);
  }

  scheduleRemoteHistory(request: RemoteHistoryProbeRequest) {
    return this.schedule("remoteHistory", request);
  }

  scheduleRemotePath(request: RemotePathProbeRequest) {
    return this.schedule("remotePath", request);
  }

  scheduleGit(request: GitProbeRequest) {
    return this.schedule("git", request);
  }

  cancelOwner(ownerId: string) {
    for (const task of Array.from(this.tasks.values())) {
      if (!task.owners.delete(ownerId)) {
        continue;
      }
      this.pruneTaskIfIdle(task);
    }
  }

  setOwnerDisabled(
    ownerId: string,
    reason: TerminalSuggestionProbeDisabledReason | null,
  ) {
    if (!reason) {
      this.ownerDisabledReasons.delete(ownerId);
      return;
    }
    this.ownerDisabledReasons.set(ownerId, reason);
    this.cancelOwner(ownerId);
  }

  reset() {
    for (const task of this.tasks.values()) {
      if (task.timerId !== null) {
        this.clock.clearTimeout(task.timerId);
      }
    }
    this.tasks.clear();
    this.ownerDisabledReasons.clear();
    this.inFlightCount = 0;
  }

  snapshot() {
    return Array.from(this.tasks.values()).map((task) => ({
      failureCount: task.failureCount,
      inFlight: task.inFlight,
      key: task.key,
      kind: task.kind,
      lastDurationMs: task.lastDurationMs,
      nextAllowedAt: task.nextAllowedAt,
      ownerCount: task.owners.size,
      slowCount: task.slowCount,
      timerPending: task.timerId !== null,
    }));
  }

  diagnosticsSnapshot(
    now = this.clock.now(),
  ): RuntimeSuggestionSchedulerSnapshot {
    const disabledReasons: Record<string, number> = {};
    for (const reason of this.ownerDisabledReasons.values()) {
      incrementRecord(disabledReasons, reason);
    }
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      if (task.failureCount > 0 && task.nextAllowedAt > now) {
        incrementRecord(disabledReasons, "failure-backoff");
      }
      if (
        task.lastDurationMs !== undefined &&
        task.lastDurationMs >= this.slowProbeMs
      ) {
        incrementRecord(disabledReasons, "slow-probe");
      }
    }

    return {
      activeTasks: tasks.length,
      disabledReasons,
      inFlight: this.inFlightCount,
      maxConcurrent: this.maxConcurrent,
      queued: tasks.filter(
        (task) =>
          task.timerId !== null || (!task.inFlight && task.nextAllowedAt > now),
      ).length,
      tasks: tasks.map((task) => ({
        failureCount: task.failureCount,
        inFlight: task.inFlight,
        kind: task.kind,
        nextAllowedInMs:
          task.nextAllowedAt > now ? task.nextAllowedAt - now : undefined,
        ownerCount: task.owners.size,
        timerPending: task.timerId !== null,
      })),
    };
  }

  private schedule(
    kind: ProbeKind,
    request:
      | GitProbeRequest
      | RemoteCommandProbeRequest
      | RemoteHistoryProbeRequest
      | RemotePathProbeRequest,
  ) {
    if (this.ownerDisabledReasons.has(request.ownerId)) {
      return false;
    }
    const key = probeTaskKey(kind, request);
    this.removeOwnerFromOtherTasks(request.ownerId, kind, key);
    const now = this.clock.now();
    const task = this.tasks.get(key) ?? {
      failureCount: 0,
      inFlight: false,
      key,
      kind,
      lastDurationMs: undefined,
      nextAllowedAt: 0,
      owners: new Set<string>(),
      request,
      slowCount: 0,
      timerId: null,
    };
    task.owners.add(request.ownerId);
    task.request = request;
    this.tasks.set(key, task);

    if (task.inFlight || task.timerId !== null || now < task.nextAllowedAt) {
      return false;
    }

    task.timerId = this.clock.setTimeout(
      () => this.runTask(key),
      request.delayMs ?? DEFAULT_DELAY_MS[kind],
    );
    return true;
  }

  private runTask(key: string) {
    const task = this.tasks.get(key);
    if (!task) {
      return;
    }
    task.timerId = null;
    if (task.owners.size === 0) {
      this.pruneTaskIfIdle(task);
      return;
    }
    if (this.inFlightCount >= this.maxConcurrent) {
      task.timerId = this.clock.setTimeout(
        () => this.runTask(key),
        RETRY_CONCURRENCY_DELAY_MS,
      );
      return;
    }

    task.inFlight = true;
    this.inFlightCount += 1;
    const startedAt = this.clock.now();
    this.performTask(task)
      .then(() => {
        task.failureCount = 0;
        task.nextAllowedAt = this.clock.now() + taskTtlMs(task);
      })
      .catch(() => {
        task.failureCount = task.failureCount + 1;
        task.nextAllowedAt =
          this.clock.now() + failureBackoffMs(task.failureCount);
      })
      .finally(() => {
        task.lastDurationMs = Math.max(0, this.clock.now() - startedAt);
        if (task.lastDurationMs >= this.slowProbeMs) {
          task.slowCount += 1;
        }
        task.inFlight = false;
        this.inFlightCount = Math.max(0, this.inFlightCount - 1);
        this.pruneTaskIfIdle(task);
      });
  }

  private performTask(task: ProbeTask) {
    if (task.kind === "git") {
      const { delayMs: _delayMs, ownerId: _ownerId, ...request } =
        task.request as GitProbeRequest;
      return this.api.refreshGit(request);
    }
    if (task.kind === "remoteCommand") {
      const { delayMs: _delayMs, ownerId: _ownerId, ...request } =
        task.request as RemoteCommandProbeRequest;
      return this.api.refreshRemoteCommand(request);
    }
    if (task.kind === "remoteHistory") {
      const { delayMs: _delayMs, ownerId: _ownerId, ...request } =
        task.request as RemoteHistoryProbeRequest;
      return this.api.refreshRemoteHistory(request);
    }
    const { delayMs: _delayMs, ownerId: _ownerId, ...request } =
      task.request as RemotePathProbeRequest;
    return this.api.refreshRemotePath(request);
  }

  private removeOwnerFromOtherTasks(
    ownerId: string,
    kind: ProbeKind,
    keepKey: string,
  ) {
    for (const task of this.tasks.values()) {
      if (task.kind !== kind || task.key === keepKey) {
        continue;
      }
      if (task.owners.delete(ownerId)) {
        this.pruneTaskIfIdle(task);
      }
    }
  }

  private pruneTaskIfIdle(task: ProbeTask) {
    if (task.owners.size > 0 || task.inFlight) {
      return;
    }
    if (task.timerId !== null) {
      this.clock.clearTimeout(task.timerId);
    }
    if (this.tasks.get(task.key) === task) {
      this.tasks.delete(task.key);
    }
  }
}

export const terminalSuggestionProbeScheduler =
  new TerminalSuggestionProbeScheduler();

function probeTaskKey(
  kind: ProbeKind,
  request:
    | GitProbeRequest
    | RemoteCommandProbeRequest
    | RemoteHistoryProbeRequest
    | RemotePathProbeRequest,
) {
  if (kind === "remoteCommand" || kind === "remoteHistory") {
    return `${kind}:${request.hostId}`;
  }
  if (kind === "remotePath") {
    return `${kind}:${request.hostId}:${(request as RemotePathProbeRequest).path}`;
  }
  return `${kind}:${request.hostId}:${(request as GitProbeRequest).cwd}`;
}

function taskTtlMs(task: ProbeTask) {
  const ttlSeconds =
    task.request.ttlSeconds ?? DEFAULT_TTL_SECONDS[task.kind];
  return Math.max(1, ttlSeconds) * 1000;
}

function failureBackoffMs(failureCount: number) {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failureCount - 1));
}

function incrementRecord(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}
