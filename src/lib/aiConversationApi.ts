import { invoke, isTauri } from "@tauri-apps/api/core";

export type AiConversationScopeKind =
  | "noContext"
  | "followFocus"
  | "lockedPane"
  | "lockedHost"
  | "workspaceTask";
export type AiConversationRouteMode =
  | "followWorkspaceTarget"
  | "pinnedConversation"
  | "noContextChat";
export type AiConversationStatus = "idle" | "running" | "waiting" | "failed";
export type AiConversationMessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool";
export type AiConversationMessageStatus =
  | "draft"
  | "streaming"
  | "complete"
  | "error";
export type AiAttachmentKind = "image" | "file" | "diagnostic";
export type AiAttachmentStorageMode = "managedCopy" | "linkedFile";
export type AiAttachmentSourceKind =
  | "drag"
  | "paste"
  | "picker"
  | "screenshot"
  | "terminalSelection"
  | "toolOutput";
export type AiAttachmentStatus =
  | "available"
  | "missing"
  | "redacted"
  | "unsupported";
export type AiAttachmentMissingReason =
  | "deleted"
  | "moved"
  | "permissionDenied"
  | "outsideScope"
  | "unknown";
export type AiAttachmentVisionUsage =
  | "visionInput"
  | "ocrOnly"
  | "metadataOnly"
  | "blocked"
  | "notSent";

export interface AiConversation {
  id: string;
  title: string;
  scopeKind: AiConversationScopeKind;
  scopeRefJson: string;
  targetKey?: string | null;
  hostId?: string | null;
  tabId?: string | null;
  paneId?: string | null;
  providerId?: string | null;
  model?: string | null;
  status: string;
  summary?: string | null;
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number | null;
  archivedAt?: number | null;
  messages: AiConversationMessage[];
  attachments: AiAttachment[];
}

export interface AiConversationSummary {
  id: string;
  title: string;
  scopeKind: AiConversationScopeKind;
  scopeRefJson: string;
  targetKey?: string | null;
  hostId?: string | null;
  tabId?: string | null;
  paneId?: string | null;
  providerId?: string | null;
  model?: string | null;
  status: string;
  summary?: string | null;
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number | null;
  archivedAt?: number | null;
  messageCount: number;
  attachmentCount: number;
}

export interface AiConversationMessage {
  id: string;
  conversationId: string;
  role: AiConversationMessageRole;
  content: string;
  status: AiConversationMessageStatus;
  providerId?: string | null;
  model?: string | null;
  tokenEstimate?: number | null;
  contextSnapshotId?: string | null;
  metadataJson?: string | null;
  createdAt: number;
}

