import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ToolAuditPolicy,
  ToolConfirmationPolicy,
  ToolRiskLevel,
} from "../features/tool-panel/toolRegistryModel";
import { isToolId } from "../features/workspace/types";
import { previewTools } from "./toolRegistryPreview";

type BrowserPreviewTool = (typeof previewTools)[number];

export type AiToolInvocationStatus =
  | "pending"
  | "rejected"
  | "succeeded"
  | "failed";

export interface AiToolPrepareRequest {
  toolId: string;
  arguments?: Record<string, unknown>;
  requestedBy?: string;
  reason?: string;
  conversationId?: string | null;
  conversationSlotJson?: string | null;
  runId?: string | null;
  stepId?: string | null;
}

export interface AiToolConfirmRequest {
  invocationId: string;
  approved: boolean;
  auditContext?: AiToolAuditContext | null;
}

export interface AiToolAuditListOptions {
  limit?: number;
}

export type AiToolClientActionKind =
  | "terminalCreate"
  | "sshConnect"
  | "workspaceSplitPane"
  | "workspaceFocusTab"
  | "workspaceOpenTool";

export interface AiToolClientAction {
  kind: AiToolClientActionKind;
  direction?: "horizontal" | "vertical" | null;
  title?: string | null;
  shell?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  env?: Record<string, string> | null;
  hostId?: string | null;
  tabId?: string | null;
  toolId?: string | null;
  cols?: number | null;
  rows?: number | null;
}

export interface AiToolPendingInvocation {
  id: string;
  toolId: string;
  toolTitle: string;
  risk: ToolRiskLevel;
  confirmation: ToolConfirmationPolicy;
  audit: ToolAuditPolicy;
  argumentsSummary: string;
  riskSummary?: string | null;
  clientAction?: AiToolClientAction | null;
  reason?: string | null;
  requestedBy?: string | null;
  requiresConfirmation: boolean;
  status: AiToolInvocationStatus;
  createdAt: string;
  conversationId?: string | null;
  conversationSlotJson?: string | null;
  runId?: string | null;
  stepId?: string | null;
}

export interface AiToolPendingContextUpdateRequest {
  invocationId: string;
  conversationId?: string | null;
  conversationSlotJson?: string | null;
}

export interface AiToolAuditRecord {
  id: string;
  invocationId: string;
  toolId: string;
  toolTitle: string;
  risk: ToolRiskLevel;
  confirmation: ToolConfirmationPolicy;
  argumentsSummary: string;
  riskSummary?: string | null;
  status: AiToolInvocationStatus;
  resultSummary?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt: string;
  auditContext?: AiToolAuditContext | null;
  observationJson?: unknown | null;
}

export interface AiToolAuditContext {
  attachmentIds?: string[];
  assistantMessageId?: string | null;
  contextSnapshotId?: string | null;
  conversationId?: string | null;
  hostId?: string | null;
  paneId?: string | null;
  routeMode?: string | null;
  scopeKind?: string | null;
  scopeRefJson?: string | null;
  tabId?: string | null;
  targetKey?: string | null;
  targetRefJson?: string | null;
  userMessageId?: string | null;
  runId?: string | null;
  stepId?: string | null;
}

export interface AiToolAuditExport {
  exportedAt: string;
  count: number;
  records: AiToolAuditRecord[];
}

export interface AiToolAuditClearResponse {
  clearedCount: number;
}

const MAX_AUDIT_RECORDS = 100;
const DEFAULT_BROWSER_AUDIT_LIMIT = 20;

const browserPreviewAudits: AiToolAuditRecord[] = [];
const browserPreviewPendingInvocations = new Map<
  string,
  AiToolPendingInvocation
>();

export async function prepareAiToolInvocation(
  request: AiToolPrepareRequest,
): Promise<AiToolPendingInvocation> {
  const normalizedRequest = normalizePrepareRequest(request);

  if (!isTauri()) {
    const pending = browserPreviewPending(normalizedRequest);
    browserPreviewPendingInvocations.set(pending.id, pending);
    return pending;
  }

  return invoke<AiToolPendingInvocation>("ai_tool_prepare", {
    request: normalizedRequest,
  });
}

