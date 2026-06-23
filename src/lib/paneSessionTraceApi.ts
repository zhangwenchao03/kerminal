import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PaneSessionBindingTraceRequest {
  cwd?: string;
  metadata?: PaneSessionBindingMetadata;
  paneId: string;
  profileId?: string;
  remoteHostId?: string;
  sessionId: string;
  shell?: string;
  tabId?: string;
  targetRef?: string;
  targetKind?: string;
  targetToken?: string;
}

export interface PaneSessionBindingMetadata {
  cwd?: string;
  profileId?: string;
  remoteHostId?: string;
  shell?: string;
  tabId?: string;
  targetRef?: string;
  targetKind?: string;
}

export interface TerminalSessionBindingSnapshot {
  metadata?: PaneSessionBindingMetadata | null;
  paneId: string;
  sessionId: string;
  generation: number;
  status: string;
  registeredAtMs?: number;
  updatedAtMs?: number;
  readyAtMs?: number | null;
  disconnectedAtMs?: number | null;
  lastSnapshotStatus?: string | null;
}

export interface TerminalSessionBindingEvent {
  occurredAtMs: number;
  kind: string;
  paneId?: string | null;
  sessionId?: string | null;
  message?: string | null;
}

export async function registerTerminalSessionBinding(
  request: PaneSessionBindingTraceRequest,
): Promise<TerminalSessionBindingSnapshot | undefined> {
  const snapshot = await invokeBindingCommand(
    "terminal_session_binding_register",
    request,
  );
  return snapshot ?? undefined;
}

export async function markTerminalSessionBindingReady(
  request: PaneSessionBindingTraceRequest,
): Promise<TerminalSessionBindingSnapshot | null | undefined> {
  return invokeBindingCommand("terminal_session_binding_ready", request);
}

export async function markTerminalSessionBindingDisconnected(
  request: PaneSessionBindingTraceRequest,
): Promise<TerminalSessionBindingSnapshot | null | undefined> {
  return invokeBindingCommand("terminal_session_binding_disconnected", request);
}

export async function closeTerminalSessionBinding(
  request: PaneSessionBindingTraceRequest,
): Promise<boolean | undefined> {
  if (!isTauri()) {
    return undefined;
  }
  return invoke<boolean>("terminal_session_binding_closed", normalizeRequest(request));
}

export async function listTerminalSessionBindingEvents(): Promise<
  TerminalSessionBindingEvent[]
> {
  if (!isTauri()) {
    return [];
  }
  return invoke<TerminalSessionBindingEvent[]>(
    "terminal_session_binding_events",
  );
}

async function invokeBindingCommand(
  command: string,
  request: PaneSessionBindingTraceRequest,
): Promise<TerminalSessionBindingSnapshot | null | undefined> {
  if (!isTauri()) {
    return undefined;
  }
  return invoke<TerminalSessionBindingSnapshot | null>(
    command,
    normalizeRequest(request),
  );
}

function normalizeRequest(request: PaneSessionBindingTraceRequest) {
  const metadata = normalizeMetadata({
    ...request.metadata,
    cwd: request.cwd ?? request.metadata?.cwd,
    profileId: request.profileId ?? request.metadata?.profileId,
    remoteHostId: request.remoteHostId ?? request.metadata?.remoteHostId,
    shell: request.shell ?? request.metadata?.shell,
    tabId: request.tabId ?? request.metadata?.tabId,
    targetRef: request.targetRef ?? request.metadata?.targetRef,
    targetKind: request.targetKind ?? request.metadata?.targetKind,
  });
  return {
    ...(metadata ? { metadata } : {}),
    paneId: normalizeRequiredId("paneId", request.paneId),
    sessionId: normalizeRequiredId("sessionId", request.sessionId),
    ...(normalizeOptionalString(request.targetToken)
      ? { targetToken: normalizeOptionalString(request.targetToken) }
      : {}),
  };
}

function normalizeMetadata(
  metadata: PaneSessionBindingMetadata,
): PaneSessionBindingMetadata | undefined {
  const normalized = {
    cwd: normalizeOptionalString(metadata.cwd),
    profileId: normalizeOptionalString(metadata.profileId),
    remoteHostId: normalizeOptionalString(metadata.remoteHostId),
    shell: normalizeOptionalString(metadata.shell),
    tabId: normalizeOptionalString(metadata.tabId),
    targetRef: normalizeOptionalString(metadata.targetRef),
    targetKind: normalizeOptionalString(metadata.targetKind),
  };
  return Object.values(normalized).some((value) => value !== undefined)
    ? normalized
    : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeRequiredId(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}
