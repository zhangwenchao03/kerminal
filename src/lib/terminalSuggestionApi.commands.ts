import {
  DEFAULT_GIT_TTL_SECONDS,
  DEFAULT_REMOTE_COMMAND_TTL_SECONDS,
  DEFAULT_REMOTE_HISTORY_TTL_SECONDS,
  DEFAULT_REMOTE_PATH_TTL_SECONDS,
  listBrowserPreviewSuggestions,
  normalizeCommandSuggestionCandidate,
  normalizeCommandSuggestionRequest,
  normalizeDiagnosticsCleanupRequest,
  normalizeGitRefreshRequest,
  normalizeRemoteCommandRefreshRequest,
  normalizeRemoteHistoryRefreshRequest,
  normalizeRemotePathRefreshRequest,
  normalizeSuggestionAuditRecordRequest,
  normalizeSuggestionFeedbackRecordRequest,
  unicodePrefix,
} from "./terminalSuggestionApi.controller";
import {
  hasTerminalSuggestionTransport,
  invokeTerminalSuggestionCommand,
} from "./terminalSuggestionApi.transport";
import type {
  CommandSuggestionAuditRecordRequest,
  CommandSuggestionAuditRecordResult,
  CommandSuggestionCandidate,
  CommandSuggestionCandidatePayload,
  CommandSuggestionDiagnosticsCleanupRequest,
  CommandSuggestionDiagnosticsCleanupResult,
  CommandSuggestionFeedbackRecordRequest,
  CommandSuggestionFeedbackRecordResult,
  CommandSuggestionGitRefreshRequest,
  CommandSuggestionGitRefreshResult,
  CommandSuggestionRemoteCommandRefreshRequest,
  CommandSuggestionRemoteCommandRefreshResult,
  CommandSuggestionRemoteHistoryRefreshRequest,
  CommandSuggestionRemoteHistoryRefreshResult,
  CommandSuggestionRemotePathRefreshRequest,
  CommandSuggestionRemotePathRefreshResult,
  CommandSuggestionRequest,
  CommandSuggestionTelemetryExport,
  CommandSuggestionTelemetrySummary,
} from "./terminalSuggestionApi.types";

export async function listTerminalSuggestions(
  request: CommandSuggestionRequest,
): Promise<CommandSuggestionCandidate[]> {
  const normalized = normalizeCommandSuggestionRequest(request);
  if (!unicodePrefix(normalized.input, normalized.cursor).trim()) {
    return [];
  }

  if (hasTerminalSuggestionTransport()) {
    const candidates = await invokeTerminalSuggestionCommand<
      CommandSuggestionCandidatePayload[]
    >(
      "command_suggestion_list",
      {
      request: normalized,
      },
    );
    return candidates.map((candidate) =>
      normalizeCommandSuggestionCandidate(candidate, normalized),
    );
  }

  return listBrowserPreviewSuggestions(normalized);
}

export async function refreshTerminalRemotePathSuggestions(
  request: CommandSuggestionRemotePathRefreshRequest,
): Promise<CommandSuggestionRemotePathRefreshResult> {
  const normalized = normalizeRemotePathRefreshRequest(request);
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionRemotePathRefreshResult>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionRemoteCommandRefreshResult>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionRemoteHistoryRefreshResult>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionGitRefreshResult>(
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

  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionFeedbackRecordResult>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionAuditRecordResult>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionTelemetrySummary>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionTelemetryExport>(
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
  if (hasTerminalSuggestionTransport()) {
    return invokeTerminalSuggestionCommand<CommandSuggestionDiagnosticsCleanupResult>(
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