export async function confirmAiToolInvocation(
  request: AiToolConfirmRequest,
): Promise<AiToolAuditRecord> {
  if (!isTauri()) {
    const audit = browserPreviewAudit(request);
    browserPreviewAudits.unshift(audit);
    return audit;
  }

  return invoke<AiToolAuditRecord>("ai_tool_confirm", { request });
}

export async function listAiToolPendingInvocations(): Promise<
  AiToolPendingInvocation[]
> {
  if (!isTauri()) {
    return Array.from(browserPreviewPendingInvocations.values());
  }

  return invoke<AiToolPendingInvocation[]>("ai_tool_pending_list");
}

export async function updateAiToolPendingContext(
  request: AiToolPendingContextUpdateRequest,
): Promise<AiToolPendingInvocation> {
  const normalizedRequest = normalizePendingContextUpdateRequest(request);
  if (!isTauri()) {
    const pending = browserPreviewPendingInvocations.get(
      normalizedRequest.invocationId,
    );
    if (!pending) {
      throw new Error("待确认工具调用不存在");
    }
    const updated = {
      ...pending,
      conversationId: normalizedRequest.conversationId ?? null,
      conversationSlotJson: normalizedRequest.conversationSlotJson ?? null,
    };
    browserPreviewPendingInvocations.set(updated.id, updated);
    return updated;
  }

  return invoke<AiToolPendingInvocation>("ai_tool_pending_update_context", {
    request: normalizedRequest,
  });
}

export async function listAiToolAudits(
  options?: AiToolAuditListOptions,
): Promise<AiToolAuditRecord[]> {
  const limit = normalizeAuditLimit(options?.limit, DEFAULT_BROWSER_AUDIT_LIMIT);
  if (!isTauri()) {
    return browserPreviewAudits.slice(0, limit);
  }

  const args = auditListInvokeArgs(options);
  return args
    ? invoke<AiToolAuditRecord[]>("ai_tool_audit_list", args)
    : invoke<AiToolAuditRecord[]>("ai_tool_audit_list");
}

export async function exportAiToolAudits(
  options?: AiToolAuditListOptions,
): Promise<AiToolAuditExport> {
  const limit = normalizeAuditLimit(options?.limit, DEFAULT_BROWSER_AUDIT_LIMIT);
  if (!isTauri()) {
    const records = browserPreviewAudits.slice(0, limit);
    return {
      count: records.length,
      exportedAt: currentUnixTimestamp(),
      records,
    };
  }

  const args = auditListInvokeArgs(options);
  return args
    ? invoke<AiToolAuditExport>("ai_tool_audit_export", args)
    : invoke<AiToolAuditExport>("ai_tool_audit_export");
}

export async function clearAiToolAudits(): Promise<AiToolAuditClearResponse> {
  if (!isTauri()) {
    const clearedCount = browserPreviewAudits.length;
    browserPreviewAudits.splice(0, browserPreviewAudits.length);
    return { clearedCount };
  }

  return invoke<AiToolAuditClearResponse>("ai_tool_audit_clear");
}

function normalizePrepareRequest(
  request: AiToolPrepareRequest,
): Required<Pick<AiToolPrepareRequest, "arguments" | "toolId">> &
  Omit<AiToolPrepareRequest, "arguments" | "toolId"> {
  return {
    ...request,
    arguments: request.arguments ?? {},
    conversationId: normalizeNullableText(request.conversationId),
    conversationSlotJson: normalizeNullableText(request.conversationSlotJson),
    runId: normalizeNullableText(request.runId),
    stepId: normalizeNullableText(request.stepId),
    toolId: request.toolId.trim(),
  };
}

