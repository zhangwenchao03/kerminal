import { invoke, isTauri } from "@tauri-apps/api/core";
import { previewMcpHttpServerStatus } from "./mcpServerPreview";

export interface McpHttpServerStatus {
  running: boolean;
  endpoint?: string | null;
  bindAddress: string;
  port?: number | null;
  localOnly: boolean;
}

export async function getMcpHttpServerStatus(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>("mcp_http_server_status");
  return normalizeMcpHttpServerStatus(status);
}

export async function startMcpHttpServer(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>(
    "mcp_http_server_start",
    { request: null },
  );
  return normalizeMcpHttpServerStatus(status);
}

export async function stopMcpHttpServer(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>("mcp_http_server_stop");
  return normalizeMcpHttpServerStatus(status);
}

function normalizeMcpHttpServerStatus(
  status: McpHttpServerStatus,
): McpHttpServerStatus {
  return {
    bindAddress: status.bindAddress ?? "127.0.0.1",
    endpoint: status.endpoint ?? null,
    localOnly: status.localOnly ?? true,
    port: status.port ?? null,
    running: Boolean(status.running),
  };
}
