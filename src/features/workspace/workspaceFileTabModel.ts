import type { RemoteTargetRef } from "../../lib/targetModel";
import type { WorkspaceFileAccess, WorkspaceFileSource } from "./types";

export interface WorkspaceFileTabKeyInput {
  access: WorkspaceFileAccess;
  path: string;
  source: WorkspaceFileSource;
  target: RemoteTargetRef;
}

export function normalizeWorkspaceFilePath(path: string | undefined): string {
  const normalized = (path ?? "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return "/";
  }
  const collapsed = normalized.replace(/\/+/g, "/");
  if (/^[A-Za-z]:\//.test(collapsed)) {
    return collapsed.replace(/\/+$/g, "");
  }
  const withLeadingSlash = collapsed.startsWith("/")
    ? collapsed
    : `/${collapsed}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/g, "")
    : withLeadingSlash;
}

export function titleForWorkspaceFilePath(path: string | undefined): string {
  const normalized = normalizeWorkspaceFilePath(path);
  if (normalized === "/") {
    return "/";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function directoryForWorkspaceFilePath(
  path: string | undefined,
): string {
  const normalized = normalizeWorkspaceFilePath(path);
  if (normalized === "/" || /^[A-Za-z]:\/?$/.test(normalized)) {
    return normalized;
  }
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex <= 0) {
    return "/";
  }
  if (/^[A-Za-z]:\//.test(normalized) && separatorIndex <= 2) {
    return normalized.slice(0, separatorIndex + 1);
  }
  return normalized.slice(0, separatorIndex);
}

export function buildWorkspaceFileTabKey({
  access,
  path,
  source,
  target,
}: WorkspaceFileTabKeyInput): string {
  return `${workspaceFileTargetStableId(target)}|${access}|${source}|${normalizeWorkspaceFilePath(path)}`;
}

export function workspaceFileMachineId(target: RemoteTargetRef): string {
  if (target.kind === "ssh") {
    return target.hostId;
  }
  if (target.kind === "dockerContainer") {
    return `docker:${target.hostId}:${target.containerId}`;
  }
  if (target.kind === "local") {
    return target.profileId ? `local:${target.profileId}` : "local";
  }
  return target.hostId;
}

export function workspaceFileTargetHostId(
  target: RemoteTargetRef,
): string | undefined {
  return target.kind === "local" ? undefined : target.hostId;
}

function workspaceFileTargetStableId(target: RemoteTargetRef): string {
  if (target.kind === "dockerContainer") {
    return `${target.runtime ?? "docker"}:${target.hostId}:${target.containerId}:${target.runtime ?? "docker"}`;
  }
  if (target.kind === "local") {
    return target.profileId ? `local:${target.profileId}` : "local";
  }
  return `${target.kind}:${target.hostId}`;
}
