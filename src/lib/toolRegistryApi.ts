import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  normalizeAiMcpSettings,
  type CustomMcpServerSetting,
  type CustomMcpServerToolSetting,
} from "../features/settings/settingsModel";
import {
  normalizeMcpGatewayManifest,
  normalizeMcpPromptRenderResult,
  normalizeMcpResourceReadResult,
  normalizeMcpToolList,
  normalizeToolDefinition,
  type McpGatewayManifest,
  type McpPromptRenderRequest,
  type McpPromptRenderResult,
  type McpResourceReadRequest,
  type McpResourceReadResult,
  type McpToolList,
  type ToolDefinition,
} from "../features/tool-panel/toolRegistryModel";
import {
  buildPreviewMcpManifest,
  buildPreviewMcpPrompt,
  buildPreviewMcpResource,
  buildPreviewMcpToolList,
  previewMcpHttpServerStatus,
  previewTools,
} from "./toolRegistryPreview";
export { browserPreviewMcpToolCount } from "./toolRegistryPreview";

export interface McpHttpServerStatus {
  running: boolean;
  endpoint?: string | null;
  bindAddress: string;
  port?: number | null;
  localOnly: boolean;
}

export async function listToolRegistry(): Promise<ToolDefinition[]> {
  if (!isTauri()) {
    return previewTools.map(normalizeToolDefinition);
  }

  const tools = await invoke<ToolDefinition[]>("tool_registry_list");
  return tools.map(normalizeToolDefinition);
}

export async function listMcpTools(): Promise<McpToolList> {
  if (!isTauri()) {
    return buildPreviewMcpToolList();
  }

  const tools = await invoke<McpToolList>("tool_registry_mcp_list");
  return normalizeMcpToolList(tools);
}

export async function getMcpGatewayManifest(): Promise<McpGatewayManifest> {
  if (!isTauri()) {
    return normalizeMcpGatewayManifest(buildPreviewMcpManifest());
  }

  const manifest = await invoke<McpGatewayManifest>("tool_registry_mcp_manifest");
  return normalizeMcpGatewayManifest(manifest);
}

export async function getMcpHttpServerStatus(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>(
    "tool_registry_mcp_http_status",
  );
  return normalizeMcpHttpServerStatus(status);
}

export async function startMcpHttpServer(): Promise<McpHttpServerStatus> {
  if (!isTauri()) {
    return previewMcpHttpServerStatus();
  }

  const status = await invoke<McpHttpServerStatus>(
    "tool_registry_mcp_http_start",
    { request: null },
  );
  return normalizeMcpHttpServerStatus(status);
}

export async function discoverMcpServerTools(
  server: CustomMcpServerSetting,
): Promise<CustomMcpServerToolSetting[]> {
  const normalizedServer = normalizeAiMcpSettings({ servers: [server] }).servers[0];
  if (!isTauri()) {
    return normalizedServer?.tools ?? [];
  }
  const tools = await invoke<CustomMcpServerToolSetting[]>(
    "tool_registry_mcp_server_discover_tools",
    { server: normalizedServer },
  );
  return normalizeAiMcpSettings({
    servers: [
      {
        ...(normalizedServer ?? server),
        tools,
      },
    ],
  }).servers[0]?.tools ?? [];
}

export async function readMcpResource(
  request: McpResourceReadRequest,
): Promise<McpResourceReadResult> {
  if (!isTauri()) {
    return normalizeMcpResourceReadResult(buildPreviewMcpResource(request));
  }

  const result = await invoke<McpResourceReadResult>(
    "tool_registry_mcp_resource_read",
    { request },
  );
  return normalizeMcpResourceReadResult(result);
}

export async function renderMcpPrompt(
  request: McpPromptRenderRequest,
): Promise<McpPromptRenderResult> {
  if (!isTauri()) {
    return normalizeMcpPromptRenderResult(buildPreviewMcpPrompt(request));
  }

  const result = await invoke<McpPromptRenderResult>(
    "tool_registry_mcp_prompt_render",
    { request },
  );
  return normalizeMcpPromptRenderResult(result);
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
