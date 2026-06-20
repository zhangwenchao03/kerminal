export type ToolCategory =
  | "terminal"
  | "workspace"
  | "settings"
  | "llmProvider"
  | "profile"
  | "remoteHost"
  | "ssh"
  | "sftp"
  | "portForward"
  | "serverInfo"
  | "snippet"
  | "history"
  | "diagnostics"
  | "workflow"
  | "connection";

export type ToolRiskLevel =
  | "read"
  | "write"
  | "remote"
  | "batch"
  | "destructive";

export type ToolConfirmationPolicy = "auto" | "contextual" | "always";

export type ToolAuditPolicy = "summary" | "full";
export type McpDefinitionOrigin = "system" | "custom";

export interface ToolDefinition {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  risk: ToolRiskLevel;
  confirmation: ToolConfirmationPolicy;
  audit: ToolAuditPolicy;
  enabled: boolean;
  exposedToMcp: boolean;
  inputSchema: Record<string, unknown>;
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean | null;
  destructiveHint?: boolean | null;
  idempotentHint?: boolean | null;
  openWorldHint?: boolean | null;
}

export interface McpToolDefinition {
  name: string;
  title?: string | null;
  description?: string | null;
  inputSchema: Record<string, unknown>;
  sourceToolId: string;
  risk: ToolRiskLevel;
  confirmation: ToolConfirmationPolicy;
  audit: ToolAuditPolicy;
  annotations: McpToolAnnotations;
  origin: McpDefinitionOrigin;
  serverId?: string | null;
}

export interface McpToolList {
  protocol: string;
  tools: McpToolDefinition[];
}

export interface McpAgentProfile {
  id: string;
  name: string;
  title: string;
  role: string;
  defaultLanguage: string;
  description: string;
  capabilities: McpAgentCapability[];
  operatingRules: string[];
  toolCallProtocol: string;
}

export interface McpAgentCapability {
  id: string;
  title: string;
  description: string;
  toolCategories: ToolCategory[];
  toolExamples: string[];
}

export interface McpSkillDefinition {
  id: string;
  title: string;
  description: string;
  whenToUse: string;
  triggerExamples: string[];
  toolIds: string[];
  promptGuidance: string;
  origin: McpDefinitionOrigin;
}

export interface McpGatewayManifest {
  protocol: string;
  generatedAt: string;
  server: McpServerInfo;
  agent: McpAgentProfile;
  tools: McpToolList;
  skills: McpSkillDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
  transports: McpTransportDefinition[];
  security: McpSecurityPolicy;
}

export interface McpServerInfo {
  name: string;
  title: string;
  version: string;
  description: string;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  dynamic: boolean;
}

export interface McpResourceReadRequest {
  uri: string;
  applicationContext?: unknown | null;
  terminalContext?: unknown | null;
  auditLimit?: number | null;
}

export interface McpResourceReadResult {
  uri: string;
  name: string;
  title: string;
  mimeType: string;
  generatedAt: string;
  content: Record<string, unknown>;
}

export interface McpPromptRenderRequest {
  name: string;
  arguments?: Record<string, unknown>;
  applicationContext?: unknown | null;
  terminalContext?: unknown | null;
}

export interface McpPromptRenderResult {
  protocol: string;
  name: string;
  title: string;
  description: string;
  generatedAt: string;
  arguments: Record<string, unknown>;
  messages: McpPromptMessage[];
}

export interface McpPromptMessage {
  role: string;
  contentType: string;
  text: string;
}

export interface McpPromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: McpPromptArgument[];
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export type McpTransportStatus = "enabled" | "planned" | "disabled";

export interface McpTransportDefinition {
  id?: string | null;
  kind: string;
  title: string;
  status: McpTransportStatus;
  command?: string | null;
  endpoint?: string | null;
  args: string[];
  envKeys: string[];
  headerKeys: string[];
  description: string;
  origin: McpDefinitionOrigin;
}

export interface McpSecurityPolicy {
  localOnly: boolean;
  externalAccessEnabled: boolean;
  requiresKerminalConfirmation: boolean;
  auditEnabled: boolean;
  secretsRedacted: boolean;
  notes: string[];
}

