import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type SetStateAction,
} from "react";
import {
  importAiConversationAttachment,
  importAiConversationAttachmentBytes,
  type AiAttachment,
  type AiAttachmentSourceKind,
  type AiAttachmentVisionUsage,
} from "../../../lib/aiConversationApi";
import { selectLocalImage } from "../../../lib/fileDialogApi";
import {
  chatAttachmentFromStoredAttachment,
  ensureStoredConversationForSlot,
  mergeStoredConversationIntoState,
  type AiConversationSlotDescriptor,
} from "./aiConversationPersistence";
import type {
  AiChatAttachment,
  AiConversation,
  ConversationState,
} from "./aiToolContentModel";

// 用户主动加入对话的图片默认请求进入模型；后端会按 provider 能力和附件安全边界降级。
const DEFAULT_IMAGE_ATTACHMENT_VISION_USAGE: AiAttachmentVisionUsage = "visionInput";

export function useAiPendingAttachments({
  activeConversation,
  conversationPersistenceEnabled,
  conversationSlot,
  setChatError,
  setConversationState,
}: {
  activeConversation?: AiConversation;
  conversationPersistenceEnabled: boolean;
  conversationSlot: AiConversationSlotDescriptor;
  setChatError: (message: string | null) => void;
  setConversationState: Dispatch<SetStateAction<ConversationState>>;
}) {
  const attachmentDropZoneRef = useRef<HTMLDivElement | null>(null);
  const attachmentPreviewUrlsRef = useRef(new Map<string, string>());
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    AiChatAttachment[]
  >([]);
  const [importingAttachment, setImportingAttachment] = useState(false);

  useEffect(() => {
    revokeAllPreviewUrls(attachmentPreviewUrlsRef.current);
    setPendingAttachments([]);
  }, [conversationSlot.slotKey]);

  useEffect(
    () => () => {
      revokeAllPreviewUrls(attachmentPreviewUrlsRef.current);
    },
    [],
  );

  const ensureConversationId = useCallback(async () => {
    let conversationId = activeConversation?.id;
    if (conversationPersistenceEnabled) {
      const storedConversation =
        await ensureStoredConversationForSlot(conversationSlot);
      conversationId = storedConversation.id;
      setConversationState((current) =>
        mergeStoredConversationIntoState(current, storedConversation),
      );
    }
    if (!conversationId) {
      throw new Error("当前 AI 会话不可用");
    }
    return conversationId;
  }, [
    activeConversation?.id,
    conversationPersistenceEnabled,
    conversationSlot,
    setConversationState,
  ]);

  const addImageAttachmentsFromPaths = useCallback(
    async (sourcePaths: string[], sourceKind: AiAttachmentSourceKind) => {
      if (importingAttachment) {
        return;
      }

      const imagePaths = uniqueNonEmptyPaths(sourcePaths).filter(
        isSupportedImagePath,
      );
      if (sourcePaths.length > 0 && imagePaths.length === 0) {
        setChatError("请拖入或粘贴 PNG、JPG、WebP、GIF、BMP 图片文件。");
        return;
      }
      if (imagePaths.length === 0) {
        return;
      }

      setImportingAttachment(true);
      setChatError(null);
      try {
        const conversationId = await ensureConversationId();
        for (const sourcePath of imagePaths) {
          const previewUrl = createPathPreviewUrl(sourcePath);
          const pendingAttachment = createOptimisticImageAttachment({
            conversationId,
            originalName: originalPathImageName(sourcePath),
            previewUrl,
            sourceKind,
          });
          setPendingAttachments((current) =>
            upsertPendingAttachment(
              current,
              pendingAttachment,
              previewUrl,
              attachmentPreviewUrlsRef.current,
            ),
          );
          try {
            const attachment = await importAiConversationAttachment({
              conversationId,
              sourceKind,
              sourcePath,
              visionUsage: DEFAULT_IMAGE_ATTACHMENT_VISION_USAGE,
            });
            setPendingAttachments((current) =>
              replacePendingAttachment(
                current,
                pendingAttachment.id,
                attachment,
                previewUrl,
                attachmentPreviewUrlsRef.current,
              ),
            );
          } catch (nextError) {
            removePendingPreviewAttachment(
              pendingAttachment.id,
              attachmentPreviewUrlsRef.current,
              setPendingAttachments,
            );
            throw nextError;
          }
        }
      } catch (nextError) {
        setChatError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      } finally {
        setImportingAttachment(false);
        setAttachmentDropActive(false);
      }
    },
    [ensureConversationId, importingAttachment, setChatError],
  );

  const addImageAttachmentsFromFiles = useCallback(
    async (sourceFiles: File[], sourceKind: AiAttachmentSourceKind) => {
      if (importingAttachment) {
        return;
      }

      const imageFiles = sourceFiles.filter(isImageFile);
      if (sourceFiles.length > 0 && imageFiles.length === 0) {
        setChatError("请拖入或粘贴 PNG、JPG、WebP、GIF、BMP 图片文件。");
        return;
      }
      if (imageFiles.length === 0) {
        return;
      }

      setImportingAttachment(true);
      setChatError(null);
      try {
        const conversationId = await ensureConversationId();
        for (const file of imageFiles) {
          const sourcePath = pathFromFile(file);
          const previewUrl = createImagePreviewUrl(file);
          const pendingAttachment = createOptimisticImageAttachment({
            conversationId,
            height: null,
            mimeType: file.type || imageMimeTypeFromName(file.name),
            originalName: originalImageName(file),
            previewUrl,
            sizeBytes: file.size,
            sourceKind,
            width: null,
          });
          setPendingAttachments((current) =>
            upsertPendingAttachment(
              current,
              pendingAttachment,
              previewUrl,
              attachmentPreviewUrlsRef.current,
            ),
          );
          try {
            const attachment = sourcePath
              ? await importAiConversationAttachment({
                  conversationId,
                  sourceKind,
                  sourcePath,
                  visionUsage: DEFAULT_IMAGE_ATTACHMENT_VISION_USAGE,
                })
              : await importImageAttachmentBytes(conversationId, file, sourceKind);
            setPendingAttachments((current) =>
              replacePendingAttachment(
                current,
                pendingAttachment.id,
                attachment,
                previewUrl,
                attachmentPreviewUrlsRef.current,
              ),
            );
          } catch (nextError) {
            revokePreviewUrl(previewUrl);
            removePendingPreviewAttachment(
              pendingAttachment.id,
              attachmentPreviewUrlsRef.current,
              setPendingAttachments,
            );
            throw nextError;
          }
        }
      } catch (nextError) {
        setChatError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      } finally {
        setImportingAttachment(false);
        setAttachmentDropActive(false);
      }
    },
    [ensureConversationId, importingAttachment, setChatError],
  );

  const addLocalImageAttachment = useCallback(async () => {
    if (importingAttachment) {
      return;
    }

    setChatError(null);
    try {
      const sourcePath = await selectLocalImage();
      if (!sourcePath) {
        return;
      }

      await addImageAttachmentsFromPaths([sourcePath], "picker");
    } catch (nextError) {
      setChatError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [addImageAttachmentsFromPaths, importingAttachment, setChatError]);

  const handleAttachmentDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const files = filesFromDataTransfer(event.dataTransfer);
      const paths = pathsFromDataTransfer(event.dataTransfer);
      if (files.filter(isImageFile).length === 0 && paths.length === 0) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setAttachmentDropActive(true);
    },
    [],
  );

  const handleAttachmentDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (
        event.currentTarget instanceof HTMLElement &&
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      setAttachmentDropActive(false);
    },
    [],
  );

  const handleAttachmentDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const files = filesFromDataTransfer(event.dataTransfer);
      const paths = pathsFromDataTransfer(event.dataTransfer);
      if (files.length === 0 && paths.length === 0) {
        return;
      }
      event.preventDefault();
      if (files.length > 0) {
        void addImageAttachmentsFromFiles(files, "drag");
        return;
      }
      void addImageAttachmentsFromPaths(paths, "drag");
    },
    [addImageAttachmentsFromFiles, addImageAttachmentsFromPaths],
  );

  const handleAttachmentPaste = useCallback(
    (event: ReactClipboardEvent<HTMLElement>) => {
      const files = filesFromDataTransfer(event.clipboardData).filter(isImageFile);
      if (files.length > 0) {
        event.preventDefault();
        void addImageAttachmentsFromFiles(files, "paste");
      }
    },
    [addImageAttachmentsFromFiles],
  );

  useEffect(() => {
    if (!isRunningInTauriWebview()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = unwrapTauriDragDropPayload(event);
        if (disposed) {
          return;
        }
        if (payload.type === "leave") {
          setAttachmentDropActive(false);
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setAttachmentDropActive(
            isDragPositionInsideElement(payload, attachmentDropZoneRef.current),
          );
          return;
        }
        if (payload.type === "drop") {
          const insideDropZone = isDragPositionInsideElement(
            payload,
            attachmentDropZoneRef.current,
          );
          setAttachmentDropActive(false);
          if (insideDropZone) {
            void addImageAttachmentsFromPaths(payload.paths, "drag");
          }
        }
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((nextError) => {
        if (!disposed) {
          setChatError(
            nextError instanceof Error
              ? `图片拖拽监听失败：${nextError.message}`
              : `图片拖拽监听失败：${String(nextError)}`,
          );
        }
      });

    return () => {
      disposed = true;
      setAttachmentDropActive(false);
      unlisten?.();
    };
  }, [addImageAttachmentsFromPaths, setChatError]);

  return {
    addLocalImageAttachment,
    addImageAttachmentsFromPaths,
    attachmentDropActive,
    attachmentDropZoneRef,
    clearPendingAttachments: () => setPendingAttachments([]),
    handleAttachmentDragLeave,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleAttachmentPaste,
    importingAttachment,
    pendingAttachments,
    removePendingAttachment: (attachmentId: string) => {
      revokePreviewUrl(attachmentPreviewUrlsRef.current.get(attachmentId));
      attachmentPreviewUrlsRef.current.delete(attachmentId);
      setPendingAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId),
      );
    },
  };
}