function normalizePendingContextUpdateRequest(
  request: AiToolPendingContextUpdateRequest,
): AiToolPendingContextUpdateRequest {
  const invocationId = request.invocationId.trim();
  if (!invocationId) {
    throw new Error("待确认工具调用 id 不能为空");
  }
  return {
    invocationId,
    conversationId: normalizeNullableText(request.conversationId),
    conversationSlotJson: normalizeNullableText(request.conversationSlotJson),
  };
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function auditListInvokeArgs(options?: AiToolAuditListOptions) {
  if (!options || options.limit === undefined) {
    return undefined;
  }
  return {
    request: {
      limit: normalizeAuditLimit(options.limit, MAX_AUDIT_RECORDS),
    },
  };
}

function normalizeAuditLimit(value: number | undefined, defaultLimit: number) {
  if (value === undefined) {
    return defaultLimit;
  }
  if (!Number.isFinite(value)) {
    return defaultLimit;
  }
  return Math.max(0, Math.min(Math.trunc(value), MAX_AUDIT_RECORDS));
}

function browserPreviewPending(
  request: ReturnType<typeof normalizePrepareRequest>,
): AiToolPendingInvocation {
  const tool = browserPreviewToolDefinition(request.toolId);
  const toolTitle = tool?.title ?? request.toolId;
  const riskSummary = commandRiskSummary(request);
  const risk = browserPreviewRisk(tool, riskSummary);
  const confirmation = browserPreviewConfirmation(tool, risk, riskSummary);
  return {
    argumentsSummary: summarizeArguments(request.arguments),
    audit: browserPreviewAuditPolicy(tool, risk),
    clientAction: clientActionForPreview(request),
    confirmation,
    createdAt: currentUnixTimestamp(),
    conversationId: request.conversationId ?? null,
    conversationSlotJson: request.conversationSlotJson ?? null,
    runId: request.runId ?? null,
    stepId: request.stepId ?? null,
    id: `browser-tool-call-${Date.now().toString(36)}`,
    reason: request.reason ?? null,
    requestedBy: request.requestedBy ?? "browser-preview",
    requiresConfirmation: confirmation !== "auto",
    risk,
    riskSummary,
    status: "pending",
    toolId: request.toolId,
    toolTitle,
  };
}

function browserPreviewAudit(request: AiToolConfirmRequest): AiToolAuditRecord {
  const now = currentUnixTimestamp();
  const pending = browserPreviewPendingInvocations.get(request.invocationId);
  browserPreviewPendingInvocations.delete(request.invocationId);
  return {
    auditContext: request.auditContext ?? null,
    argumentsSummary: pending?.argumentsSummary ?? "无参数",
    completedAt: now,
    confirmation: pending?.confirmation ?? "contextual",
    createdAt: pending?.createdAt ?? now,
    error: null,
    id: `browser-tool-audit-${Date.now().toString(36)}`,
    invocationId: request.invocationId,
    resultSummary: browserPreviewResultSummary(pending, request.approved),
    risk: pending?.risk ?? "write",
    riskSummary: pending?.riskSummary ?? null,
    status: request.approved ? "succeeded" : "rejected",
    toolId: pending?.toolId ?? "settings.update_theme",
    toolTitle: pending?.toolTitle ?? "更新主题",
  };
}

function browserPreviewResultSummary(
  pending: AiToolPendingInvocation | undefined,
  approved: boolean,
) {
  if (!approved) {
    return "用户已拒绝执行。";
  }
  if (pending?.toolId === "settings.update_terminal_appearance") {
    return "终端外观已更新，浏览器预览已模拟保存字体、字号和滚屏缓冲设置。";
  }
  if (pending?.toolId === "workspace.split_pane") {
    const directionLabel =
      pending.clientAction?.direction === "vertical" ? "上下分屏" : "左右分屏";
    return `工作区${directionLabel}已批准，浏览器预览已执行。`;
  }
  if (pending?.toolId === "workspace.focus_tab") {
    return "终端 tab 切换已批准，浏览器预览已执行。";
  }
  if (pending?.toolId === "workspace.open_tool") {
    return "工具面板切换已批准，浏览器预览已执行。";
  }
  if (pending?.toolId === "terminal.create") {
    return "本地终端已批准创建，浏览器预览已模拟打开新 tab。";
  }
  if (pending?.toolId === "terminal.list") {
    return "终端会话已读取，浏览器预览已模拟返回会话摘要。";
  }
  if (pending?.toolId === "terminal.close") {
    return "终端会话已关闭，浏览器预览已模拟移除本地 PTY 会话。";
  }
  if (pending?.toolId === "terminal.log.start") {
    return "终端日志已开始，浏览器预览已模拟写入本地日志文件。";
  }
  if (pending?.toolId === "terminal.log.stop") {
    return "终端日志已停止，浏览器预览已模拟返回日志路径。";
  }
  if (pending?.toolId === "terminal.log.state") {
    return "终端日志状态已读取，浏览器预览已模拟返回当前记录状态。";
  }
  if (pending?.toolId === "settings.get") {
    return "应用设置已读取，浏览器预览已模拟返回主题、终端和 AI 安全策略摘要。";
  }
  if (pending?.toolId === "settings.update_ai_security") {
    return "AI 安全策略已更新，浏览器预览已模拟保存确认、上下文和破坏性工具策略。";
  }
  if (pending?.toolId === "llm_provider.list") {
    return "模型 Provider 已读取，浏览器预览已模拟返回配置摘要且不包含 API key。";
  }
  if (pending?.toolId === "llm_provider.create") {
    return "模型 Provider 已创建，浏览器预览已模拟写入配置和本地凭据引用。";
  }
  if (pending?.toolId === "llm_provider.update") {
    return "模型 Provider 已更新，浏览器预览已模拟保存配置变更。";
  }
  if (pending?.toolId === "llm_provider.delete") {
    return "模型 Provider 已删除，浏览器预览已模拟清理对应凭据引用。";
  }
  if (pending?.toolId === "llm_provider.test") {
    return "模型 Provider 已完成 dry validation，浏览器预览未发送真实 LLM 请求。";
  }
  if (pending?.toolId === "profile.create") {
    return "终端配置已创建，浏览器预览已模拟写入。";
  }
  if (pending?.toolId === "profile.list") {
    return "终端配置已读取，浏览器预览已模拟返回本地 profile 列表。";
  }
  if (pending?.toolId === "profile.detect_shells") {
    return "可用 Shell 已探测，浏览器预览已模拟返回候选列表。";
  }
  if (pending?.toolId === "profile.update") {
    return "终端配置已更新，浏览器预览已模拟保存。";
  }
  if (pending?.toolId === "profile.delete") {
    return "终端配置已删除，浏览器预览已模拟保留至少一个 profile。";
  }
  if (pending?.toolId === "remote_host.create") {
    return "远程主机已创建，浏览器预览已模拟刷新主机树。";
  }
  if (pending?.toolId === "remote_host.group_list") {
    return "远程主机分组已读取，浏览器预览已模拟返回分组摘要。";
  }
  if (pending?.toolId === "remote_host.tree") {
    return "远程主机树已读取，浏览器预览已模拟返回分组和主机摘要。";
  }
  if (pending?.toolId === "remote_host.group_create") {
    return "远程主机分组已创建，浏览器预览已模拟刷新主机树。";
  }
  if (pending?.toolId === "remote_host.group_update") {
    return "远程主机分组已更新，浏览器预览已模拟刷新主机树。";
  }
  if (pending?.toolId === "remote_host.group_delete") {
    return "远程主机分组已删除，浏览器预览已模拟将组内主机移到默认分组。";
  }
  if (pending?.toolId === "remote_host.update") {
    return "远程主机已更新，浏览器预览已模拟刷新主机树。";
  }
  if (pending?.toolId === "remote_host.delete") {
    return "远程主机已删除，浏览器预览已模拟刷新主机树。";
  }
  if (pending?.toolId === "ssh.connect") {
    return "SSH 终端已批准打开，浏览器预览已模拟创建远程 tab。";
  }
  if (
    pending?.toolId === "ssh.command" ||
    pending?.toolId === "ssh.command_on_resolved_host"
  ) {
    return "远程命令已执行，浏览器预览已模拟返回 stdout/stderr 摘要。";
  }
  if (pending?.toolId === "connection.rdp_open") {
    return "RDP 连接已请求启动，浏览器预览已模拟生成临时 .rdp 文件。";
  }
  if (pending?.toolId === "server_info.snapshot") {
    return "服务器信息已读取，浏览器预览已模拟返回 CPU、内存、磁盘和运行时间摘要。";
  }
  if (pending?.toolId === "diagnostics.runtime_health") {
    return "运行体检已读取，浏览器预览已模拟返回进程、本机资源和数据目录摘要。";
  }
  if (pending?.toolId === "diagnostics.create_bundle") {
    return "诊断包已生成，浏览器预览已模拟写入本地脱敏 JSON。";
  }
  if (pending?.toolId === "port_forward.create") {
    return "端口转发已创建，浏览器预览已模拟启动 SSH 隧道。";
  }
  if (pending?.toolId === "port_forward.list") {
    return "端口转发会话已读取，浏览器预览已模拟返回运行中隧道摘要。";
  }
  if (pending?.toolId === "port_forward.close") {
    return "端口转发已关闭，浏览器预览已模拟停止 SSH 隧道。";
  }
  if (pending?.toolId === "sftp.list") {
    return "远程目录已读取，浏览器预览已模拟返回目录条目摘要。";
  }
  if (pending?.toolId === "sftp.rename") {
    return "远程路径已重命名，浏览器预览已模拟完成 SFTP 写操作。";
  }
  if (pending?.toolId === "sftp.move") {
    return "远程路径已移动，浏览器预览已模拟完成 SFTP 写操作。";
  }
  if (pending?.toolId === "sftp.preview") {
    return "远程文件已预览，浏览器预览已模拟返回文本片段。";
  }
  if (pending?.toolId === "sftp.download") {
    return "远程文件已下载，浏览器预览已模拟完成 SFTP 下载操作。";
  }
  if (pending?.toolId === "sftp.upload") {
    return "本地文件已上传，浏览器预览已模拟完成 SFTP 上传操作。";
  }
  if (pending?.toolId === "sftp.delete") {
    return "远程文件删除已执行，浏览器预览已模拟完成破坏性 SFTP 操作。";
  }
  if (pending?.toolId === "sftp.create_directory") {
    return "远程目录已创建，浏览器预览已模拟完成 SFTP 写操作。";
  }
  if (pending?.toolId === "sftp.chmod") {
    return "远程路径权限已修改，浏览器预览已模拟完成 SFTP chmod。";
  }
  if (pending?.toolId === "sftp.upload_directory") {
    return "本地目录已上传，浏览器预览已模拟完成递归 SFTP 上传。";
  }
  if (pending?.toolId === "sftp.download_directory") {
    return "远程目录已下载，浏览器预览已模拟完成递归 SFTP 下载。";
  }
  if (pending?.toolId === "sftp.transfer.enqueue") {
    return "SFTP 传输任务已加入队列，浏览器预览已模拟返回任务 id 和初始进度。";
  }
  if (pending?.toolId === "sftp.transfer.list") {
    return "SFTP 传输队列已读取，浏览器预览已模拟返回任务状态摘要。";
  }
  if (pending?.toolId === "sftp.transfer.cancel") {
    return "SFTP 传输任务已请求取消，浏览器预览已模拟更新任务状态。";
  }
  if (pending?.toolId === "sftp.transfer.clear_completed") {
    return "已清理结束的 SFTP 传输任务，浏览器预览已模拟保留未结束任务。";
  }
  if (pending?.toolId === "snippet.create") {
    return "脚本片段已创建，浏览器预览已模拟写入。";
  }
  if (pending?.toolId === "snippet.list") {
    return "脚本片段已读取，浏览器预览已模拟返回搜索结果。";
  }
  if (pending?.toolId === "snippet.update") {
    return "脚本片段已更新，浏览器预览已模拟保存。";
  }
  if (pending?.toolId === "snippet.delete") {
    return "脚本片段已删除，浏览器预览已模拟移除记录。";
  }
  if (pending?.toolId === "workflow.create") {
    return "命令工作流已创建，浏览器预览已模拟保存多步骤流程。";
  }
  if (pending?.toolId === "workflow.list") {
    return "命令工作流已读取，浏览器预览已模拟返回搜索结果。";
  }
  if (pending?.toolId === "workflow.update") {
    return "命令工作流已更新，浏览器预览已模拟保存多步骤流程。";
  }
  if (pending?.toolId === "workflow.delete") {
    return "命令工作流已删除，浏览器预览已模拟移除记录。";
  }
  if (pending?.toolId === "history.search") {
    return "命令历史已读取，浏览器预览已模拟返回匹配命令摘要。";
  }
  if (pending?.toolId === "history.record") {
    return "命令历史已记录，浏览器预览已模拟写入本地历史。";
  }
  if (pending?.toolId === "history.delete") {
    return "命令历史已删除，浏览器预览已模拟移除指定记录。";
  }
  if (pending?.toolId === "history.clear") {
    return "命令历史已清空，浏览器预览已模拟删除本地历史记录。";
  }
  return "浏览器预览已模拟执行，真实应用会通过 Tauri/Rust 受控执行。";
}

function browserPreviewRisk(
  tool: BrowserPreviewTool | undefined,
  riskSummary: string | null,
): ToolRiskLevel {
  if (riskSummary) {
    return "destructive";
  }
  return tool?.risk ?? "write";
}

function browserPreviewAuditPolicy(
  tool: BrowserPreviewTool | undefined,
  risk: ToolRiskLevel,
): ToolAuditPolicy {
  if (
    (tool?.id === "ssh.command" || tool?.id === "ssh.command_on_resolved_host") &&
    risk === "destructive"
  ) {
    return "full";
  }
  return tool?.audit ?? (risk === "destructive" ? "full" : "summary");
}

function browserPreviewConfirmation(
  tool: BrowserPreviewTool | undefined,
  risk: ToolRiskLevel,
  riskSummary: string | null,
): ToolConfirmationPolicy {
  if (riskSummary) {
    return "always";
  }
  return tool?.confirmation ?? defaultConfirmationForRisk(risk);
}

function browserPreviewToolDefinition(toolId: string) {
  return previewTools.find((tool) => tool.enabled && tool.id === toolId);
}

function defaultConfirmationForRisk(risk: ToolRiskLevel): ToolConfirmationPolicy {
  if (risk === "read") {
    return "auto";
  }
  if (risk === "remote" || risk === "batch" || risk === "destructive") {
    return "always";
  }
  return "contextual";
}

function clientActionForPreview(
  request: ReturnType<typeof normalizePrepareRequest>,
): AiToolClientAction | null {
  if (request.toolId === "terminal.create") {
    const cols = numberArgument(request.arguments.cols);
    const rows = numberArgument(request.arguments.rows);
    if (!cols || !rows) {
      return null;
    }
    return {
      args: stringArrayArgument(request.arguments.args),
      cols,
      cwd: stringArgument(request.arguments.cwd),
      env: stringRecordArgument(request.arguments.env),
      kind: "terminalCreate",
      rows,
      shell: stringArgument(request.arguments.shell),
      title: stringArgument(request.arguments.title),
    };
  }
  if (request.toolId === "ssh.connect") {
    const cols = numberArgument(request.arguments.cols);
    const rows = numberArgument(request.arguments.rows);
    const hostId = stringArgument(request.arguments.hostId);
    if (!cols || !rows || !hostId) {
      return null;
    }
    return {
      cols,
      hostId,
      kind: "sshConnect",
      rows,
    };
  }
  if (request.toolId === "workspace.focus_tab") {
    const tabId = stringArgument(request.arguments.tabId)?.trim();
    if (!tabId) {
      return null;
    }
    return {
      kind: "workspaceFocusTab",
      tabId,
    };
  }
  if (request.toolId === "workspace.open_tool") {
    const toolId = stringArgument(request.arguments.toolId)?.trim();
    if (!toolId || !isToolId(toolId)) {
      return null;
    }
    return {
      kind: "workspaceOpenTool",
      toolId,
    };
  }
  if (request.toolId === "workspace.split_pane") {
    const direction = request.arguments.direction;
    if (direction !== "horizontal" && direction !== "vertical") {
      return null;
    }
    return {
      direction,
      kind: "workspaceSplitPane",
    };
  }
  return null;
}

function stringArgument(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringArrayArgument(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function stringRecordArgument(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === "string")) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function numberArgument(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(Math.trunc(value), 65535);
}

function summarizeArguments(argumentsObject: Record<string, unknown>) {
  const entries = Object.entries(argumentsObject);
  if (entries.length === 0) {
    return "无参数";
  }
  return entries
    .map(([key, value]) => `${key}=${summarizeValue(key, value)}`)
    .join(", ");
}

function summarizeValue(key: string, value: unknown): string {
  if (isSensitiveKey(key)) {
    return "[已脱敏]";
  }
  if (typeof value === "string") {
    return value.length > 96 ? `${value.slice(0, 96)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.length} 项]`;
  }
  if (typeof value === "object") {
    return summarizeObject(value as Record<string, unknown>);
  }
  return String(value);
}

function summarizeObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "{}";
  }
  const visibleEntries: string[] = entries
    .slice(0, 6)
    .map(([key, nestedValue]) => `${key}=${summarizeValue(key, nestedValue)}`);
  if (entries.length > visibleEntries.length) {
    visibleEntries.push(`...共 ${entries.length} 项`);
  }
  return `{${visibleEntries.join(", ")}}`;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase();
  return ["key", "token", "secret", "password", "passwd", "credential"].some(
    (part) => normalized.includes(part),
  );
}

