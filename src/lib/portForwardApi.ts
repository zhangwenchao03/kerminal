import { invoke, isTauri } from "@tauri-apps/api/core";

export type PortForwardKind = "local" | "remote" | "dynamic";

export type PortForwardStatus = "running" | "exited";

export interface PortForwardCreateRequest {
  hostId: string;
  name?: string;
  kind: PortForwardKind;
  bindHost?: string;
  sourcePort: number;
  targetHost?: string;
  targetPort?: number;
}

export interface PortForwardSummary {
  id: string;
  hostId: string;
  hostName: string;
  name: string;
  kind: PortForwardKind;
  bindHost: string;
  sourcePort: number;
  targetHost?: string;
  targetPort?: number;
  pid?: number;
  status: PortForwardStatus;
  createdAt: string;
}

const browserPreviewForwards = new Map<string, PortForwardSummary>();

export async function createPortForward(
  request: PortForwardCreateRequest,
): Promise<PortForwardSummary> {
  const normalized = normalizeCreateRequest(request);
  if (!isTauri()) {
    const id = `preview-forward-${Date.now().toString(36)}`;
    const summary: PortForwardSummary = {
      bindHost: normalized.bindHost ?? "127.0.0.1",
      createdAt: Math.floor(Date.now() / 1000).toString(),
      hostId: normalized.hostId,
      hostName: "浏览器预览主机",
      id,
      kind: normalized.kind,
      name: normalized.name || defaultForwardName(normalized),
      pid: 0,
      sourcePort: normalized.sourcePort,
      status: "running",
      targetHost: normalized.targetHost,
      targetPort: normalized.targetPort,
    };
    browserPreviewForwards.set(id, summary);
    return summary;
  }

  return invoke<PortForwardSummary>("port_forward_create", {
    request: normalized,
  });
}

export async function listPortForwards(): Promise<PortForwardSummary[]> {
  if (!isTauri()) {
    return Array.from(browserPreviewForwards.values());
  }

  return invoke<PortForwardSummary[]>("port_forward_list");
}

export async function closePortForward(forwardId: string): Promise<boolean> {
  if (!isTauri()) {
    return browserPreviewForwards.delete(forwardId);
  }

  return invoke<boolean>("port_forward_close", { forwardId });
}

function normalizeCreateRequest(
  request: PortForwardCreateRequest,
): PortForwardCreateRequest {
  return {
    ...request,
    bindHost: request.bindHost?.trim() || "127.0.0.1",
    name: request.name?.trim() || undefined,
    targetHost:
      request.kind === "dynamic"
        ? undefined
        : request.targetHost?.trim() || "127.0.0.1",
    targetPort: request.kind === "dynamic" ? undefined : request.targetPort,
  };
}

function defaultForwardName(request: PortForwardCreateRequest) {
  if (request.kind === "dynamic") {
    return `SOCKS :${request.sourcePort}`;
  }
  return `${request.sourcePort} -> ${request.targetHost}:${request.targetPort}`;
}