export function normalizeToolDefinition(tool: ToolDefinition): ToolDefinition {
  return {
    ...tool,
    inputSchema: normalizeSchema(tool.inputSchema),
  };
}

export function normalizeMcpToolList(list: McpToolList): McpToolList {
  return {
    protocol: list.protocol,
    tools: list.tools.map((tool) => ({
      ...tool,
      annotations: tool.annotations ?? {},
      description: tool.description ?? null,
      inputSchema: normalizeSchema(tool.inputSchema),
      origin: tool.origin ?? "system",
      serverId: tool.serverId ?? null,
      title: tool.title ?? null,
    })),
  };
}

export function normalizeMcpAgentProfile(
  agent?: McpAgentProfile | null,
): McpAgentProfile {
  return {
    capabilities: agent?.capabilities ?? [],
    defaultLanguage: agent?.defaultLanguage ?? "zh-CN",
    description: agent?.description ?? "",
    id: agent?.id ?? "kerminal-agent",
    name: agent?.name ?? "Kerminal Agent",
    operatingRules: agent?.operatingRules ?? [],
    role: agent?.role ?? "面向开发者终端工作台的本地 AI 操作代理",
    title: agent?.title ?? "Kerminal Agent",
    toolCallProtocol: agent?.toolCallProtocol ?? "",
  };
}

export function normalizeMcpGatewayManifest(
  manifest: McpGatewayManifest,
): McpGatewayManifest {
  return {
    ...manifest,
    agent: normalizeMcpAgentProfile(manifest.agent),
    prompts: (manifest.prompts ?? []).map((prompt) => ({
      ...prompt,
      arguments: prompt.arguments ?? [],
    })),
    resources: manifest.resources ?? [],
    security: {
      ...manifest.security,
      notes: manifest.security?.notes ?? [],
    },
    skills: (manifest.skills ?? []).map((skill) => ({
      ...skill,
      origin: skill.origin ?? "system",
      toolIds: skill.toolIds ?? [],
      triggerExamples: skill.triggerExamples ?? [],
    })),
    tools: normalizeMcpToolList(manifest.tools),
    transports: (manifest.transports ?? []).map((transport) => ({
      ...transport,
      args: transport.args ?? [],
      command: transport.command ?? null,
      endpoint: transport.endpoint ?? null,
      envKeys: transport.envKeys ?? [],
      headerKeys: transport.headerKeys ?? [],
      id: transport.id ?? null,
      origin: transport.origin ?? "system",
    })),
  };
}

export function normalizeMcpResourceReadResult(
  result: McpResourceReadResult,
): McpResourceReadResult {
  return {
    ...result,
    content: result.content ?? {},
  };
}

export function normalizeMcpPromptRenderResult(
  result: McpPromptRenderResult,
): McpPromptRenderResult {
  return {
    ...result,
    arguments: result.arguments ?? {},
    messages: (result.messages ?? []).map((message) => ({
      contentType: message.contentType ?? "text",
      role: message.role ?? "user",
      text: message.text ?? "",
    })),
  };
}

export function riskLabel(risk: ToolRiskLevel) {
  const labels: Record<ToolRiskLevel, string> = {
    batch: "批量",
    destructive: "破坏性",
    read: "读取",
    remote: "远程",
    write: "写入",
  };
  return labels[risk];
}

export function mcpTransportStatusLabel(status: McpTransportStatus) {
  const labels: Record<McpTransportStatus, string> = {
    disabled: "已禁用",
    enabled: "已启用",
    planned: "已预留",
  };
  return labels[status];
}

export function confirmationLabel(policy: ToolConfirmationPolicy) {
  const labels: Record<ToolConfirmationPolicy, string> = {
    always: "每次确认",
    auto: "可自动执行",
    contextual: "按上下文确认",
  };
  return labels[policy];
}

function normalizeSchema(schema: Record<string, unknown> | undefined) {
  return schema ?? { type: "object", properties: {}, required: [] };
}
