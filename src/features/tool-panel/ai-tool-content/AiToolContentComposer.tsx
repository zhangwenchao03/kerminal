import { ComposerPrimitive, useComposer } from "@assistant-ui/react";
import { Send } from "lucide-react";
import type {
  ClipboardEventHandler,
  DragEventHandler,
  RefObject,
} from "react";
import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";
import type { AiAgentRunSnapshot } from "../../../lib/aiAgentRunApi";
import { cn } from "../../../lib/cn";
import type { LlmProvider } from "../../settings/llmProviderModel";
import type {
  AiCommandApprovalPolicy,
  AppSettings,
} from "../../settings/settingsModel";
import {
  AiAttachmentAddButton,
  AiAttachmentDropZone,
  AiAttachmentPreviewStrip,
} from "./AiAttachmentComposer";
import {
  ExecutionModeSelector,
  PendingInvocationPanel,
  ProviderSelector,
} from "./AiToolContentParts";
import { AiRunTimeline, type AiRunActionState } from "./AiRunTimeline";
import type {
  AiChatAttachment,
  AiConversation,
  LoadState,
} from "./aiToolContentModel";

export function AiToolContentComposer({
  activeConversation,
  attachmentDropActive,
  attachmentDropZoneRef,
  chatError,
  importingAttachment,
  onAddImage,
  onApproveInvocation,
  onAttachmentDragLeave,
  onAttachmentDragOver,
  onAttachmentDrop,
  onAttachmentPaste,
  onCommandApprovalPolicyChange,
  onOpenAiSettings,
  onOpenAttachment,
  onProviderChange,
  onRejectInvocation,
  onCancelRun,
  onRetryRun,
  onRemoveAttachment,
  onSendImageOnly,
  pendingAttachments,
  pendingInvocation,
  providerError,
  providerState,
  providers,
  selectedProviderId,
  sending,
  settings,
  toolInvocationError,
  toolInvocationState,
  runActionState,
  runError,
  runFinalMessage,
  runSnapshot,
}: {
  activeConversation?: AiConversation;
  attachmentDropActive: boolean;
  attachmentDropZoneRef: RefObject<HTMLDivElement | null>;
  chatError: string | null;
  importingAttachment: boolean;
  onAddImage: () => void;
  onApproveInvocation: () => void;
  onCancelRun: () => void;
  onAttachmentDragLeave: DragEventHandler<HTMLDivElement>;
  onAttachmentDragOver: DragEventHandler<HTMLDivElement>;
  onAttachmentDrop: DragEventHandler<HTMLDivElement>;
  onAttachmentPaste: ClipboardEventHandler<HTMLDivElement>;
  onCommandApprovalPolicyChange?: (policy: AiCommandApprovalPolicy) => void;
  onOpenAiSettings?: () => void;
  onOpenAttachment?: (attachment: AiChatAttachment) => void;
  onProviderChange: (providerId: string) => void;
  onRejectInvocation: () => void;
  onRetryRun: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSendImageOnly: () => void;
  pendingAttachments: AiChatAttachment[];
  pendingInvocation: AiToolPendingInvocation | null;
  providerError: string | null;
  providerState: LoadState;
  providers: LlmProvider[];
  selectedProviderId: string;
  sending: boolean;
  settings: AppSettings;
  toolInvocationError: string | null;
  toolInvocationState: "confirming" | "idle" | "preparing";
  runActionState: AiRunActionState;
  runError: string | null;
  runFinalMessage: string | null;
  runSnapshot: AiAgentRunSnapshot | null;
}) {
  const sendDisabled = sending || importingAttachment || !activeConversation;

  return (
    <div className="shrink-0 space-y-3 border-t border-[var(--border-subtle)] p-3">
      {chatError ? (
        <div
          className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {chatError}
        </div>
      ) : null}

      <PendingInvocationPanel
        error={toolInvocationError}
        invocation={pendingInvocation}
        state={toolInvocationState}
        onApprove={onApproveInvocation}
        onReject={onRejectInvocation}
      />

      <AiRunTimeline
        actionState={runActionState}
        error={runError}
        finalMessage={runFinalMessage}
        snapshot={runSnapshot}
        onCancel={onCancelRun}
        onRetry={onRetryRun}
      />

      <ComposerPrimitive.Root className="kerminal-solid-surface overflow-visible rounded-[1.75rem] border shadow-sm shadow-black/5 dark:shadow-black/20">
        <AiAttachmentDropZone
          dropActive={attachmentDropActive}
          dropZoneRef={attachmentDropZoneRef}
          onDragLeave={onAttachmentDragLeave}
          onDragOver={onAttachmentDragOver}
          onDrop={onAttachmentDrop}
          onPaste={onAttachmentPaste}
        >
          <AiAttachmentPreviewStrip
            attachments={pendingAttachments}
            disabled={sending || !activeConversation}
            onOpenAttachment={onOpenAttachment}
            onRemoveAttachment={onRemoveAttachment}
          />
          <label className="sr-only" htmlFor="ai-chat-input">
            AI 对话输入
          </label>
          <ComposerPrimitive.Input
            aria-label="AI 对话输入"
            className="max-h-44 min-h-[5.5rem] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            disabled={sending}
            id="ai-chat-input"
            placeholder="让 AI 帮你做点什么..."
            submitMode="enter"
          />
          <div
            aria-label="AI 输入操作"
            className="mt-3 flex min-w-0 flex-nowrap items-center gap-2"
            role="toolbar"
          >
            <AiAttachmentAddButton
              disabled={sending || !activeConversation}
              importing={importingAttachment}
              onAddImage={onAddImage}
            />
            <ExecutionModeSelector
              compact
              onChange={onCommandApprovalPolicyChange}
              settings={settings}
            />
            <div className="min-w-2 flex-1" />
            <ProviderSelector
              compact
              error={providerError}
              onChange={onProviderChange}
              onOpenSettings={onOpenAiSettings}
              providers={providers}
              selectedProviderId={selectedProviderId}
              state={providerState}
            />
            <AiComposerSendButton
              disabled={sendDisabled}
              onSendImageOnly={onSendImageOnly}
              pendingAttachmentCount={pendingAttachments.length}
            />
          </div>
        </AiAttachmentDropZone>
      </ComposerPrimitive.Root>
    </div>
  );
}

function AiComposerSendButton({
  disabled,
  onSendImageOnly,
  pendingAttachmentCount,
}: {
  disabled: boolean;
  onSendImageOnly: () => void;
  pendingAttachmentCount: number;
}) {
  const composerText = useComposer((state) => state.text);
  const imageOnlyReady = pendingAttachmentCount > 0 && composerText.trim() === "";
  const className = cn(
    "kerminal-focus-ring kerminal-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm shadow-sky-950/20 disabled:cursor-not-allowed disabled:opacity-50",
    "bg-[rgb(var(--app-accent))] hover:brightness-95 dark:text-zinc-950",
  );

  if (imageOnlyReady) {
    return (
      <button
        aria-label="发送 AI 消息"
        className={className}
        disabled={disabled}
        onClick={onSendImageOnly}
        title="发送 AI 消息"
        type="button"
      >
        <Send className="h-4 w-4" />
      </button>
    );
  }

  return (
    <ComposerPrimitive.Send
      aria-label="发送 AI 消息"
      className={className}
      disabled={disabled}
      title="发送 AI 消息"
      type="submit"
    >
      <Send className="h-4 w-4" />
    </ComposerPrimitive.Send>
  );
}
