import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AiTerminalContextRequest } from "./aiContextApi";
import type { AiToolPendingInvocation } from "./aiToolInvocationApi";
import { browserPreviewMcpToolCount } from "./toolRegistryApi";

export interface AiChatRequest {
  message: string;
  attachments?: AiChatAttachmentContext[];
  conversationId?: string;
  conversationSlotJson?: string;
  history?: AiChatHistoryMessage[];
  providerId?: string;
  terminalContext?: AiTerminalContextRequest;
  applicationContext?: AiApplicationContextRequest;
  executionVisibility?: AiCommandExecutionVisibility;
}

export interface AiChatHistoryMessage {
  role: "assistant" | "user";
  content: string;
}

export type AiChatAttachmentKind = "image" | "file" | "diagnostic";
export type AiChatAttachmentStatus =
  | "available"
  | "missing"
  | "redacted"
  | "unsupported";
export type AiChatAttachmentVisionUsage =
  | "visionInput"
  | "ocrOnly"
  | "metadataOnly"
  | "blocked"
  | "notSent";
export type AiChatAttachmentModelInput =
  | "visionInput"
  | "textContext"
  | "notSent";

export interface AiChatAttachmentContext {
  id: string;
  kind: AiChatAttachmentKind;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  status: AiChatAttachmentStatus;
  height?: number | null;
  missingReason?: string | null;
  ocrText?: string | null;
  redactionSummary?: string | null;
  visionUsage?: AiChatAttachmentVisionUsage | null;
  width?: number | null;
}

export interface AiChatAttachmentVisionStatus {
  id: string;
  requestedUsage: AiChatAttachmentVisionUsage;
  effectiveUsage: AiChatAttachmentVisionUsage;
  modelInput: AiChatAttachmentModelInput;
  warning?: string | null;
}

export interface AiChatVisionUsageReport {
  providerSupportsVision: boolean;
  visionAdapterEnabled: boolean;
  attachments: AiChatAttachmentVisionStatus[];
}

export type AiCommandExecutionVisibility = "terminal" | "background";

export interface AiApplicationContextRequest {
  activeToolId?: string;
  activeTab?: AiApplicationTabContext;
  focusedPane?: AiApplicationPaneContext;
  selectedMachine?: AiApplicationMachineContext;
}

export interface AiApplicationTabContext {
  id: string;
  title: string;
  machineId?: string;
}

export interface AiApplicationPaneContext {
  id: string;
  title: string;
  mode: string;
  status: string;
  machineId?: string;
  sessionId?: string;
}

export interface AiApplicationMachineContext {
  id: string;
  name: string;
  kind: string;
  status: string;
  production?: boolean;
}

export interface AiChatResponse {
  conversationId: string;
  providerId: string;
  providerName: string;
  model: string;
  message: string;
  pendingInvocations: AiToolPendingInvocation[];
  responseRedacted: boolean;
  contextUsed: boolean;
  toolCount: number;
  generatedAt: string;
  visionUsage: AiChatVisionUsageReport;
}

export type AiChatStreamStepStatus = "active" | "done" | "error";

export interface AiChatStreamStep {
  detail?: string;
  id: "prepare" | "context" | "provider" | "render" | "complete";
  status: AiChatStreamStepStatus;
  title: string;
}

export interface AiChatStreamOptions {
  chunkDelayMs?: number;
  onDelta?: (delta: string) => void;
  onStep?: (step: AiChatStreamStep) => void;
}

export async function sendAiChatMessage(
  request: AiChatRequest,
): Promise<AiChatResponse> {
  const normalizedRequest = normalizeAiChatRequest(request);
  return executeAiChatMessage(normalizedRequest);
}