function upsertPendingAttachment(
  current: AiChatAttachment[],
  attachment: AiAttachment,
  localPreviewUrl: string | null,
  previewUrls: Map<string, string>,
) {
  const next = {
    ...chatAttachmentFromStoredAttachment(attachment),
    ...(localPreviewUrl ? { localPreviewUrl } : {}),
  };
  const previousPreviewUrl =
    current.find((item) => item.id === next.id)?.localPreviewUrl ??
    previewUrls.get(next.id);
  if (previousPreviewUrl && previousPreviewUrl !== localPreviewUrl) {
    revokePreviewUrl(previousPreviewUrl);
  }
  if (localPreviewUrl) {
    previewUrls.set(next.id, localPreviewUrl);
  } else {
    previewUrls.delete(next.id);
  }
  return [...current.filter((item) => item.id !== next.id), next];
}

function replacePendingAttachment(
  current: AiChatAttachment[],
  pendingAttachmentId: string,
  attachment: AiAttachment,
  localPreviewUrl: string | null,
  previewUrls: Map<string, string>,
) {
  const next = {
    ...chatAttachmentFromStoredAttachment(attachment),
    ...(localPreviewUrl ? { localPreviewUrl } : {}),
  };
  if (!current.some((item) => item.id === pendingAttachmentId)) {
    return current;
  }
  const previousPreviewUrl = previewUrls.get(next.id);
  if (previousPreviewUrl && previousPreviewUrl !== localPreviewUrl) {
    revokePreviewUrl(previousPreviewUrl);
  }
  if (localPreviewUrl) {
    previewUrls.delete(pendingAttachmentId);
    previewUrls.set(next.id, localPreviewUrl);
  } else {
    previewUrls.delete(next.id);
  }
  return [
    ...current.filter(
      (item) => item.id !== pendingAttachmentId && item.id !== next.id,
    ),
    next,
  ];
}

