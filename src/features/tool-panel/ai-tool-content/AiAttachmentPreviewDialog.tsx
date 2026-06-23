import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertTriangle, ExternalLink, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import {
  getAiConversationAttachmentAssetInfo,
  openAiConversationAttachment,
  type AiAttachmentAssetInfo,
} from "../../../lib/aiConversationApi";
import { formatBytes, type AiChatAttachment } from "./aiToolContentModel";

export function AiAttachmentPreviewDialog({
  attachment,
  onClose,
  onError,
}: {
  attachment: AiChatAttachment | null;
  onClose: () => void;
  onError?: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [displayAttachment, setDisplayAttachment] =
    useState<AiChatAttachment | null>(attachment);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDisplayAttachment(attachment);
    setPreviewUrl(null);
    if (!attachment) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const localPreviewUrl = attachment.localPreviewUrl?.trim() || null;
    if (localPreviewUrl) {
      setPreviewUrl(localPreviewUrl);
    }
    if (isLocalOnlyPreviewAttachment(attachment)) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(!localPreviewUrl);
    void getAiConversationAttachmentAssetInfo(attachment.id)
      .then((assetInfo) => {
        if (cancelled) {
          return;
        }
        const nextAttachment = attachmentFromAssetInfo(attachment, assetInfo);
        setDisplayAttachment(nextAttachment);
        if (assetInfo.exists && assetInfo.previewPath) {
          setPreviewUrl(convertFileSrc(assetInfo.previewPath));
          return;
        }
        if (!localPreviewUrl) {
          setError(attachmentUnavailableText(nextAttachment));
        }
      })
      .catch((nextError) => {
        if (!cancelled && !localPreviewUrl) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment]);

  const openInSystem = async () => {
    if (!displayAttachment || !canOpenAttachmentInSystem(displayAttachment)) {
      return;
    }
    try {
      await openAiConversationAttachment(displayAttachment.id);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      onError?.(message);
    }
  };
  const headerAttachment = displayAttachment ?? attachment;
  const systemOpenDisabled =
    loading ||
    !headerAttachment ||
    !canOpenAttachmentInSystem(headerAttachment);

  return (
    <ModalShell
      bodyClassName="overflow-hidden p-0"
      description={
        headerAttachment
          ? attachmentDescription(headerAttachment)
          : undefined
      }
      headerActions={
        headerAttachment ? (
          <Button
            className="gap-2"
            disabled={systemOpenDisabled}
            onClick={() => void openInSystem()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            系统打开
          </Button>
        ) : null
      }
      onClose={onClose}
      open={Boolean(attachment)}
      panelClassName="h-[min(820px,calc(100vh-48px))]"
      size="large"
      title={headerAttachment?.originalName ?? "图片预览"}
    >
      <div className="flex h-full min-h-[22rem] items-center justify-center bg-zinc-950/5 p-4 dark:bg-black/24">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载图片预览
          </div>
        ) : null}
        {!loading && error ? (
          <div
            className="max-w-md rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-700 dark:text-amber-100"
            role="alert"
          >
            <div className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              图片不可预览
            </div>
            {error}
          </div>
        ) : null}
        {!loading && !error && previewUrl ? (
          <img
            alt={attachment?.originalName ?? "AI 附件图片"}
            className="max-h-full max-w-full rounded-xl border border-black/10 object-contain shadow-2xl shadow-black/20 dark:border-white/10"
            src={previewUrl}
          />
        ) : null}
        {!loading && !error && !previewUrl ? (
          <div className="flex flex-col items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <ImageIcon className="h-8 w-8" />
            暂无图片预览
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}

function attachmentFromAssetInfo(
  fallback: AiChatAttachment,
  assetInfo: AiAttachmentAssetInfo,
): AiChatAttachment {
  const { attachment } = assetInfo;
  return {
    ...fallback,
    assetPath: attachment.assetPath ?? null,
    height: attachment.height ?? null,
    id: attachment.id,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    missingReason: attachment.missingReason ?? null,
    ocrText: attachment.ocrText ?? null,
    originalName: attachment.originalName,
    originalPath: attachment.originalPath ?? null,
    redactionSummary: attachment.redactionSummary ?? null,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    storageMode: attachment.storageMode,
    thumbnailPath: attachment.thumbnailPath ?? null,
    visionUsage: attachment.visionUsage ?? null,
    width: attachment.width ?? null,
  };
}

function canOpenAttachmentInSystem(attachment: AiChatAttachment) {
  return (
    attachment.status === "available" &&
    !isLocalOnlyPreviewAttachment(attachment)
  );
}

function isLocalOnlyPreviewAttachment(attachment: AiChatAttachment) {
  return Boolean(
    attachment.localPreviewUrl?.trim() &&
      !attachment.assetPath &&
      !attachment.originalPath &&
      attachment.id.startsWith("pending-image-"),
  );
}

function attachmentDescription(attachment: AiChatAttachment) {
  return [
    attachment.mimeType,
    formatBytes(attachment.sizeBytes),
    attachment.width && attachment.height
      ? `${attachment.width} x ${attachment.height}`
      : null,
    attachmentStorageModeText(attachment.storageMode),
    attachmentStatusText(attachment.status, attachment.missingReason),
  ]
    .filter(Boolean)
    .join(" · ");
}

function attachmentUnavailableText(attachment: AiChatAttachment) {
  const statusText = attachmentStatusText(
    attachment.status,
    attachment.missingReason,
  );
  const storageModeText = attachmentStorageModeText(attachment.storageMode);
  if (statusText) {
    return storageModeText ? `${storageModeText}：${statusText}` : statusText;
  }
  return "图片文件不可用，可能已被删除、移动或权限不可访问。";
}

function attachmentStatusText(status: string, missingReason?: string | null) {
  if (status === "available") {
    return "";
  }
  if (status === "missing") {
    return missingReason
      ? `文件不可用：${attachmentMissingReasonText(missingReason)}`
      : "文件不可用";
  }
  if (status === "redacted") {
    return "已脱敏";
  }
  if (status === "unsupported") {
    return "不支持";
  }
  return status;
}

function attachmentStorageModeText(storageMode?: string | null) {
  if (storageMode === "managedCopy") {
    return "Kerminal 受管副本";
  }
  if (storageMode === "linkedFile") {
    return "引用原文件";
  }
  return "";
}

function attachmentMissingReasonText(reason: string) {
  if (reason === "deleted") {
    return "已删除";
  }
  if (reason === "moved") {
    return "已移动";
  }
  if (reason === "permissionDenied") {
    return "无权限访问";
  }
  if (reason === "outsideScope") {
    return "超出允许范围";
  }
  if (reason === "unknown") {
    return "未知原因";
  }
  return reason;
}