export async function streamAiChatMessage(
  request: AiChatRequest,
  options: AiChatStreamOptions = {},
): Promise<AiChatResponse> {
  const normalizedRequest = normalizeAiChatRequest(request);

  emitStreamStep(options, {
    id: "prepare",
    status: "active",
    title: "整理请求",
  });
  await yieldToUi();
  emitStreamStep(options, {
    id: "prepare",
    status: "done",
    title: "请求已整理",
  });

  const hasTerminalContext = Boolean(normalizedRequest.terminalContext?.sessionId);
  const hasApplicationContext = Boolean(normalizedRequest.applicationContext);
  emitStreamStep(options, {
    detail: hasTerminalContext
      ? normalizedRequest.terminalContext?.sessionId
      : hasApplicationContext
        ? normalizedRequest.applicationContext?.focusedPane?.id
        : undefined,
    id: "context",
    status: "active",
    title: hasTerminalContext
      ? "附加终端上下文"
      : hasApplicationContext
        ? "附加应用上下文"
        : "跳过终端上下文",
  });
  await yieldToUi();
  emitStreamStep(options, {
    detail: hasTerminalContext
      ? normalizedRequest.terminalContext?.sessionId
      : hasApplicationContext
        ? normalizedRequest.applicationContext?.focusedPane?.id
        : undefined,
    id: "context",
    status: "done",
    title:
      hasTerminalContext || hasApplicationContext
        ? "上下文已附加"
        : "本次无终端上下文",
  });

  emitStreamStep(options, {
    id: "provider",
    status: "active",
    title: "等待模型响应",
  });

  try {
    const response = await executeAiChatMessage(normalizedRequest);
    emitStreamStep(options, {
      detail: `${response.providerName} · ${response.model}`,
      id: "provider",
      status: "done",
      title: "模型已返回",
    });
    emitStreamStep(options, {
      id: "render",
      status: "active",
      title: "流式渲染回复",
    });
    await emitResponseChunks(response.message, options);
    emitStreamStep(options, {
      id: "render",
      status: "done",
      title: "回复渲染完成",
    });
    emitStreamStep(options, {
      id: "complete",
      status: "done",
      title: "完成",
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitStreamStep(options, {
      detail: message,
      id: "provider",
      status: "error",
      title: "模型响应失败",
    });
    throw error;
  }
}

async function executeAiChatMessage(
  normalizedRequest: AiChatRequest,
): Promise<AiChatResponse> {
  if (!isTauri()) {
    return browserPreviewChat(normalizedRequest);
  }

  const response = await invoke<AiChatResponse>("ai_chat", {
    request: normalizedRequest,
  });
  return normalizeAiChatResponse(response);
}

function normalizeAiChatRequest(request: AiChatRequest): AiChatRequest {
  const message = request.message.trim();
  if (!message) {
    throw new Error("请输入要发送给 AI 的内容");
  }
  const attachments = normalizeChatAttachments(request.attachments ?? []);
  const history = normalizeChatHistory(request.history ?? []);
  return {
    ...request,
    ...(attachments.length > 0 ? { attachments } : {}),
    conversationId: normalizeOptionalText(request.conversationId),
    conversationSlotJson: normalizeOptionalText(request.conversationSlotJson),
    ...(history.length > 0 ? { history } : {}),
    message,
    providerId: normalizeOptionalText(request.providerId),
  };
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeChatAttachments(
  attachments: AiChatAttachmentContext[],
): AiChatAttachmentContext[] {
  return attachments.map((attachment) => ({
    id: normalizeRequiredText("附件 ID", attachment.id),
    kind: normalizeAttachmentKind(attachment.kind),
    mimeType: normalizeRequiredText("附件 MIME", attachment.mimeType),
    originalName: normalizeRequiredText("附件名称", attachment.originalName),
    sizeBytes:
      Number.isFinite(attachment.sizeBytes) && attachment.sizeBytes > 0
        ? Math.floor(attachment.sizeBytes)
        : 0,
    status: normalizeAttachmentStatus(attachment.status),
    height: normalizeNullableNumber(attachment.height),
    missingReason: normalizeNullableText(attachment.missingReason),
    ocrText: normalizeNullableText(attachment.ocrText),
    redactionSummary: normalizeNullableText(attachment.redactionSummary),
    visionUsage: normalizeAttachmentVisionUsage(attachment.visionUsage),
    width: normalizeNullableNumber(attachment.width),
  }));
}

function normalizeChatHistory(history: AiChatHistoryMessage[]) {
  return history
    .map((message) => ({
      content: message.content.trim(),
      role: normalizeHistoryRole(message.role),
    }))
    .filter((message) => message.content.length > 0);
}

function normalizeHistoryRole(role: AiChatHistoryMessage["role"]) {
  if (role !== "assistant" && role !== "user") {
    throw new Error("AI 历史消息角色无效");
  }
  return role;
}

function normalizeRequiredText(field: string, value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field}不能为空`);
  }
  return normalized;
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeNullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function normalizeAttachmentKind(value: AiChatAttachmentKind) {
  if (value === "image" || value === "file" || value === "diagnostic") {
    return value;
  }
  throw new Error("附件类型不受支持");
}

function normalizeAttachmentStatus(value: AiChatAttachmentStatus) {
  if (
    value === "available" ||
    value === "missing" ||
    value === "redacted" ||
    value === "unsupported"
  ) {
    return value;
  }
  throw new Error("附件状态不受支持");
}

function normalizeAttachmentVisionUsage(
  value: AiChatAttachmentVisionUsage | null | undefined,
) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (
    value === "visionInput" ||
    value === "ocrOnly" ||
    value === "metadataOnly" ||
    value === "blocked" ||
    value === "notSent"
  ) {
    return value;
  }
  throw new Error("附件视觉使用方式不受支持");
}

function normalizeAiChatResponse(response: AiChatResponse): AiChatResponse {
  return {
    ...response,
    pendingInvocations: response.pendingInvocations ?? [],
    visionUsage: normalizeAiChatVisionUsageReport(response.visionUsage),
  };
}

function normalizeAiChatVisionUsageReport(
  report: AiChatVisionUsageReport | null | undefined,
): AiChatVisionUsageReport {
  if (!report) {
    return emptyVisionUsageReport();
  }
  return {
    attachments: Array.isArray(report.attachments)
      ? report.attachments.map(normalizeAiChatAttachmentVisionStatus)
      : [],
    providerSupportsVision: report.providerSupportsVision === true,
    visionAdapterEnabled: report.visionAdapterEnabled === true,
  };
}

function normalizeAiChatAttachmentVisionStatus(
  status: AiChatAttachmentVisionStatus,
): AiChatAttachmentVisionStatus {
  return {
    effectiveUsage:
      normalizeAttachmentVisionUsage(status.effectiveUsage) ?? "notSent",
    id: normalizeRequiredText("附件视觉状态 ID", status.id),
    modelInput: normalizeAttachmentModelInput(status.modelInput),
    requestedUsage:
      normalizeAttachmentVisionUsage(status.requestedUsage) ?? "notSent",
    warning: normalizeNullableText(status.warning) ?? null,
  };
}

function normalizeAttachmentModelInput(
  value: AiChatAttachmentModelInput | null | undefined,
): AiChatAttachmentModelInput {
  if (
    value === "visionInput" ||
    value === "textContext" ||
    value === "notSent"
  ) {
    return value;
  }
  return "notSent";
}

function emptyVisionUsageReport(): AiChatVisionUsageReport {
  return {
    attachments: [],
    providerSupportsVision: false,
    visionAdapterEnabled: false,
  };
}

function emitStreamStep(
  options: AiChatStreamOptions,
  step: AiChatStreamStep,
) {
  options.onStep?.(step);
}

async function emitResponseChunks(
  message: string,
  options: AiChatStreamOptions,
) {
  if (!options.onDelta) {
    return;
  }

  const chunks = splitStreamChunks(message);
  for (const chunk of chunks) {
    options.onDelta(chunk);
    if (options.chunkDelayMs === 0) {
      await yieldToUi();
    } else {
      await delay(options.chunkDelayMs ?? 12);
    }
  }
}

function splitStreamChunks(message: string) {
  const chunks: string[] = [];
  let buffer = "";
  for (const part of message.match(/\S+\s*|\s+/g) ?? [message]) {
    buffer += part;
    if (buffer.length >= 18 || /[\n。！？.!?]\s*$/.test(buffer)) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer) {
    chunks.push(buffer);
  }
  return chunks;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function yieldToUi() {
  return delay(0);
}

function browserPreviewChat(request: AiChatRequest): AiChatResponse {
  const contextText = request.terminalContext?.sessionId
    ? "已读取当前终端上下文"
    : request.applicationContext
      ? "已接入当前应用上下文"
      : "未绑定真实终端上下文";
  const visibilityText =
    request.executionVisibility === "background"
      ? "后台运行"
      : "显示在终端";
  const paneText = request.applicationContext?.focusedPane
    ? `当前 pane：${request.applicationContext.focusedPane.title} (${request.applicationContext.focusedPane.id})`
    : "当前 pane：-";
  const attachmentText = request.attachments?.length
    ? `附件：${request.attachments
        .map((attachment) => `${attachment.originalName} (${attachment.status})`)
        .join("、")}`
    : "附件：无";
  const visionUsage = browserPreviewVisionUsage(request.attachments ?? []);
  return normalizeAiChatResponse({
    contextUsed: Boolean(
      request.terminalContext?.sessionId ||
        request.applicationContext ||
        request.attachments?.length,
    ),
    conversationId:
      request.conversationId ?? `browser-chat-${Date.now().toString(36)}`,
    generatedAt: currentUnixTimestamp(),
    message: [
      `浏览器预览：${contextText}。Kerminal Agent 是当前应用的操作层，MCP 工具是它可受控调用的手脚。`,
      paneText,
      attachmentText,
      `视觉状态：浏览器预览不会发送图片像素；${visionUsage.attachments.length > 0 ? "附件仅以文本 metadata/OCR 状态参与上下文。" : "无附件视觉上下文。"}`,
      `命令显示模式：${visibilityText}`,
      "",
      "当前问题：",
      `- ${request.message}`,
      "",
      "```powershell",
      "npm run test:frontend",
      "```",
    ].join("\n"),
    model: "browser-preview",
    providerId: "browser-preview",
    providerName: "浏览器预览 Provider",
    responseRedacted: false,
    pendingInvocations: [],
    toolCount: browserPreviewMcpToolCount,
    visionUsage,
  });
}

function browserPreviewVisionUsage(
  attachments: AiChatAttachmentContext[],
): AiChatVisionUsageReport {
  return {
    attachments: attachments.map((attachment) =>
      browserPreviewAttachmentVisionStatus(attachment),
    ),
    providerSupportsVision: false,
    visionAdapterEnabled: false,
  };
}

function browserPreviewAttachmentVisionStatus(
  attachment: AiChatAttachmentContext,
): AiChatAttachmentVisionStatus {
  const requestedUsage = attachment.visionUsage ?? "notSent";
  const effectiveUsage =
    requestedUsage === "visionInput" ? "metadataOnly" : requestedUsage;
  return {
    effectiveUsage,
    id: attachment.id,
    modelInput:
      effectiveUsage === "ocrOnly" || effectiveUsage === "metadataOnly"
        ? "textContext"
        : "notSent",
    requestedUsage,
    warning:
      requestedUsage === "visionInput"
        ? "浏览器预览不会发送图片像素，已降级为文本附件上下文。"
        : null,
  };
}

function currentUnixTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}