function createOptimisticImageAttachment({
  conversationId,
  height = null,
  mimeType,
  originalName,
  previewUrl,
  sizeBytes = 0,
  sourceKind,
  width = null,
}: {
  conversationId: string;
  height?: number | null;
  mimeType?: string;
  originalName: string;
  previewUrl: string | null;
  sizeBytes?: number;
  sourceKind: AiAttachmentSourceKind;
  width?: number | null;
}): AiAttachment {
  const now = Date.now();
  return {
    assetPath: null,
    conversationId,
    createdAt: now,
    height,
    id: `pending-image-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "image",
    messageId: null,
    mimeType: mimeType ?? imageMimeTypeFromName(originalName),
    missingReason: null,
    ocrText: null,
    originalName,
    originalPath: null,
    redactionSummary: null,
    sha256: null,
    sizeBytes,
    sourceKind,
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: previewUrl,
    updatedAt: now,
    visionUsage: DEFAULT_IMAGE_ATTACHMENT_VISION_USAGE,
    width,
  };
}

function removePendingPreviewAttachment(
  pendingAttachmentId: string,
  previewUrls: Map<string, string>,
  setPendingAttachments: Dispatch<SetStateAction<AiChatAttachment[]>>,
) {
  previewUrls.delete(pendingAttachmentId);
  setPendingAttachments((current) =>
    current.filter((attachment) => attachment.id !== pendingAttachmentId),
  );
}

function uniqueNonEmptyPaths(paths: string[]) {
  return Array.from(
    new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0)),
  );
}

function isSupportedImagePath(path: string) {
  return /\.(bmp|gif|jpe?g|png|webp)$/i.test(path);
}

type FileWithOptionalPath = File & { path?: unknown };

function pathsFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return [];
  }

  return filesFromDataTransfer(dataTransfer)
    .filter((file) => isImageFile(file))
    .map((file) => pathFromFile(file))
    .filter((path): path is string => Boolean(path));
}

function filesFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return [];
  }
  const files = Array.from(dataTransfer.files ?? []);
  if (files.length > 0) {
    return files;
  }
  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || isSupportedImagePath(file.name);
}

function pathFromFile(file: File) {
  const path = (file as FileWithOptionalPath).path;
  return typeof path === "string" && path.trim() ? path : null;
}

async function importImageAttachmentBytes(
  conversationId: string,
  file: File,
  sourceKind: AiAttachmentSourceKind,
) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return importAiConversationAttachmentBytes({
    bytes,
    conversationId,
    originalName: originalImageName(file),
    sourceKind,
    visionUsage: DEFAULT_IMAGE_ATTACHMENT_VISION_USAGE,
  });
}

function createImagePreviewUrl(file: File) {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }
  return URL.createObjectURL(file);
}

function createPathPreviewUrl(path: string) {
  const normalized = path.trim();
  if (!normalized) {
    return null;
  }
  if (/^(blob:|data:|https?:)/i.test(normalized)) {
    return normalized;
  }
  return isRunningInTauriWebview() ? convertFileSrc(normalized) : normalized;
}

function revokeAllPreviewUrls(previewUrls: Map<string, string>) {
  for (const previewUrl of previewUrls.values()) {
    revokePreviewUrl(previewUrl);
  }
  previewUrls.clear();
}

function revokePreviewUrl(previewUrl: string | null | undefined) {
  if (
    previewUrl &&
    previewUrl.startsWith("blob:") &&
    typeof URL !== "undefined" &&
    typeof URL.revokeObjectURL === "function"
  ) {
    URL.revokeObjectURL(previewUrl);
  }
}

function originalImageName(file: File) {
  const name = file.name.trim();
  if (name) {
    return name;
  }
  return `clipboard-image.${extensionFromMimeType(file.type)}`;
}

function originalPathImageName(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).pop();
  return name?.trim() || `image.${extensionFromPath(path)}`;
}

function imageMimeTypeFromName(name: string) {
  const extension = extensionFromPath(name);
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

function extensionFromPath(path: string) {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim());
  return match ? match[1].toLowerCase() : "png";
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }
  if (mimeType === "image/bmp") {
    return "bmp";
  }
  return "png";
}

type TauriDragDropPayload =
  | { type: "enter" | "over"; position?: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position?: { x: number; y: number } }
  | { type: "leave" };

function unwrapTauriDragDropPayload(event: unknown): TauriDragDropPayload {
  const payload = (event as { payload?: unknown }).payload;
  if (isTauriDragDropPayload(payload)) {
    return payload;
  }
  const nestedPayload = (payload as { payload?: unknown } | undefined)?.payload;
  if (isTauriDragDropPayload(nestedPayload)) {
    return nestedPayload;
  }
  return { type: "leave" };
}

function isTauriDragDropPayload(value: unknown): value is TauriDragDropPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  if (type === "drop") {
    return Array.isArray((value as { paths?: unknown }).paths);
  }
  return type === "enter" || type === "over" || type === "leave";
}

function isDragPositionInsideElement(
  payload: TauriDragDropPayload,
  element: HTMLElement | null,
) {
  if (!element || !("position" in payload) || !payload.position) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const { x, y } = payload.position;
  if (isPointInsideRect(x, y, rect)) {
    return true;
  }

  const scale = window.devicePixelRatio || 1;
  return scale !== 1 && isPointInsideRect(x / scale, y / scale, rect);
}

function isPointInsideRect(x: number, y: number, rect: DOMRect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isRunningInTauriWebview() {
  return (
    isTauri() ||
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}
