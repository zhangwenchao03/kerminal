import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteTargetRef } from "./targetModel";

export interface TmuxTargetRef {
  target: RemoteTargetRef;
  socketName?: string;
  socketPath?: string;
  tmuxPath?: string;
}

export interface TmuxProbeRequest {
  target: TmuxTargetRef;
}

export interface TmuxCapabilityStatus {
  targetRef: string;
  target: RemoteTargetRef;
  available: boolean;
  version?: string;
  reason?: string;
  socketName?: string;
  socketPath?: string;
}

type TmuxSessionStatus = "running" | "stale";

export interface TmuxSessionSummary {
  id: string;
  name: string;
  attached: boolean;
  windows: number;
  clients: number;
  currentPath?: string;
  createdAt?: number;
  activityAt?: number;
  targetRef: string;
  status: TmuxSessionStatus;
}

export interface TmuxCreateSessionRequest {
  target: TmuxTargetRef;
  name: string;
  cwd?: string;
}

export interface TmuxRenameSessionRequest {
  target: TmuxTargetRef;
  sessionId: string;
  name: string;
}

export interface TmuxKillSessionRequest {
  target: TmuxTargetRef;
  sessionId: string;
}

export interface TmuxAttachSessionRequest {
  target: TmuxTargetRef;
  sessionId: string;
  sessionName?: string;
  cwd?: string;
}

export interface TmuxPaneBinding {
  targetRef: string;
  sessionId: string;
  sessionName: string;
  socketName?: string;
  socketPath?: string;
  attachedAt: string;
}

export type TmuxAttachLaunch =
  | {
      mode: "local";
      terminal: {
        shell?: string;
        args?: string[];
        cwd?: string;
        cols: number;
        rows: number;
        env?: Record<string, string>;
      };
      title: string;
      binding: TmuxPaneBinding;
    }
  | {
      mode: "ssh";
      hostId: string;
      remoteCommand: string;
      cwd?: string;
      title: string;
      binding: TmuxPaneBinding;
    };

const previewSessions = new Map<string, TmuxSessionSummary[]>();

export async function tmuxProbe(
  request: TmuxProbeRequest,
): Promise<TmuxCapabilityStatus> {
  if (!isTauri()) {
    return {
      available: isSupportedPreviewTarget(request.target.target),
      reason: isSupportedPreviewTarget(request.target.target)
        ? undefined
        : "浏览器预览仅模拟 Local 和 SSH tmux 目标",
      socketName: request.target.socketName,
      socketPath: request.target.socketPath,
      target: request.target.target,
      targetRef: previewTargetRef(request.target),
      version: "tmux preview",
    };
  }
  return invoke<TmuxCapabilityStatus>("tmux_probe", { request });
}

export async function tmuxListSessions(
  request: { target: TmuxTargetRef },
): Promise<TmuxSessionSummary[]> {
  if (!isTauri()) {
    return previewSessions.get(previewTargetRef(request.target)) ?? [];
  }
  return invoke<TmuxSessionSummary[]>("tmux_list_sessions", { request });
}

export async function tmuxCreateSession(
  request: TmuxCreateSessionRequest,
): Promise<TmuxSessionSummary> {
  if (!isTauri()) {
    const targetRef = previewTargetRef(request.target);
    const sessions = previewSessions.get(targetRef) ?? [];
    const session: TmuxSessionSummary = {
      activityAt: Math.floor(Date.now() / 1000),
      attached: false,
      clients: 0,
      createdAt: Math.floor(Date.now() / 1000),
      currentPath: request.cwd,
      id: `$${sessions.length}`,
      name: request.name,
      status: "running",
      targetRef,
      windows: 1,
    };
    previewSessions.set(targetRef, [...sessions, session]);
    return session;
  }
  return invoke<TmuxSessionSummary>("tmux_create_session", { request });
}

export async function tmuxAttachSession(
  request: TmuxAttachSessionRequest,
): Promise<TmuxAttachLaunch> {
  if (!isTauri()) {
    const targetRef = previewTargetRef(request.target);
    const binding: TmuxPaneBinding = {
      attachedAt: Math.floor(Date.now() / 1000).toString(),
      sessionId: request.sessionId,
      sessionName: request.sessionName ?? request.sessionId,
      socketName: request.target.socketName,
      socketPath: request.target.socketPath,
      targetRef,
    };
    if (request.target.target.kind === "ssh") {
      return {
        binding,
        cwd: request.cwd,
        hostId: request.target.target.hostId,
        mode: "ssh",
        remoteCommand: `tmux attach-session -t ${request.sessionId}`,
        title: `tmux: ${binding.sessionName}`,
      };
    }
    return {
      binding,
      mode: "local",
      terminal: {
        args: ["attach-session", "-t", request.sessionId],
        cols: 80,
        cwd: request.cwd,
        rows: 24,
        shell: request.target.tmuxPath ?? "tmux",
      },
      title: `tmux: ${binding.sessionName}`,
    };
  }
  return invoke<TmuxAttachLaunch>("tmux_attach_session", { request });
}

export async function tmuxRenameSession(
  request: TmuxRenameSessionRequest,
): Promise<TmuxSessionSummary> {
  if (!isTauri()) {
    const targetRef = previewTargetRef(request.target);
    const sessions = previewSessions.get(targetRef) ?? [];
    const index = sessions.findIndex((session) => session.id === request.sessionId);
    if (index < 0) {
      throw new Error(`tmux session 不存在: ${request.sessionId}`);
    }
    const next = { ...sessions[index], name: request.name };
    previewSessions.set(targetRef, [
      ...sessions.slice(0, index),
      next,
      ...sessions.slice(index + 1),
    ]);
    return next;
  }
  return invoke<TmuxSessionSummary>("tmux_rename_session", { request });
}

export async function tmuxKillSession(
  request: TmuxKillSessionRequest,
): Promise<boolean> {
  if (!isTauri()) {
    const targetRef = previewTargetRef(request.target);
    const sessions = previewSessions.get(targetRef) ?? [];
    previewSessions.set(
      targetRef,
      sessions.filter((session) => session.id !== request.sessionId),
    );
    return sessions.some((session) => session.id === request.sessionId);
  }
  return invoke<boolean>("tmux_kill_session", { request });
}

export async function tmuxDetachCurrent(paneId: string): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  return invoke<boolean>("tmux_detach_current", { request: { paneId } });
}

function previewTargetRef(target: TmuxTargetRef): string {
  const base =
    target.target.kind === "local"
      ? target.target.profileId
        ? `local:${target.target.profileId}`
        : "local"
      : target.target.kind === "ssh"
        ? `ssh:${target.target.hostId}`
        : target.target.kind;
  if (target.socketName?.trim()) {
    return `${base}|L:${target.socketName.trim()}`;
  }
  if (target.socketPath?.trim()) {
    return `${base}|S:${target.socketPath.trim()}`;
  }
  return base;
}

function isSupportedPreviewTarget(target: RemoteTargetRef) {
  return target.kind === "local" || target.kind === "ssh";
}