export interface AiAttachment {
  id: string;
  conversationId: string;
  messageId?: string | null;
  kind: AiAttachmentKind;
  storageMode: AiAttachmentStorageMode;
  sourceKind: AiAttachmentSourceKind;
  mimeType: string;
  originalName: string;
  originalPath?: string | null;
  assetPath?: string | null;
  thumbnailPath?: string | null;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes: number;
  ocrText?: string | null;
  status: AiAttachmentStatus;
  missingReason?: AiAttachmentMissingReason | null;
  visionUsage?: AiAttachmentVisionUsage | null;
  redactionSummary?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiConversationCreateRequest {
  title?: string;
  scopeKind: AiConversationScopeKind;
  scopeRefJson?: string;
  targetKey?: string;
  hostId?: string;
  tabId?: string;
  paneId?: string;
  providerId?: string;
  model?: string;
}

export interface AiConversationListRequest {
  query?: string;
  targetKey?: string;
  hostId?: string;
  tabId?: string;
  paneId?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface AiConversationMessageAppendRequest {
  conversationId: string;
  role: AiConversationMessageRole;
  content: string;
  status?: AiConversationMessageStatus;
  providerId?: string;
  model?: string;
  tokenEstimate?: number;
  contextSnapshotId?: string;
  metadataJson?: string;
  attachments?: AiAttachmentInput[];
}

export interface AiConversationAttachmentAddRequest {
  conversationId: string;
  attachment: AiAttachmentInput;
}

export interface AiConversationAttachmentImportRequest {
  conversationId: string;
  sourcePath: string;
  sourceKind?: AiAttachmentSourceKind;
  visionUsage?: AiAttachmentVisionUsage;
}

export interface AiConversationAttachmentImportBytesRequest {
  conversationId: string;
  originalName?: string;
  bytes: number[];
  sourceKind?: AiAttachmentSourceKind;
  visionUsage?: AiAttachmentVisionUsage;
}

export interface AiConversationAttachmentBindMessageRequest {
  attachmentId: string;
  messageId: string;
}

export interface AiAttachmentAssetInfo {
  attachment: AiAttachment;
  exists: boolean;
  resolvedPath?: string | null;
  previewPath?: string | null;
}

export interface AiAttachmentInput {
  kind: AiAttachmentKind;
  storageMode: AiAttachmentStorageMode;
  sourceKind?: AiAttachmentSourceKind;
  mimeType: string;
  originalName: string;
  originalPath?: string;
  assetPath?: string;
  thumbnailPath?: string;
  sha256?: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  ocrText?: string;
  status?: AiAttachmentStatus;
  missingReason?: AiAttachmentMissingReason;
  visionUsage?: AiAttachmentVisionUsage;
  redactionSummary?: string;
}

export interface AiConversationSlot {
  slotKey: string;
  routeMode: AiConversationRouteMode;
  targetRefJson: string;
  activeConversationId?: string | null;
  draftText?: string | null;
  lastActiveAt: number;
  updatedAt: number;
}

export interface AiConversationSlotSetActiveRequest {
  slotKey: string;
  routeMode: AiConversationRouteMode;
  targetRefJson: string;
  activeConversationId?: string | null;
}

export interface AiConversationSlotSaveDraftRequest {
  slotKey: string;
  routeMode: AiConversationRouteMode;
  targetRefJson: string;
  activeConversationId?: string | null;
  draftText?: string | null;
}

const previewConversations = new Map<string, AiConversation>();
const previewSlots = new Map<string, AiConversationSlot>();

export async function createAiConversation(
  request: AiConversationCreateRequest,
): Promise<AiConversation> {
  const normalized = normalizeConversationCreateRequest(request);
  if (!isTauri()) {
    return previewCreateConversation(normalized);
  }

  return invoke<AiConversation>("ai_conversation_create", {
    request: normalized,
  });
}

export async function listAiConversations(
  request: AiConversationListRequest = {},
): Promise<AiConversationSummary[]> {
  const normalized = normalizeConversationListRequest(request);
  if (!isTauri()) {
    return previewListConversations(normalized);
  }

  return invoke<AiConversationSummary[]>("ai_conversation_list", {
    request: normalized,
  });
}

export async function getAiConversation(
  conversationId: string,
): Promise<AiConversation> {
  const normalizedId = requiredText("会话 ID", conversationId);
  if (!isTauri()) {
    const conversation = previewConversations.get(normalizedId);
    if (!conversation) {
      throw new Error(`AI 会话不存在: ${normalizedId}`);
    }
    return conversation;
  }

  return invoke<AiConversation>("ai_conversation_get", {
    conversationId: normalizedId,
  });
}

export async function deleteAiConversation(
  conversationId: string,
): Promise<boolean> {
  const normalizedId = requiredText("会话 ID", conversationId);
  if (!isTauri()) {
    return previewConversations.delete(normalizedId);
  }

  return invoke<boolean>("ai_conversation_delete", {
    conversationId: normalizedId,
  });
}

export async function getAiConversationSlot(
  slotKey: string,
): Promise<AiConversationSlot | null> {
  const normalizedKey = requiredText("槽位 key", slotKey);
  if (!isTauri()) {
    return previewSlots.get(normalizedKey) ?? null;
  }

  return invoke<AiConversationSlot | null>("ai_conversation_slot_get", {
    slotKey: normalizedKey,
  });
}

export async function appendAiConversationMessage(
  request: AiConversationMessageAppendRequest,
): Promise<AiConversationMessage> {
  const normalized = normalizeMessageAppendRequest(request);
  if (!isTauri()) {
    return previewAppendMessage(normalized);
  }

  return invoke<AiConversationMessage>("ai_conversation_message_append", {
    request: normalized,
  });
}

export async function addAiConversationAttachment(
  request: AiConversationAttachmentAddRequest,
): Promise<AiAttachment> {
  const normalized = normalizeAttachmentAddRequest(request);
  if (!isTauri()) {
    return previewAddAttachment(normalized);
  }

  return invoke<AiAttachment>("ai_conversation_attachment_add", {
    request: normalized,
  });
}

export async function importAiConversationAttachment(
  request: AiConversationAttachmentImportRequest,
): Promise<AiAttachment> {
  const normalized = normalizeAttachmentImportRequest(request);
  if (!isTauri()) {
    return previewImportAttachment(normalized);
  }

  return invoke<AiAttachment>("ai_conversation_attachment_import", {
    request: normalized,
  });
}

export async function importAiConversationAttachmentBytes(
  request: AiConversationAttachmentImportBytesRequest,
): Promise<AiAttachment> {
  const normalized = normalizeAttachmentImportBytesRequest(request);
  if (!isTauri()) {
    return previewImportAttachmentBytes(normalized);
  }

  return invoke<AiAttachment>("ai_conversation_attachment_import_bytes", {
    request: normalized,
  });
}

export async function refreshAiConversationAttachmentStatus(
  attachmentId: string,
): Promise<AiAttachment> {
  const normalizedId = requiredText("附件 ID", attachmentId);
  if (!isTauri()) {
    return previewRefreshAttachmentStatus(normalizedId);
  }

  return invoke<AiAttachment>("ai_conversation_attachment_status_refresh", {
    attachmentId: normalizedId,
  });
}

export async function getAiConversationAttachmentAssetInfo(
  attachmentId: string,
): Promise<AiAttachmentAssetInfo> {
  const normalizedId = requiredText("附件 ID", attachmentId);
  if (!isTauri()) {
    return previewAttachmentAssetInfo(normalizedId);
  }

  return invoke<AiAttachmentAssetInfo>("ai_conversation_attachment_asset_info", {
    attachmentId: normalizedId,
  });
}

export async function openAiConversationAttachment(
  attachmentId: string,
): Promise<boolean> {
  const normalizedId = requiredText("附件 ID", attachmentId);
  if (!isTauri()) {
    return true;
  }

  return invoke<boolean>("ai_conversation_attachment_open", {
    attachmentId: normalizedId,
  });
}

export async function bindAiConversationAttachmentToMessage(
  request: AiConversationAttachmentBindMessageRequest,
): Promise<AiAttachment> {
  const normalized = {
    attachmentId: requiredText("附件 ID", request.attachmentId),
    messageId: requiredText("消息 ID", request.messageId),
  };
  if (!isTauri()) {
    return previewBindAttachment(normalized);
  }

  return invoke<AiAttachment>("ai_conversation_attachment_bind_message", {
    request: normalized,
  });
}

export async function setAiConversationSlotActive(
  request: AiConversationSlotSetActiveRequest,
): Promise<AiConversationSlot> {
  const normalized = normalizeSlotSetActiveRequest(request);
  if (!isTauri()) {
    return previewUpsertSlot(normalized);
  }

  return invoke<AiConversationSlot>("ai_conversation_slot_set_active", {
    request: normalized,
  });
}

export async function saveAiConversationSlotDraft(
  request: AiConversationSlotSaveDraftRequest,
): Promise<AiConversationSlot> {
  const normalized = normalizeSlotSaveDraftRequest(request);
  if (!isTauri()) {
    return previewUpsertSlot(normalized);
  }

  return invoke<AiConversationSlot>("ai_conversation_slot_save_draft", {
    request: normalized,
  });
}

function normalizeConversationCreateRequest(
  request: AiConversationCreateRequest,
): AiConversationCreateRequest {
  return {
    scopeKind: request.scopeKind,
    scopeRefJson: normalizeJsonText(request.scopeRefJson ?? "{}"),
    title: optionalText(request.title),
    targetKey: optionalText(request.targetKey),
    hostId: optionalText(request.hostId),
    tabId: optionalText(request.tabId),
    paneId: optionalText(request.paneId),
    providerId: optionalText(request.providerId),
    model: optionalText(request.model),
  };
}

function normalizeConversationListRequest(
  request: AiConversationListRequest,
): AiConversationListRequest {
  return {
    query: optionalText(request.query),
    targetKey: optionalText(request.targetKey),
    hostId: optionalText(request.hostId),
    tabId: optionalText(request.tabId),
    paneId: optionalText(request.paneId),
    ...(request.includeArchived === undefined
      ? {}
      : { includeArchived: request.includeArchived }),
    ...(request.limit === undefined ? {} : { limit: normalizeLimit(request.limit) }),
    ...(request.offset === undefined
      ? {}
      : { offset: Math.max(0, Math.trunc(request.offset)) }),
  };
}

function normalizeMessageAppendRequest(
  request: AiConversationMessageAppendRequest,
): AiConversationMessageAppendRequest {
  const tokenEstimate =
    request.tokenEstimate === undefined
      ? undefined
      : nonNegativeInteger("Token 估算", request.tokenEstimate);
  return {
    conversationId: requiredText("会话 ID", request.conversationId),
    role: request.role,
    content: requiredText("消息内容", request.content),
    status: request.status,
    providerId: optionalText(request.providerId),
    model: optionalText(request.model),
    ...(tokenEstimate === undefined ? {} : { tokenEstimate }),
    contextSnapshotId: optionalText(request.contextSnapshotId),
    metadataJson: optionalJsonText("消息 metadata", request.metadataJson),
    attachments: (request.attachments ?? []).map(normalizeAttachmentInput),
  };
}

function normalizeAttachmentAddRequest(
  request: AiConversationAttachmentAddRequest,
): AiConversationAttachmentAddRequest {
  return {
    conversationId: requiredText("会话 ID", request.conversationId),
    attachment: normalizeAttachmentInput(request.attachment),
  };
}

function normalizeAttachmentImportRequest(
  request: AiConversationAttachmentImportRequest,
): AiConversationAttachmentImportRequest {
  return {
    conversationId: requiredText("会话 ID", request.conversationId),
    sourceKind: request.sourceKind,
    sourcePath: requiredText("图片路径", request.sourcePath),
    visionUsage: request.visionUsage,
  };
}

function normalizeAttachmentImportBytesRequest(
  request: AiConversationAttachmentImportBytesRequest,
): AiConversationAttachmentImportBytesRequest {
  return {
    conversationId: requiredText("会话 ID", request.conversationId),
    originalName: optionalText(request.originalName),
    bytes: normalizeByteArray(request.bytes),
    sourceKind: request.sourceKind,
    visionUsage: request.visionUsage,
  };
}

function normalizeAttachmentInput(input: AiAttachmentInput): AiAttachmentInput {
  return {
    kind: input.kind,
    storageMode: input.storageMode,
    sourceKind: input.sourceKind,
    mimeType: requiredText("附件 MIME", input.mimeType),
    originalName: requiredText("附件文件名", input.originalName),
    originalPath: optionalText(input.originalPath),
    assetPath: optionalText(input.assetPath),
    thumbnailPath: optionalText(input.thumbnailPath),
    sha256: optionalText(input.sha256),
    width:
      input.width === undefined
        ? undefined
        : nonNegativeInteger("图片宽度", input.width),
    height:
      input.height === undefined
        ? undefined
        : nonNegativeInteger("图片高度", input.height),
    sizeBytes: nonNegativeInteger("附件大小", input.sizeBytes),
    ocrText: optionalText(input.ocrText),
    status: input.status,
    missingReason: input.missingReason,
    visionUsage: input.visionUsage,
    redactionSummary: optionalText(input.redactionSummary),
  };
}

function normalizeSlotSetActiveRequest(
  request: AiConversationSlotSetActiveRequest,
): AiConversationSlotSetActiveRequest {
  return {
    slotKey: requiredText("槽位 key", request.slotKey),
    routeMode: request.routeMode,
    targetRefJson: normalizeJsonText(request.targetRefJson),
    activeConversationId: optionalText(request.activeConversationId ?? undefined),
  };
}

function normalizeSlotSaveDraftRequest(
  request: AiConversationSlotSaveDraftRequest,
): AiConversationSlotSaveDraftRequest {
  return {
    slotKey: requiredText("槽位 key", request.slotKey),
    routeMode: request.routeMode,
    targetRefJson: normalizeJsonText(request.targetRefJson),
    activeConversationId: optionalText(request.activeConversationId ?? undefined),
    draftText: optionalText(request.draftText ?? undefined),
  };
}

function optionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function requiredText(field: string, value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field}不能为空`);
  }
  return normalized;
}

function normalizeJsonText(value: string) {
  const normalized = requiredText("JSON", value);
  JSON.parse(normalized);
  return normalized;
}

function optionalJsonText(field: string, value: string | undefined) {
  const normalized = optionalText(value);
  if (!normalized) {
    return undefined;
  }
  JSON.parse(normalized);
  if (normalized.length > 16_000) {
    throw new Error(`${field}最多允许 16000 个字符`);
  }
  return normalized;
}

function normalizeLimit(value: number) {
  return Math.min(200, Math.max(1, Math.trunc(value)));
}

function nonNegativeInteger(field: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field}不能为负数`);
  }
  return Math.trunc(value);
}