function commandRiskSummary(
  request: ReturnType<typeof normalizePrepareRequest>,
) {
  if (
    request.toolId !== "terminal.write" &&
    request.toolId !== "ssh.command" &&
    request.toolId !== "ssh.command_on_resolved_host"
  ) {
    return null;
  }
  const data =
    request.toolId === "terminal.write"
      ? request.arguments.data
      : request.arguments.command;
  if (typeof data !== "string") {
    return null;
  }
  const normalized = normalizeCommandForRisk(data);
  const findings: string[] = [];

  if (containsAny(normalized, ["rm -rf", "rm -fr", "rm -r /", "rm -rf /"])) {
    findings.push("包含递归强制删除命令");
  }
  if (
    normalized.includes("remove-item") &&
    normalized.includes("-recurse") &&
    normalized.includes("-force")
  ) {
    findings.push("包含 PowerShell 递归强制删除命令");
  }
  if (containsAny(normalized, ["mkfs", "diskpart", "format ", "format.com"])) {
    findings.push("包含磁盘格式化或分区命令");
  }
  if (containsAny(normalized, ["sudo ", "runas "])) {
    findings.push("包含权限提升命令");
  }
  if (containsAny(normalized, ["shutdown", "reboot", "restart-computer"])) {
    findings.push("包含关机或重启命令");
  }
  if (normalized.includes("dd if=") || normalized.includes("dd of=")) {
    findings.push("包含原始磁盘写入命令");
  }
  if (
    (normalized.includes("curl ") || normalized.includes("wget ")) &&
    containsAny(normalized, ["| sh", "| bash", "| zsh", "| powershell"])
  ) {
    findings.push("包含下载脚本后直接执行");
  }
  if (
    containsAny(normalized, ["invoke-expression", " iex ", "|iex", "| iex"])
  ) {
    findings.push("包含 PowerShell 动态执行");
  }
  if (containsAny(normalized, ["drop database", "truncate table"])) {
    findings.push("包含数据库删除或清空操作");
  }
  if (
    containsAny(normalized, [
      "kubectl delete",
      "docker system prune",
      "docker volume rm",
      "docker rm -f",
    ])
  ) {
    findings.push("包含容器或 Kubernetes 删除操作");
  }

  if (findings.length === 0) {
    return null;
  }
  const prefix =
    request.toolId === "terminal.write" ? "终端写入命令风险" : "远程命令风险";
  const guidance =
    request.toolId === "terminal.write"
      ? "请确认目标 session、主机和工作目录后再执行。"
      : "请确认目标 SSH 主机、用户和工作目录后再执行。";
  return `${prefix}：${[...new Set(findings)].join("、")}。${guidance}`;
}

function normalizeCommandForRisk(data: string) {
  return data
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function containsAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function currentUnixTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}
