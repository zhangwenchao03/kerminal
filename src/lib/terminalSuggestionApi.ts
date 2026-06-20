import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  listCommandHistory,
  type CommandHistoryEntry,
  type CommandHistoryTarget,
} from "./commandHistoryApi";

export type CommandSuggestionProvider =
  | "ai"
  | "git"
  | "history"
  | "remoteCommand"
  | "remotePath"
  | "spec";

export type CommandSuggestionSensitivity = "normal" | "sensitive" | "dangerous";
export type CommandSuggestionFeedbackAction = "accepted" | "dismissed";
export type CommandSuggestionAuditEventKind =
  | "feedback"
  | "remoteProbeRefresh"
  | "remoteProbeSchedule";
export type CommandSuggestionAuditDecision =
  | "allowed"
  | "failed"
  | "recorded"
  | "skipped"
  | "succeeded";

export interface CommandSuggestionReplacementRange {
  start: number;
  end: number;
}

export interface CommandSuggestionRequest {
  input: string;
  cursor: number;
  target?: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  providers?: CommandSuggestionProvider[];
  limit?: number;
}

export interface NormalizedCommandSuggestionRequest {
  input: string;
  cursor: number;
  target: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  providers?: CommandSuggestionProvider[];
  limit: number;
}

export interface CommandSuggestionCandidate {
  id: string;
  provider: CommandSuggestionProvider;
  displayText: string;
  replacementText: string;
  replacementRange: CommandSuggestionReplacementRange;
  suffix: string;
  score: number;
  sensitivity: CommandSuggestionSensitivity;
  description?: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CommandSuggestionFeedbackRecordRequest {
  action: CommandSuggestionFeedbackAction;
  provider: CommandSuggestionProvider;
  replacementText: string;
  input: string;
  target?: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  sourceId?: string;
}

export interface CommandSuggestionFeedbackRecordResult {
  recorded: boolean;
  id?: string;
  skipReason?: string;
}

export interface NormalizedCommandSuggestionFeedbackRecordRequest {
  action: CommandSuggestionFeedbackAction;
  provider: CommandSuggestionProvider;
  replacementText: string;
  input: string;
  target: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  sourceId?: string;
}

export interface CommandSuggestionProviderTelemetry {
  provider: CommandSuggestionProvider;
  queryCount: number;
  candidateCount: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
  cacheHitCount: number;
  cacheMissCount: number;
  refreshSuccessCount: number;
  refreshFailureCount: number;
  feedbackAcceptedCount: number;
  feedbackDismissedCount: number;
  feedbackSkippedCount: number;
  lastEventUnixMs?: number;
  lastError?: string;
}

export interface CommandSuggestionTelemetrySummary {
  startedAtUnixMs: number;
  generatedAtUnixMs: number;
  totalQueryCount: number;
  totalCandidateCount: number;
  providers: CommandSuggestionProviderTelemetry[];
}

export interface CommandSuggestionTelemetryExport {
  generatedAtUnixMs: number;
  runtime: CommandSuggestionTelemetrySummary;
  persisted: CommandSuggestionTelemetrySummary;
  auditEvents: CommandSuggestionAuditEvent[];
}

export interface CommandSuggestionDiagnosticsCleanupRequest {
  pruneAuditEvents?: boolean;
  pruneFeedback?: boolean;
  auditRetentionDays?: number;
  feedbackRetentionDays?: number;
  pruneExpiredProviderCache?: boolean;
  resetPersistedTelemetry?: boolean;
}

export interface NormalizedCommandSuggestionDiagnosticsCleanupRequest {
  pruneAuditEvents: boolean;
  pruneFeedback: boolean;
  auditRetentionDays: number;
  feedbackRetentionDays: number;
  pruneExpiredProviderCache: boolean;
  resetPersistedTelemetry: boolean;
}

export interface CommandSuggestionDiagnosticsCleanupResult {
  generatedAtUnixMs: number;
  auditCutoffUnixMs?: number;
  feedbackCutoffUnixMs?: number;
  auditEventsDeleted: number;
  feedbackDeleted: number;
  providerCacheDeleted: number;
  telemetryRowsDeleted: number;
}

export interface CommandSuggestionAuditEvent {
  id: string;
  eventKind: CommandSuggestionAuditEventKind;
  provider?: CommandSuggestionProvider;
  target: CommandHistoryTarget;
  decision: CommandSuggestionAuditDecision;
  reason?: string;
  remoteHostId?: string;
  cwd?: string;
  path?: string;
  paneId?: string;
  sessionId?: string;
  metadata: Record<string, string>;
  createdAtUnixMs: number;
}

export interface CommandSuggestionAuditRecordRequest {
  eventKind: CommandSuggestionAuditEventKind;
  provider?: CommandSuggestionProvider;
  target?: CommandHistoryTarget;
  decision: CommandSuggestionAuditDecision;
  reason?: string;
  remoteHostId?: string;
  cwd?: string;
  path?: string;
  paneId?: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}

export interface CommandSuggestionAuditRecordResult {
  recorded: boolean;
  eventId: string;
}

export interface CommandSuggestionRemotePathRefreshRequest {
  hostId: string;
  path: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionRemotePathRefreshRequest {
  hostId: string;
  path: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionRemotePathRefreshResult {
  hostId: string;
  path: string;
  entryCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

export interface CommandSuggestionRemoteCommandRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionRemoteCommandRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionRemoteCommandRefreshResult {
  hostId: string;
  commandCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

export interface CommandSuggestionRemoteHistoryRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionRemoteHistoryRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionRemoteHistoryRefreshResult {
  hostId: string;
  commandCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

export interface CommandSuggestionGitRefreshRequest {
  hostId: string;
  cwd: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionGitRefreshRequest {
  hostId: string;
  cwd: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionGitRefreshResult {
  hostId: string;
  cwd: string;
  repoRoot?: string;
  entryCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;
const DEFAULT_REMOTE_PATH_TTL_SECONDS = 30;
const MAX_REMOTE_PATH_TTL_SECONDS = 300;
const DEFAULT_REMOTE_PATH_MAX_ENTRIES = 250;
const MAX_REMOTE_PATH_MAX_ENTRIES = 1000;
const DEFAULT_REMOTE_COMMAND_TTL_SECONDS = 300;
const MAX_REMOTE_COMMAND_TTL_SECONDS = 3600;
const DEFAULT_REMOTE_COMMAND_MAX_ENTRIES = 1500;
const MAX_REMOTE_COMMAND_MAX_ENTRIES = 5000;
const DEFAULT_REMOTE_HISTORY_TTL_SECONDS = 900;
const MAX_REMOTE_HISTORY_TTL_SECONDS = 86400;
const DEFAULT_REMOTE_HISTORY_MAX_ENTRIES = 1000;
const MAX_REMOTE_HISTORY_MAX_ENTRIES = 5000;
const DEFAULT_GIT_TTL_SECONDS = 60;
const MAX_GIT_TTL_SECONDS = 600;
const DEFAULT_GIT_MAX_ENTRIES = 500;
const MAX_GIT_MAX_ENTRIES = 5000;
const DEFAULT_AUDIT_RETENTION_DAYS = 30;
const DEFAULT_FEEDBACK_RETENTION_DAYS = 365;
const MAX_DIAGNOSTIC_RETENTION_DAYS = 3650;

export async function listTerminalSuggestions(
  request: CommandSuggestionRequest,
): Promise<CommandSuggestionCandidate[]> {
  const normalized = normalizeCommandSuggestionRequest(request);
  if (!normalized.input.slice(0, normalized.cursor).trim()) {
    return [];
  }

  if (isTauri()) {
    return invoke<CommandSuggestionCandidate[]>("command_suggestion_list", {
      request: normalized,
    });
  }

  return listBrowserPreviewSuggestions(normalized);
}

export async function refreshTerminalRemotePathSuggestions(
  request: CommandSuggestionRemotePathRefreshRequest,
): Promise<CommandSuggestionRemotePathRefreshResult> {
  const normalized = normalizeRemotePathRefreshRequest(request);
  if (isTauri()) {
    return invoke<CommandSuggestionRemotePathRefreshResult>(
      "command_suggestion_refresh_remote_paths",
      { request: normalized },
    );
  }

  return {
    cachedAtUnixMs: Date.now(),
    entryCount: 0,
    hostId: normalized.hostId,
    path: normalized.path,
    ttlSeconds: normalized.ttlSeconds ?? DEFAULT_REMOTE_PATH_TTL_SECONDS,
  };
}

export async function refreshTerminalRemoteCommandSuggestions(
  request: CommandSuggestionRemoteCommandRefreshRequest,
): Promise<CommandSuggestionRemoteCommandRefreshResult> {
  const normalized = normalizeRemoteCommandRefreshRequest(request);
  if (isTauri()) {
    return invoke<CommandSuggestionRemoteCommandRefreshResult>(
      "command_suggestion_refresh_remote_commands",
      { request: normalized },
    );
  }

  return {
    cachedAtUnixMs: Date.now(),
    commandCount: 0,
    hostId: normalized.hostId,
    ttlSeconds: normalized.ttlSeconds ?? DEFAULT_REMOTE_COMMAND_TTL_SECONDS,
  };
}

export async function refreshTerminalRemoteHistorySuggestions(
  request: CommandSuggestionRemoteHistoryRefreshRequest,
): Promise<CommandSuggestionRemoteHistoryRefreshResult> {
  const normalized = normalizeRemoteHistoryRefreshRequest(request);
  if (isTauri()) {
    return invoke<CommandSuggestionRemoteHistoryRefreshResult>(
      "command_suggestion_refresh_remote_history",
      { request: normalized },
    );
  }

  return {
    cachedAtUnixMs: Date.now(),
    commandCount: 0,
    hostId: normalized.hostId,
    ttlSeconds: normalized.ttlSeconds ?? DEFAULT_REMOTE_HISTORY_TTL_SECONDS,
  };
}

export async function refreshTerminalGitSuggestions(
  request: CommandSuggestionGitRefreshRequest,
): Promise<CommandSuggestionGitRefreshResult> {
  const normalized = normalizeGitRefreshRequest(request);
  if (isTauri()) {
    return invoke<CommandSuggestionGitRefreshResult>(
      "command_suggestion_refresh_git_refs",
      { request: normalized },
    );
  }

  return {
    cachedAtUnixMs: Date.now(),
    cwd: normalized.cwd,
    entryCount: 0,
    hostId: normalized.hostId,
    ttlSeconds: normalized.ttlSeconds ?? DEFAULT_GIT_TTL_SECONDS,
  };
}

export async function recordTerminalSuggestionFeedback(
  request: CommandSuggestionFeedbackRecordRequest,
): Promise<CommandSuggestionFeedbackRecordResult> {
  const normalized = normalizeSuggestionFeedbackRecordRequest(request);
  if (!normalized.input.trim() || !normalized.replacementText.trim()) {
    return {
      recorded: false,
      skipReason: "empty-command",
    };
  }

  if (isTauri()) {
    return invoke<CommandSuggestionFeedbackRecordResult>(
      "command_suggestion_record_feedback",
      { request: normalized },
    );
  }

  return {
    recorded: true,
    skipReason: undefined,
  };
}

export async function recordTerminalSuggestionAuditEvent(
  request: CommandSuggestionAuditRecordRequest,
): Promise<CommandSuggestionAuditRecordResult> {
  const normalized = normalizeSuggestionAuditRecordRequest(request);
  if (isTauri()) {
    return invoke<CommandSuggestionAuditRecordResult>(
      "command_suggestion_record_audit_event",
      { request: normalized },
    );
  }

  return {
    eventId: `browser-audit-${Date.now().toString(36)}`,
    recorded: true,
  };
}

export async function getTerminalSuggestionTelemetrySummary(): Promise<CommandSuggestionTelemetrySummary> {
  if (isTauri()) {
    return invoke<CommandSuggestionTelemetrySummary>(
      "command_suggestion_telemetry_summary",
    );
  }

  const now = Date.now();
  return {
    generatedAtUnixMs: now,
    providers: [],
    startedAtUnixMs: now,
    totalCandidateCount: 0,
    totalQueryCount: 0,
  };
}

export async function getTerminalSuggestionTelemetryExport(): Promise<CommandSuggestionTelemetryExport> {
  if (isTauri()) {
    return invoke<CommandSuggestionTelemetryExport>(
      "command_suggestion_telemetry_export",
    );
  }

  const summary = await getTerminalSuggestionTelemetrySummary();
  return {
    auditEvents: [],
    generatedAtUnixMs: summary.generatedAtUnixMs,
    persisted: summary,
    runtime: summary,
  };
}

export async function cleanupTerminalSuggestionDiagnostics(
  request: CommandSuggestionDiagnosticsCleanupRequest = {},
): Promise<CommandSuggestionDiagnosticsCleanupResult> {
  const normalized = normalizeDiagnosticsCleanupRequest(request);
  if (isTauri()) {
    return invoke<CommandSuggestionDiagnosticsCleanupResult>(
      "command_suggestion_cleanup_diagnostics",
      { request: normalized },
    );
  }

  const now = Date.now();
  return {
    auditCutoffUnixMs: now - normalized.auditRetentionDays * 86_400_000,
    auditEventsDeleted: 0,
    feedbackCutoffUnixMs: now - normalized.feedbackRetentionDays * 86_400_000,
    feedbackDeleted: 0,
    generatedAtUnixMs: now,
    providerCacheDeleted: 0,
    telemetryRowsDeleted: 0,
  };
}

export function normalizeCommandSuggestionRequest(
  request: CommandSuggestionRequest,
): NormalizedCommandSuggestionRequest {
  const input = request.input;
  const cursor = clamp(request.cursor, 0, Array.from(input).length);
  const providers = normalizeProviders(request.providers);

  return {
    input,
    cursor,
    target: request.target ?? "local",
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.profileId?.trim()
      ? { profileId: request.profileId.trim() }
      : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
    ...(providers ? { providers } : {}),
    limit: clampLimit(request.limit),
  };
}

export function normalizeSuggestionFeedbackRecordRequest(
  request: CommandSuggestionFeedbackRecordRequest,
): NormalizedCommandSuggestionFeedbackRecordRequest {
  return {
    action: request.action,
    input: request.input,
    provider: request.provider,
    replacementText: request.replacementText,
    target: request.target ?? "local",
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.profileId?.trim()
      ? { profileId: request.profileId.trim() }
      : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
    ...(request.sourceId?.trim() ? { sourceId: request.sourceId.trim() } : {}),
  };
}

export function normalizeDiagnosticsCleanupRequest(
  request: CommandSuggestionDiagnosticsCleanupRequest,
): NormalizedCommandSuggestionDiagnosticsCleanupRequest {
  return {
    auditRetentionDays: clampInteger(
      request.auditRetentionDays,
      DEFAULT_AUDIT_RETENTION_DAYS,
      1,
      MAX_DIAGNOSTIC_RETENTION_DAYS,
    ),
    feedbackRetentionDays: clampInteger(
      request.feedbackRetentionDays,
      DEFAULT_FEEDBACK_RETENTION_DAYS,
      1,
      MAX_DIAGNOSTIC_RETENTION_DAYS,
    ),
    pruneAuditEvents: request.pruneAuditEvents ?? true,
    pruneExpiredProviderCache: request.pruneExpiredProviderCache ?? true,
    pruneFeedback: request.pruneFeedback ?? true,
    resetPersistedTelemetry: request.resetPersistedTelemetry ?? false,
  };
}

export function normalizeSuggestionAuditRecordRequest(
  request: CommandSuggestionAuditRecordRequest,
): Required<
  Pick<
    CommandSuggestionAuditRecordRequest,
    "decision" | "eventKind" | "metadata" | "target"
  >
> &
  Omit<
    CommandSuggestionAuditRecordRequest,
    "decision" | "eventKind" | "metadata" | "target"
  > {
  const metadata = Object.fromEntries(
    Object.entries(request.metadata ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key]) => key.length > 0),
  );

  return {
    decision: request.decision,
    eventKind: request.eventKind,
    metadata,
    target: request.target ?? "local",
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.reason?.trim() ? { reason: request.reason.trim() } : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.path?.trim() ? { path: request.path.trim() } : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
  };
}

export function normalizeRemotePathRefreshRequest(
  request: CommandSuggestionRemotePathRefreshRequest,
): NormalizedCommandSuggestionRemotePathRefreshRequest {
  return {
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_REMOTE_PATH_MAX_ENTRIES),
      1,
      MAX_REMOTE_PATH_MAX_ENTRIES,
    ),
    path: request.path.trim() || "/",
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_REMOTE_PATH_TTL_SECONDS),
      1,
      MAX_REMOTE_PATH_TTL_SECONDS,
    ),
  };
}

export function normalizeRemoteCommandRefreshRequest(
  request: CommandSuggestionRemoteCommandRefreshRequest,
): NormalizedCommandSuggestionRemoteCommandRefreshRequest {
  return {
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_REMOTE_COMMAND_MAX_ENTRIES),
      1,
      MAX_REMOTE_COMMAND_MAX_ENTRIES,
    ),
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_REMOTE_COMMAND_TTL_SECONDS),
      1,
      MAX_REMOTE_COMMAND_TTL_SECONDS,
    ),
  };
}

