import type {
  ClipboardEventHandler,
  DragEventHandler,
  ReactNode,
  RefObject,
} from "react";
import { ImageIcon, Loader2, Plus, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "../../../lib/cn";
import { formatBytes, type AiChatAttachment } from "./aiToolContentModel";

export function AiAttachmentDropZone({
  children,
  dropActive,
  dropZoneRef,
  onDragLeave,
  onDragOver,
  onDrop,
  onPaste,
}: {
  children: ReactNode;
  dropActive?: boolean;
  dropZoneRef?: RefObject<HTMLDivElement | null>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      aria-label="AI 图片附件区"
      className={cn(
        "rounded-[1.35rem] p-3 transition",
        dropActive
          ? "bg-sky-500/10 ring-2 ring-sky-400/40 dark:bg-sky-400/10 dark:ring-sky-300/35"
          : "",
      )}
      data-testid="ai-attachment-drop-zone"
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaste={onPaste}
      ref={dropZoneRef}
    >
      {children}
    </div>
  );
}

export function AiAttachmentAddButton({
  disabled,
  importing,
  onAddImage,
}: {
  disabled?: boolean;
  importing?: boolean;
  onAddImage: () => void;
}) {
  return (
    <button
      aria-label="添加图片附件"
      className="kerminal-focus-ring kerminal-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400 dark:hover:text-zinc-100"
      disabled={disabled || importing}
      onClick={onAddImage}
      title="添加图片附件"
      type="button"
    >
      {importing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
    </button>
  );
}

export function AiAttachmentPreviewStrip({
  attachments,
  disabled,
  onOpenAttachment,
  onRemoveAttachment,
}: {
  attachments: AiChatAttachment[];
  disabled?: boolean;
  onOpenAttachment?: (attachment: AiChatAttachment) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="kerminal-scrollbar mb-3 flex max-w-full gap-2 overflow-x-auto pb-0.5">
      {attachments.map((attachment) => (
        <span
          className="group relative inline-flex h-20 w-24 shrink-0"
          key={attachment.id}
          title={attachment.originalName}
        >
          <button
            aria-label={`预览附件 ${attachment.originalName}`}
            className={cn(
              "kerminal-focus-ring relative h-full w-full overflow-hidden rounded-xl border bg-[var(--surface-hover)] text-left text-xs text-zinc-700 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70 dark:text-zinc-200",
              attachment.status === "available"
                ? ""
                : "border-amber-400/25 text-amber-700 dark:text-amber-100",
            )}
            disabled={disabled}
            onClick={() => onOpenAttachment?.(attachment)}
            type="button"
          >
            <AttachmentPreview attachment={attachment} />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-white">
              <span className="block truncate font-medium">
                {attachment.originalName}
              </span>
              <span className="block truncate text-[10px] text-white/75">
                {formatBytes(attachment.sizeBytes)}
              </span>
            </span>
          </button>
          <button
            aria-label={`移除附件 ${attachment.originalName}`}
            className="kerminal-focus-ring kerminal-pressable absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-zinc-950/70 text-white opacity-90 hover:bg-zinc-950 dark:bg-zinc-50/90 dark:text-zinc-950"
            disabled={disabled}
            onClick={() => onRemoveAttachment(attachment.id)}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: AiChatAttachment }) {
  const src = attachmentImageSrc(attachment);
  if (src) {
    return (
      <img
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
        src={src}
      />
    );
  }
  return (
    <span className="grid h-full w-full place-items-center">
      <ImageIcon className="h-7 w-7 opacity-60" />
    </span>
  );
}

function attachmentImageSrc(attachment: AiChatAttachment) {
  if (attachment.localPreviewUrl) {
    return attachment.localPreviewUrl;
  }
  if (attachment.kind !== "image" || attachment.status !== "available") {
    return null;
  }
  const path = attachment.thumbnailPath ?? attachment.assetPath;
  if (!path) {
    return null;
  }
  if (/^(blob:|data:|https?:)/.test(path)) {
    return path;
  }
  return convertFileSrc(path);
}