function normalizeByteArray(bytes: number[]) {
  if (!Array.isArray(bytes) || bytes.length === 0) {
    throw new Error("图片内容不能为空");
  }
  return bytes.map((value) => {
    if (!Number.isFinite(value) || value < 0 || value > 255) {
      throw new Error("图片字节必须位于 0-255");
    }
    return Math.trunc(value);
  });
}

function previewCreateConversation(
  request: AiConversationCreateRequest,
): AiConversation {
  const now = Date.now();
  const conversation: AiConversation = {
    archivedAt: null,
    attachments: [],
    createdAt: now,
    hostId: request.hostId ?? null,
    id: `browser-ai-conv-${now.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    lastMessageAt: null,
    messages: [],
    model: request.model ?? null,
    paneId: request.paneId ?? null,
    providerId: request.providerId ?? null,
    scopeKind: request.scopeKind,
    scopeRefJson: request.scopeRefJson ?? "{}",
    status: "idle",
    summary: null,
    tabId: request.tabId ?? null,
    targetKey: request.targetKey ?? null,
    title: request.title ?? defaultTitle(request.scopeKind),
    updatedAt: now,
  };
  previewConversations.set(conversation.id, conversation);
  return conversation;
}

function previewListConversations(
  request: AiConversationListRequest,
): AiConversationSummary[] {
  const query = request.query?.toLowerCase();
  const offset = request.offset ?? 0;
  const limit = request.limit ?? 50;
  return Array.from(previewConversations.values())
    .filter((conversation) =>
      request.includeArchived ? true : conversation.archivedAt === null,
    )
    .filter((conversation) =>
      request.targetKey ? conversation.targetKey === request.targetKey : true,
    )
    .filter((conversation) =>
      request.hostId ? conversation.hostId === request.hostId : true,
    )
    .filter((conversation) =>
      request.tabId ? conversation.tabId === request.tabId : true,
    )
    .filter((conversation) =>
      request.paneId ? conversation.paneId === request.paneId : true,
    )
    .filter((conversation) =>
      query
        ? [
            conversation.title,
            conversation.providerId ?? "",
            conversation.model ?? "",
            conversation.status,
            conversation.scopeRefJson,
            conversation.summary ?? "",
            ...conversation.messages.flatMap((message) => [
              message.content,
              message.providerId ?? "",
              message.model ?? "",
              message.status,
              message.metadataJson ?? "",
            ]),
            ...conversation.attachments.flatMap((attachment) => [
              attachment.originalName,
              attachment.mimeType,
              attachment.kind,
              attachment.status,
              attachment.ocrText ?? "",
            ]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(offset, offset + limit)
    .map(conversationToSummary);
}

function conversationToSummary(
  conversation: AiConversation,
): AiConversationSummary {
  return {
    archivedAt: conversation.archivedAt,
    attachmentCount: conversation.attachments.length,
    createdAt: conversation.createdAt,
    hostId: conversation.hostId,
    id: conversation.id,
    lastMessageAt: conversation.lastMessageAt,
    messageCount: conversation.messages.length,
    model: conversation.model,
    paneId: conversation.paneId,
    providerId: conversation.providerId,
    scopeKind: conversation.scopeKind,
    scopeRefJson: conversation.scopeRefJson,
    status: conversation.status,
    summary: conversation.summary,
    tabId: conversation.tabId,
    targetKey: conversation.targetKey,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
  };
}

function previewAppendMessage(
  request: AiConversationMessageAppendRequest,
): AiConversationMessage {
  const conversation = previewConversations.get(request.conversationId);
  if (!conversation) {
    throw new Error(`AI 会话不存在: ${request.conversationId}`);
  }
  const now = Date.now();
  const message: AiConversationMessage = {
    content: request.content,
    contextSnapshotId: request.contextSnapshotId ?? null,
    conversationId: request.conversationId,
    createdAt: now,
    id: `browser-ai-msg-${now.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    metadataJson: request.metadataJson ?? "{}",
    model: request.model ?? null,
    providerId: request.providerId ?? null,
    role: request.role,
    status: request.status ?? "complete",
    tokenEstimate: request.tokenEstimate ?? null,
  };
  const attachments = (request.attachments ?? []).map((attachment) =>
    createPreviewAttachment(request.conversationId, message.id, attachment, now),
  );
  conversation.messages = [...conversation.messages, message];
  conversation.attachments = [...conversation.attachments, ...attachments];
  conversation.lastMessageAt = now;
  conversation.updatedAt = now;
  previewConversations.set(conversation.id, conversation);
  return message;
}

function previewAddAttachment(
  request: AiConversationAttachmentAddRequest,
): AiAttachment {
  const conversation = previewConversations.get(request.conversationId);
  if (!conversation) {
    throw new Error(`AI 会话不存在: ${request.conversationId}`);
  }
  const attachment = createPreviewAttachment(
    request.conversationId,
    null,
    request.attachment,
    Date.now(),
  );
  conversation.attachments = [...conversation.attachments, attachment];
  conversation.updatedAt = attachment.updatedAt;
  previewConversations.set(conversation.id, conversation);
  return attachment;
}

function previewBindAttachment(
  request: AiConversationAttachmentBindMessageRequest,
): AiAttachment {
  for (const conversation of previewConversations.values()) {
    const attachment = conversation.attachments.find(
      (item) => item.id === request.attachmentId,
    );
    if (!attachment) {
      continue;
    }
    attachment.messageId = request.messageId;
    attachment.updatedAt = Date.now();
    conversation.updatedAt = attachment.updatedAt;
    return attachment;
  }
  throw new Error(`AI 附件不存在: ${request.attachmentId}`);
}

function previewImportAttachment(
  request: AiConversationAttachmentImportRequest,
): AiAttachment {
  const originalName = lastItem(request.sourcePath.split(/[\\/]/).filter(Boolean)) ?? "image";
  return previewAddAttachment({
    attachment: {
      assetPath: request.sourcePath,
      kind: "image",
      mimeType: mimeTypeFromImagePath(request.sourcePath),
      originalName,
      originalPath: request.sourcePath,
      sizeBytes: 0,
      sourceKind: request.sourceKind ?? "picker",
      status: "available",
      storageMode: "managedCopy",
      visionUsage: request.visionUsage ?? "notSent",
    },
    conversationId: request.conversationId,
  });
}

function previewImportAttachmentBytes(
  request: AiConversationAttachmentImportBytesRequest,
): AiAttachment {
  const originalName = request.originalName ?? "clipboard-image.png";
  return previewAddAttachment({
    attachment: {
      assetPath: `memory://${request.conversationId}/${originalName}`,
      kind: "image",
      mimeType: mimeTypeFromImagePath(originalName),
      originalName,
      sizeBytes: request.bytes.length,
      sourceKind: request.sourceKind ?? "paste",
      status: "available",
      storageMode: "managedCopy",
      visionUsage: request.visionUsage ?? "notSent",
    },
    conversationId: request.conversationId,
  });
}

function previewRefreshAttachmentStatus(attachmentId: string): AiAttachment {
  const attachment = findPreviewAttachment(attachmentId);
  attachment.status = attachment.status === "missing" ? "missing" : "available";
  attachment.updatedAt = Date.now();
  return attachment;
}

function previewAttachmentAssetInfo(attachmentId: string): AiAttachmentAssetInfo {
  const attachment = findPreviewAttachment(attachmentId);
  const previewPath = attachment.assetPath ?? attachment.originalPath ?? null;
  return {
    attachment,
    exists: attachment.status === "available" && Boolean(previewPath),
    previewPath,
    resolvedPath: previewPath,
  };
}

function findPreviewAttachment(attachmentId: string): AiAttachment {
  for (const conversation of previewConversations.values()) {
    const attachment = conversation.attachments.find(
      (item) => item.id === attachmentId,
    );
    if (attachment) {
      return attachment;
    }
  }
  throw new Error(`AI 附件不存在: ${attachmentId}`);
}

function createPreviewAttachment(
  conversationId: string,
  messageId: string | null,
  input: AiAttachmentInput,
  now: number,
): AiAttachment {
  return {
    assetPath: input.assetPath ?? null,
    conversationId,
    createdAt: now,
    height: input.height ?? null,
    id: `browser-ai-attachment-${now.toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    kind: input.kind,
    messageId,
    mimeType: input.mimeType,
    missingReason: input.missingReason ?? null,
    ocrText: input.ocrText ?? null,
    originalName: input.originalName,
    originalPath: input.originalPath ?? null,
    redactionSummary: input.redactionSummary ?? null,
    sha256: input.sha256 ?? null,
    sizeBytes: input.sizeBytes,
    sourceKind: input.sourceKind ?? "picker",
    status: input.status ?? "available",
    storageMode: input.storageMode,
    thumbnailPath: input.thumbnailPath ?? null,
    updatedAt: now,
    visionUsage: input.visionUsage ?? null,
    width: input.width ?? null,
  };
}

function mimeTypeFromImagePath(path: string) {
  const extension = lastItem(path.split("."))?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  if (extension === "bmp") {
    return "image/bmp";
  }
  return "image/png";
}

function lastItem<T>(items: T[]) {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

function previewUpsertSlot(
  request:
    | AiConversationSlotSetActiveRequest
    | AiConversationSlotSaveDraftRequest,
): AiConversationSlot {
  const now = Date.now();
  const previous = previewSlots.get(request.slotKey);
  const slot: AiConversationSlot = {
    activeConversationId:
      request.activeConversationId ??
      previous?.activeConversationId ??
      null,
    draftText:
      "draftText" in request
        ? request.draftText ?? null
        : previous?.draftText ?? null,
    lastActiveAt: now,
    routeMode: request.routeMode,
    slotKey: request.slotKey,
    targetRefJson: request.targetRefJson,
    updatedAt: now,
  };
  previewSlots.set(slot.slotKey, slot);
  return slot;
}

function defaultTitle(scopeKind: AiConversationScopeKind) {
  const titles: Record<AiConversationScopeKind, string> = {
    followFocus: "跟随当前终端",
    lockedHost: "主机会话",
    lockedPane: "终端 Pane 会话",
    noContext: "普通 AI 会话",
    workspaceTask: "工作区任务会话",
  };
  return titles[scopeKind];
}