export function normalizeRemoteHistoryRefreshRequest(
  request: CommandSuggestionRemoteHistoryRefreshRequest,
): NormalizedCommandSuggestionRemoteHistoryRefreshRequest {
  return {
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_REMOTE_HISTORY_MAX_ENTRIES),
      1,
      MAX_REMOTE_HISTORY_MAX_ENTRIES,
    ),
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_REMOTE_HISTORY_TTL_SECONDS),
      1,
      MAX_REMOTE_HISTORY_TTL_SECONDS,
    ),
  };
}

export function normalizeGitRefreshRequest(
  request: CommandSuggestionGitRefreshRequest,
): NormalizedCommandSuggestionGitRefreshRequest {
  return {
    cwd: request.cwd.trim() || "/",
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_GIT_MAX_ENTRIES),
      1,
      MAX_GIT_MAX_ENTRIES,
    ),
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_GIT_TTL_SECONDS),
      1,
      MAX_GIT_TTL_SECONDS,
    ),
  };
}

async function listBrowserPreviewSuggestions(
  request: NormalizedCommandSuggestionRequest,
) {
  if (request.providers && !request.providers.includes("history")) {
    return [];
  }

  const prefix = commandPrefix(request);
  const history = await listCommandHistory({
    limit: request.limit,
    query: prefix.trim(),
    remoteHostId: request.remoteHostId,
    target: request.target,
  });

  return history
    .map((entry) => historyEntryToCandidate(entry, request, prefix))
    .filter((candidate): candidate is CommandSuggestionCandidate =>
      Boolean(candidate),
    )
    .slice(0, request.limit);
}

