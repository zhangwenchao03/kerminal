import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteHostCreateRequest } from "./remoteHostApi";

export type ConnectionTestMode = "ssh" | "rdp" | "telnet" | "serial";

export type ConnectionTestRequest =
  | { host: RemoteHostCreateRequest; mode: "ssh" }
  | { mode: "rdp"; request: RdpOpenRequest }
  | { host: RemoteHostCreateRequest; mode: "telnet" }
  | { host: RemoteHostCreateRequest; mode: "serial" };

export interface ConnectionTestResult {
  connected: boolean;
  latencyMs?: number;
  message: string;
  mode: ConnectionTestMode;
}

export interface RdpOpenRequest {
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  fullscreen?: boolean;
  desktopWidth?: number;
  desktopHeight?: number;
  note?: string;
}

export interface RdpOpenResult {
  launched: boolean;
  message: string;
  filePath?: string;
}

export async function openRdpConnection(
  request: RdpOpenRequest,
): Promise<RdpOpenResult> {
  const normalized = normalizeRdpOpenRequest(request);

  if (!isTauri()) {
    return {
      filePath: "browser-preview.rdp",
      launched: true,
      message: "浏览器预览：已模拟启动系统 RDP 客户端。",
    };
  }

  return invoke<RdpOpenResult>("connection_rdp_open", { request: normalized });
}

export async function openSavedRdpConnection(
  hostId: string,
): Promise<RdpOpenResult> {
  const normalizedHostId = hostId.trim();

  if (!isTauri()) {
    return {
      filePath: "browser-preview.rdp",
      launched: true,
      message: "浏览器预览：已模拟启动已保存的 RDP 连接。",
    };
  }

  return invoke<RdpOpenResult>("connection_rdp_open_saved", {
    hostId: normalizedHostId,
  });
}

export async function testRemoteConnection(
  request: ConnectionTestRequest,
): Promise<ConnectionTestResult> {
  if (!isTauri()) {
    return {
      connected: false,
      message: "浏览器预览：未执行真实连接测试。",
      mode: request.mode,
    };
  }

  return invoke<ConnectionTestResult>("connection_test", { request });
}

function normalizeRdpOpenRequest(request: RdpOpenRequest): RdpOpenRequest {
  return {
    desktopHeight: request.desktopHeight,
    desktopWidth: request.desktopWidth,
    fullscreen: request.fullscreen ?? false,
    host: request.host.trim(),
    name: request.name.trim() || request.host.trim(),
    note: request.note?.trim() || undefined,
    password: request.password?.trim() || undefined,
    port: request.port,
    username: request.username?.trim() || undefined,
  };
}
