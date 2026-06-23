import { ExternalLink, FileText, ImageIcon, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  getAiConversationAttachmentAssetInfo,
  type AiAttachmentAssetInfo,
} from "../../../lib/aiConversationApi";
import { cn } from "../../../lib/cn";
import {
  formatBytes,
  type AiChatAttachment,
  type AiChatMessage,
} from "./aiToolContentModel";

export function MessageAttachments({
  attachments,
  fromUser,
  onOpenAttachment,
}: {
  attachments: AiChatMessage["attachments"];
  fromUser: boolean;
  onOpenAttachment?: (attachment: AiChatAttachment) => void;
}) {
  if (!attachments?.length) {
    return null;
  }

  return (
    <div className="mt-2 grid gap-2">
      {attachments.map((attachment) => (
        <MessageAttachmentCard
          attachment={attachment}
          fromUser={fromUser}
          key={attachment.id}
          onOpenAttachment={onOpenAttachment}
        />
      ))}
    </div>
  );
}

function MessageAttachmentCard({
  attachment,
  fromUser,
  onOpenAttachment,
}: {
  attachment: NonNullable<AiChatMessage["attachments"]>[number];
  fromUser: boolean;
  onOpenAttachment?: (attachment: AiChatAttachment) => void;
}) {
  const [displayAttachment, setDisplayAttachment] =
    useState<AiChatAttachment>(attachment);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const available = displayAttachment.status === "available";
  const canOpen = Boolean(onOpenAttachment && available);
  const statusText = attachmentStatusText(
    displayAttachment.status,
    displayAttachment.missingReason,
  );
  const storageModeText = attachmentStorageModeText(
    displayAttachment.storageMode,
  );

  useEffect(() => {
    let cancelled = false;
    setDisplayAttachment(attachment);
    setPreviewUrl(null);
    if (
      !isTauri() ||
      attachment.kind !== "image" ||
      attachment.status !== "available"
    ) {
      return () => {
        cancelled = true;
      };
    }

    void getAiConversationAttachmentAssetInfo(attachment.id)
      .then((assetInfo) => {
        if (cancelled) {
          return;
        }
        setDisplayAttachment(attachmentFromAssetInfo(attachment, assetInfo));
        if (assetInfo.exists && assetInfo.previewPath) {
          setPreviewUrl(convertFileSrc(assetInfo.previewPath));
        } else {
          setPreviewUrl(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment]);

  return (
    <button
      className={cn(
        "kerminal-focus-ring flex min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs transition",
        fromUser
          ? "border-white/25 bg-white/15 text-white hover:bg-white/20 disabled:text-white/70"
          : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-zinc-700 hover:bg-[var(--surface-selected)] disabled:text-zinc-500 dark:text-zinc-200 dark:disabled:text-zinc-400",
      )}
      disabled={!canOpen}
      onClick={() => onOpenAttachment?.(displayAttachment)}
      title={canOpen ? `预览 ${displayAttachment.originalName}` : statusText}
      type="button"
    >
      <AttachmentPreviewIcon
        attachment={displayAttachment}
        previewUrl={previewUrl ?? displayAttachment.localPreviewUrl ?? null}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {displayAttachment.originalName}
        </span>
        <span
          className={cn(
            "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5",
            fromUser ? "text-white/75" : "text-zinc-500 dark:text-zinc-400",
          )}
        >
          <span>{displayAttachment.kind === "image" ? "图片" : "附件"}</span>
          <span>{formatBytes(displayAttachment.sizeBytes)}</span>
          {displayAttachment.width && displayAttachment.height ? (
            <span>
              {displayAttachment.width} x {displayAttachment.height}
            </span>
          ) : null}
          {storageModeText ? <span>{storageModeText}</span> : null}
          {statusText ? <span>{statusText}</span> : null}
        </span>
      </span>
      {canOpen ? (
        <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
      ) : null}
    </button>
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

function AttachmentPreviewIcon({
  attachment,
  previewUrl,
}: {
  attachment: NonNullable<AiChatMessage["attachments"]>[number];
  previewUrl: string | null;
}) {
  if (previewUrl) {
    return (
      <img
        alt=""
        className="h-12 w-12 shrink-0 rounded-md border border-black/10 object-cover dark:border-white/10"
        src={previewUrl}
      />
    );
  }
  if (attachment.kind === "image") {
    return <ImageIcon className="h-5 w-5 shrink-0 opacity-80" />;
  }
  if (attachment.kind === "file") {
    return <FileText className="h-5 w-5 shrink-0 opacity-80" />;
  }
  return <Paperclip className="h-5 w-5 shrink-0 opacity-80" />;
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