function historyEntryToCandidate(
  entry: CommandHistoryEntry,
  request: NormalizedCommandSuggestionRequest,
  prefix: string,
): CommandSuggestionCandidate | null {
  if (!entry.command.startsWith(prefix) || entry.command === prefix) {
    return null;
  }

  const suffix = entry.command.slice(prefix.length);
  const sameHost =
    entry.remoteHostId && entry.remoteHostId === request.remoteHostId;
  const sameCwd = entry.cwd && entry.cwd === request.cwd;

  return {
    id: `history:${entry.id}`,
    provider: "history",
    displayText: entry.command,
    replacementText: entry.command,
    replacementRange: {
      start: 0,
      end: request.cursor,
    },
    suffix,
    score: 0.55 + (sameHost ? 0.2 : 0) + (sameCwd ? 0.2 : 0),
    sensitivity: "normal",
    description: sameCwd
      ? "历史命令，匹配当前目录"
      : sameHost
        ? "历史命令，匹配当前主机"
        : "历史命令",
    sourceId: entry.id,
    metadata: {
      createdAt: entry.createdAt,
      source: entry.source,
    },
  };
}

function commandPrefix(request: NormalizedCommandSuggestionRequest) {
  return Array.from(request.input).slice(0, request.cursor).join("");
}

function normalizeProviders(
  providers: CommandSuggestionProvider[] | undefined,
) {
  if (!providers) {
    return undefined;
  }

  const unique = Array.from(new Set(providers));
  return unique.length > 0 ? unique : undefined;
}

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return clamp(Math.trunc(limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT);
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clamp(Math.trunc(value ?? fallback), min, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
