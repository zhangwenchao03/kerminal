export type RemoteTargetKind =
  | "local"
  | "ssh"
  | "telnet"
  | "serial"
  | "dockerContainer";

export type ContainerRuntime = "docker" | "podman";

export type RemoteTargetRef =
  | {
      kind: "local";
      profileId?: string;
    }
  | {
      kind: "ssh";
      hostId: string;
    }
  | {
      kind: "telnet";
      hostId: string;
    }
  | {
      kind: "serial";
      hostId: string;
    }
  | {
      kind: "dockerContainer";
      hostId: string;
      containerId: string;
      runtime?: ContainerRuntime;
      containerName?: string;
      user?: string;
      workdir?: string;
    };

export interface TargetCapabilities {
  terminal: boolean;
  exec: boolean;
  files: boolean;
  upload: boolean;
  download: boolean;
  ports: boolean;
}

export interface FileLocation {
  target: RemoteTargetRef;
  path: string;
}

const localTargetCapabilities: TargetCapabilities = {
  download: false,
  exec: true,
  files: false,
  ports: false,
  terminal: true,
  upload: false,
};

const sshTargetCapabilities: TargetCapabilities = {
  download: true,
  exec: true,
  files: true,
  ports: true,
  terminal: true,
  upload: true,
};

export const dockerContainerTargetCapabilities: TargetCapabilities = {
  download: true,
  exec: true,
  files: true,
  ports: false,
  terminal: true,
  upload: true,
};

const telnetTargetCapabilities: TargetCapabilities = {
  download: false,
  exec: false,
  files: false,
  ports: false,
  terminal: true,
  upload: false,
};

const serialTargetCapabilities: TargetCapabilities = {
  download: false,
  exec: false,
  files: false,
  ports: false,
  terminal: true,
  upload: false,
};

export function localTarget(profileId?: string): RemoteTargetRef {
  return profileId?.trim()
    ? { kind: "local", profileId: profileId.trim() }
    : { kind: "local" };
}

export function sshTarget(hostId: string): RemoteTargetRef {
  return { hostId: hostId.trim(), kind: "ssh" };
}

export function telnetTarget(hostId: string): RemoteTargetRef {
  return { hostId: hostId.trim(), kind: "telnet" };
}

export function serialTarget(hostId: string): RemoteTargetRef {
  return { hostId: hostId.trim(), kind: "serial" };
}

export function dockerContainerTarget({
  containerId,
  containerName,
  hostId,
  runtime = "docker",
  user,
  workdir,
}: Omit<Extract<RemoteTargetRef, { kind: "dockerContainer" }>, "kind">): RemoteTargetRef {
  return {
    containerId: containerId.trim(),
    ...(containerName?.trim() ? { containerName: containerName.trim() } : {}),
    hostId: hostId.trim(),
    kind: "dockerContainer",
    runtime,
    ...(user?.trim() ? { user: user.trim() } : {}),
    ...(workdir?.trim() ? { workdir: normalizeRemotePath(workdir) } : {}),
  };
}

export function targetStableId(target: RemoteTargetRef): string {
  if (target.kind === "local") {
    return target.profileId ? `local:${target.profileId}` : "local";
  }
  if (target.kind === "ssh") {
    return `ssh:${target.hostId}`;
  }
  if (target.kind === "telnet") {
    return `telnet:${target.hostId}`;
  }
  if (target.kind === "serial") {
    return `serial:${target.hostId}`;
  }
  return `${target.runtime ?? "docker"}:${target.hostId}:${target.containerId}`;
}

export function targetHostId(target: RemoteTargetRef): string | undefined {
  return target.kind === "local" ? undefined : target.hostId;
}

export function fileLocation(
  target: RemoteTargetRef,
  path: string,
): FileLocation {
  return {
    path: normalizeRemotePath(path),
    target,
  };
}

function normalizeRemotePath(path: string | undefined): string {
  const normalized = (path ?? "").trim().replace(/\\/g, "/");
  if (!normalized) {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/g, "") : collapsed;
}

export function normalizeRemoteTargetRef(
  value: unknown,
): RemoteTargetRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.kind === "local") {
    return localTarget(readOptionalString(value.profileId));
  }
  if (value.kind === "ssh") {
    const hostId = readRequiredString(value.hostId);
    return hostId ? sshTarget(hostId) : undefined;
  }
  if (value.kind === "telnet") {
    const hostId = readRequiredString(value.hostId);
    return hostId ? telnetTarget(hostId) : undefined;
  }
  if (value.kind === "serial") {
    const hostId = readRequiredString(value.hostId);
    return hostId ? serialTarget(hostId) : undefined;
  }
  if (value.kind === "dockerContainer") {
    const hostId = readRequiredString(value.hostId);
    const containerId = readRequiredString(value.containerId);
    if (!hostId || !containerId) {
      return undefined;
    }
    return dockerContainerTarget({
      containerId,
      containerName: readOptionalString(value.containerName),
      hostId,
      runtime: normalizeContainerRuntime(value.runtime),
      user: readOptionalString(value.user),
      workdir: readOptionalString(value.workdir),
    });
  }
  return undefined;
}

export function targetCapabilitiesForKind(
  kind: RemoteTargetKind,
): TargetCapabilities {
  if (kind === "local") {
    return localTargetCapabilities;
  }
  if (kind === "ssh") {
    return sshTargetCapabilities;
  }
  if (kind === "telnet") {
    return telnetTargetCapabilities;
  }
  if (kind === "serial") {
    return serialTargetCapabilities;
  }
  return dockerContainerTargetCapabilities;
}

function normalizeContainerRuntime(value: unknown): ContainerRuntime {
  return value === "podman" ? "podman" : "docker";
}

function readRequiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const text = readRequiredString(value);
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
