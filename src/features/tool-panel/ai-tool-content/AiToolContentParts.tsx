import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  EyeOff,
  History,
  ImageIcon,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  User,
  X,
} from "lucide-react";
import { MessagePartPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import type { CSSProperties } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type {
  AiCommandExecutionVisibility,
  AiChatStreamStep,
} from "../../../lib/aiAgentApi";
import type { AiTerminalContextSnapshot } from "../../../lib/aiContextApi";
import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";
import { cn } from "../../../lib/cn";
import type {
  AiCommandApprovalPolicy,
  AppSettings,
} from "../../settings/settingsModel";
import type { LlmProvider } from "../../settings/llmProviderModel";
import { riskLabel } from "../toolRegistryModel";
import {
  conversationMatchesHistoryQuery,
  formatHistoryTime,
  hasConversationHistoryContent,
  normalizeHistorySearchQuery,
  statusLabel,
  statusTone,
  type AiChatMessage,
  type AiChatAttachment,
  type AiConversation,
  type LoadState,
} from "./aiToolContentModel";
import { MessageAttachments } from "./AiMessageAttachments";

const commandVisibilityButtonClassName =
  "kerminal-focus-ring kerminal-pressable inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium";
const commandVisibilityIdleClassName =
  "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100";
const aiAccentSurfaceClassName =
  "bg-[rgb(var(--app-accent))] text-white shadow-sm shadow-sky-950/20 dark:text-zinc-950 dark:shadow-black/20";
const aiHistoryEmptyClassName =
  "kerminal-muted-surface rounded-lg border border-dashed px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400";
const aiIconBubbleClassName =
  "kerminal-muted-surface mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sky-700 dark:text-sky-100";
const aiUserIconBubbleClassName = cn(
  "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
  aiAccentSurfaceClassName,
);
const composerCompactMenuClassName =
  "z-[1000] border-[var(--border-subtle)] bg-[var(--surface-overlay)] shadow-2xl shadow-black/25 dark:shadow-black/60 [&_button[role=option]]:items-center [&_button[role=option]]:gap-2 [&_button[role=option]]:text-center [&_button[role=option]>span:first-child]:flex-1 [&_button[role=option]>svg]:hidden";

export function ContextUsageIndicator({
  error,
  snapshot,
  state,
}: {
  error: string | null;
  snapshot: AiTerminalContextSnapshot | null;
  state: LoadState;
}) {
  const meta = contextUsageIndicatorMeta({ error, snapshot, state });

  return (
    <span
      aria-label={meta.ariaLabel}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        meta.className,
      )}
      role="status"
      style={
        {
          "--ai-context-ring": meta.ring,
          "--ai-context-progress": `${meta.percent}%`,
          "--ai-context-track": "var(--border-subtle)",
        } as CSSProperties
      }
      title={meta.title}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-4 rounded-full bg-[var(--surface-solid)] shadow-[0_0_0_1px_var(--border-subtle)]",
          state === "loading" && "animate-pulse",
        )}
      />
    </span>
  );
}

function contextUsageIndicatorMeta({
  error,
  snapshot,
  state,
}: {
  error: string | null;
  snapshot: AiTerminalContextSnapshot | null;
  state: LoadState;
}) {
  if (state === "loading") {
    return {
      ariaLabel: "上下文读取中",
      className: "bg-[conic-gradient(var(--ai-context-ring)_var(--ai-context-progress),var(--ai-context-track)_0)]",
      percent: 33,
      ring: "rgb(113 113 122)",
      title: "上下文读取中",
    };
  }
  if (error) {
    return {
      ariaLabel: "上下文不可用",
      className: "bg-[conic-gradient(var(--ai-context-ring)_var(--ai-context-progress),var(--ai-context-track)_0)]",
      percent: 100,
      ring: "rgb(113 113 122)",
      title: "上下文不可用",
    };
  }
  if (!snapshot || snapshot.output.maxBytes <= 0) {
    return {
      ariaLabel: "使用量 0%",
      className: "bg-[conic-gradient(var(--ai-context-ring)_var(--ai-context-progress),var(--ai-context-track)_0)]",
      percent: 0,
      ring: "rgb(161 161 170)",
      title: "0% · 0K/0K",
    };
  }

  const percent = Math.min(
    100,
    Math.max(
      snapshot.output.capturedBytes > 0 ? 1 : 0,
      Math.round((snapshot.output.capturedBytes / snapshot.output.maxBytes) * 100),
    ),
  );
  const used = formatContextUsageK(snapshot.output.capturedBytes);
  const total = formatContextUsageK(snapshot.output.maxBytes);
  const title = `${percent}% · ${used}/${total}`;

  return {
    ariaLabel: `使用量 ${percent}%`,
    className: "bg-[conic-gradient(var(--ai-context-ring)_var(--ai-context-progress),var(--ai-context-track)_0)]",
    percent,
    ring: "rgb(113 113 122)",
    title,
  };
}

function formatContextUsageK(bytes: number) {
  if (bytes <= 0) {
    return "0K";
  }
  const kib = bytes / 1024;
  if (kib < 0.1) {
    return "<0.1K";
  }
  const value = kib < 10 ? kib.toFixed(1) : String(Math.round(kib));
  return `${value.replace(/\.0$/, "")}K`;
}

export function CommandVisibilitySwitch({
  onChange,
  value,
}: {
  onChange: (value: AiCommandExecutionVisibility) => void;
  value: AiCommandExecutionVisibility;
}) {
  const terminalSelected = value === "terminal";

  return (
    <div
      aria-label="AI 命令显示模式"
      className="kerminal-muted-surface inline-flex h-8 shrink-0 items-center overflow-hidden rounded-lg border p-0.5"
      role="group"
      title={
        terminalSelected
          ? "AI 执行命令时优先写入当前终端，用户可以看到命令和输出"
          : "AI 允许使用后台工具执行，命令和结果显示在 AI 工具卡片与审计中"
      }
    >
      <button
        aria-label="命令显示在终端"
        aria-pressed={terminalSelected}
        className={cn(
          commandVisibilityButtonClassName,
          terminalSelected
            ? "bg-[rgb(var(--app-accent))] text-white shadow-sm shadow-sky-950/15 dark:text-zinc-950"
            : commandVisibilityIdleClassName,
        )}
        onClick={() => onChange("terminal")}
        title="命令显示在终端"
        type="button"
      >
        <Terminal className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">终端</span>
      </button>
      <button
        aria-label="命令后台运行"
        aria-pressed={!terminalSelected}
        className={cn(
          commandVisibilityButtonClassName,
          !terminalSelected
            ? "bg-zinc-900 text-white shadow-sm shadow-black/15 dark:bg-zinc-100 dark:text-zinc-950"
            : commandVisibilityIdleClassName,
        )}
        onClick={() => onChange("background")}
        title="命令后台运行"
        type="button"
      >
        <EyeOff className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">后台</span>
      </button>
    </div>
  );
}

export const approvalPolicyOptions: Array<{
  description: string;
  label: string;
  value: AiCommandApprovalPolicy;
}> = [
  {
    description: "所有 AI 工具调用都会先停在确认面板。",
    label: "每次确认",
    value: "always",
  },
  {
    description: "读取类动作可自动执行，写入、远程、批量和高风险动作需要确认。",
    label: "高风险确认",
    value: "risky",
  },
  {
    description: "允许非禁用工具自动执行；破坏性工具仍受总开关保护。",
    label: "放开模式",
    value: "relaxed",
  },
];

const approvalPolicyCompactLabels: Record<AiCommandApprovalPolicy, string> = {
  always: "确认",
  relaxed: "自动",
  risky: "安全",
};

export function ExecutionModeSelector({
  compact = false,
  onChange,
  settings,
}: {
  compact?: boolean;
  onChange?: (policy: AiCommandApprovalPolicy) => void;
  settings: AppSettings;
}) {
  const selected =
    approvalPolicyOptions.find(
      (option) => option.value === settings.ai.commandApprovalPolicy,
    ) ?? approvalPolicyOptions[1];
  const permissionTitle = [
    selected.description,
    settings.ai.allowDestructiveTools ? "破坏性工具已允许" : "破坏性工具关闭",
  ].join(" ");

  return (
    <div
      className={cn(
        compact
          ? "kerminal-muted-surface inline-flex h-8 shrink-0 items-center rounded-full border text-xs font-medium text-zinc-600 dark:text-zinc-300"
          : "inline-flex h-8 max-w-full items-center rounded-full border border-amber-400/25 bg-amber-500/10 text-xs font-medium text-amber-700 dark:text-amber-100",
        compact ? "px-1" : "gap-1.5 px-2.5",
      )}
      title={permissionTitle}
    >
      {compact ? null : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
      <Select
        aria-label="AI 执行模式"
        buttonClassName={cn(
          "kerminal-focus-ring h-6 border-0 bg-transparent text-center text-xs font-medium shadow-none [&>span:first-child]:flex-1 [&>span:first-child]:text-center",
          compact
            ? "rounded-full px-2 hover:bg-[var(--surface-hover)]"
            : "px-1 hover:bg-amber-500/10 dark:hover:bg-amber-300/10",
        )}
        className={cn("min-w-0", compact ? "w-[4.25rem]" : "max-w-[7.5rem]")}
        disabled={!onChange}
        menuClassName={cn(
          "max-w-[calc(100vw-2rem)]",
          compact ? cn("w-[4.25rem]", composerCompactMenuClassName) : "w-52",
        )}
        onValueChange={(value) => onChange?.(value as AiCommandApprovalPolicy)}
        options={approvalPolicyOptions.map((option) => ({
          description: compact ? undefined : option.description,
          label: compact ? approvalPolicyCompactLabels[option.value] : option.label,
          value: option.value,
        }))}
        side="top"
        size="sm"
        value={selected.value}
        variant="inline"
      />
    </div>
  );
}

export function ProviderSelector({
  compact = false,
  error,
  onChange,
  onOpenSettings,
  providers,
  selectedProviderId,
  state,
}: {
  compact?: boolean;
  error: string | null;
  onChange: (providerId: string) => void;
  onOpenSettings?: () => void;
  providers: LlmProvider[];
  selectedProviderId: string;
  state: LoadState;
}) {
  if (providers.length === 0) {
    return (
      <button
        aria-label="配置 AI 模型"
        className={cn(
          "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-8 max-w-full items-center rounded-full border text-xs font-medium text-zinc-600 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-300",
          compact ? "px-3" : "gap-1.5 px-2.5",
        )}
        disabled={state === "loading" || !onOpenSettings}
        onClick={onOpenSettings}
        title={error ?? "在设置里配置 LLM Provider"}
        type="button"
      >
        {compact ? null : <Bot className="h-3.5 w-3.5 shrink-0" />}
        {state === "loading" ? "加载模型" : error ? "模型加载失败" : "配置模型"}
      </button>
    );
  }

  return (
    <div
      className={cn(
        compact
          ? "inline-flex h-8 shrink-0 items-center text-xs font-medium text-zinc-600 dark:text-zinc-300"
          : "kerminal-muted-surface inline-flex h-8 max-w-full items-center rounded-full border text-xs font-medium text-zinc-600 dark:text-zinc-300",
        compact ? "" : "gap-1.5 px-2.5",
      )}
      title={error ?? "选择本次对话使用的模型"}
    >
      {compact ? null : <Bot className="h-3.5 w-3.5 shrink-0" />}
      <Select
        aria-label="AI 模型"
        align="right"
        buttonClassName={cn(
          "border-0 bg-transparent text-center text-xs font-medium shadow-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 [&>span:first-child]:flex-1 [&>span:first-child]:text-center",
          compact ? "h-7 rounded-full px-2" : "h-6 px-1",
        )}
        className={cn("min-w-0", compact ? "w-[5rem]" : "max-w-[12rem]")}
        menuClassName={cn(
          "max-w-[calc(100vw-2rem)]",
          compact ? cn("w-[5rem]", composerCompactMenuClassName) : "w-72",
        )}
        onValueChange={onChange}
        options={providers.map((provider) => ({
          description: compact ? compactProviderDescription(provider) : undefined,
          label: compact
            ? compactProviderLabel(provider)
            : `${provider.name} · ${provider.model}`,
          value: provider.id,
        }))}
        side="top"
        size="sm"
        value={selectedProviderId}
        variant="inline"
      />
    </div>
  );
}

function compactProviderLabel(provider: LlmProvider) {
  return provider.model.trim() || provider.name;
}

function compactProviderDescription(provider: LlmProvider) {
  const effort = compactReasoningEffortLabel(provider.reasoningEffort);
  return [provider.name, effort].filter(Boolean).join(" · ") || undefined;
}

function compactReasoningEffortLabel(
  effort: LlmProvider["reasoningEffort"],
) {
  if (effort === "minimal") {
    return "简";
  }
  if (effort === "low") {
    return "低";
  }
  if (effort === "medium") {
    return "中";
  }
  if (effort === "high") {
    return "高";
  }
  return "";
}

export function ConversationHistory({
  activeConversationId,
  conversations,
  onDelete,
  onQueryChange,
  onSelect,
  query,
}: {
  activeConversationId: string;
  conversations: AiConversation[];
  onDelete: (conversationId: string) => void;
  onQueryChange: (query: string) => void;
  onSelect: (conversationId: string) => void;
  query: string;
}) {
  const historyConversations = conversations.filter(
    hasConversationHistoryContent,
  );
  const normalizedQuery = normalizeHistorySearchQuery(query);
  const filteredConversations = normalizedQuery
    ? historyConversations.filter((conversation) =>
        conversationMatchesHistoryQuery(conversation, normalizedQuery),
      )
    : historyConversations;

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <History className="h-4 w-4 text-sky-500 dark:text-sky-300" />
          <span>历史会话</span>
        </div>
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
          {historyConversations.length}
        </span>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
        <input
          aria-label="搜索历史会话"
          className="kerminal-field-surface h-9 w-full rounded-lg border px-8 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="搜索历史、模型或内容"
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="清空历史搜索"
            className="kerminal-focus-ring kerminal-pressable absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-zinc-400 hover:bg-[var(--surface-hover)] hover:text-zinc-700 dark:hover:text-zinc-200"
            onClick={() => onQueryChange("")}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="kerminal-scrollbar max-h-80 space-y-1 overflow-y-auto pr-1">
        {historyConversations.length === 0 ? (
          <div className={aiHistoryEmptyClassName}>
            暂无历史会话
          </div>
        ) : null}
        {historyConversations.length > 0 &&
        filteredConversations.length === 0 ? (
          <div className={aiHistoryEmptyClassName}>
            没有匹配的历史会话
          </div>
        ) : null}
        {filteredConversations.map((conversation) => {
          const active = conversation.id === activeConversationId;
          return (
            <div
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2 py-2 transition",
                active
                  ? "bg-[var(--surface-selected)] ring-1 ring-sky-400/20"
                  : "hover:bg-[var(--surface-hover)]",
              )}
              key={conversation.id}
            >
              <button
                aria-current={active ? "true" : undefined}
                className="kerminal-focus-ring min-w-0 flex-1 rounded-md text-left"
                onClick={() => onSelect(conversation.id)}
                type="button"
              >
                <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {conversation.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <Clock3 className="h-3 w-3" />
                  {formatHistoryTime(conversation.updatedAt)}
                </div>
              </button>
              <Button
                aria-label={`删除对话 ${conversation.title}`}
                className="h-7 w-7 rounded-md opacity-60 group-hover:opacity-100"
                onClick={() => onDelete(conversation.id)}
                size="icon"
                title={`删除对话 ${conversation.title}`}
                variant="ghost"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmptyChatState() {
  return (
    <div className="flex h-full min-h-60 flex-col items-center justify-center px-4 text-center">
      <MessageSquare className="h-8 w-8 text-zinc-400/80" />
      <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        描述你想做什么，Kerminal Agent 会结合当前应用上下文和终端状态协助你。
      </p>
    </div>
  );
}

export function ChatMessageBubble({
  highlighted,
  message,
  onOpenAttachment,
}: {
  highlighted?: boolean;
  message: AiChatMessage;
  onOpenAttachment?: (attachment: AiChatAttachment) => void;
}) {
  const fromUser = message.role === "user";
  return (
    <MessagePrimitive.Root asChild>
      <article
        className={cn(
          "flex gap-2 scroll-mt-24 rounded-2xl transition",
          fromUser ? "justify-end" : "justify-start",
          highlighted && "bg-sky-500/10 ring-2 ring-sky-400/60",
        )}
        data-kerminal-ai-message-highlighted={highlighted ? "true" : undefined}
        data-kerminal-ai-message-id={message.id}
      >
        {!fromUser ? (
          <div className={aiIconBubbleClassName}>
            <Bot className="h-3.5 w-3.5" />
          </div>
        ) : null}
        <div
          className={cn(
            "max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm",
            fromUser
              ? aiAccentSurfaceClassName
              : "kerminal-muted-surface w-full border text-zinc-800 shadow-black/5 dark:text-zinc-200",
          )}
        >
          {!fromUser ? <AssistantProcessSteps message={message} /> : null}
          {fromUser ? (
            <MessagePrimitive.Content
              components={{ Text: UserTextMessagePart }}
            />
          ) : (
            <AssistantMarkdownMessage message={message} />
          )}
          <MessageAttachments
            attachments={message.attachments}
            fromUser={fromUser}
            onOpenAttachment={onOpenAttachment}
          />
          {!fromUser ? <AssistantMessageMeta message={message} /> : null}
        </div>
        {fromUser ? (
          <div className={aiUserIconBubbleClassName}>
            <User className="h-3.5 w-3.5" />
          </div>
        ) : null}
      </article>
    </MessagePrimitive.Root>
  );
}

function UserTextMessagePart() {
  return (
    <MessagePartPrimitive.Text
      className="whitespace-pre-wrap break-words"
      component="div"
      smooth={false}
    />
  );
}

function AssistantProcessSteps({ message }: { message: AiChatMessage }) {
  if (!message.processSteps?.length) {
    return null;
  }

  return (
    <div
      aria-label="AI 处理过程"
      className="kerminal-muted-surface mb-3 space-y-1.5 rounded-xl border border-sky-400/15 p-2.5 dark:border-sky-300/15"
    >
      {message.processSteps.map((step) => (
        <div
          className="flex min-w-0 items-start gap-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300"
          key={step.id}
        >
          <ProcessStepIcon status={step.status} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-zinc-800 dark:text-zinc-100">
              {step.title}
            </div>
            {step.detail ? (
              <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                {step.detail}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProcessStepIcon({ status }: { status: AiChatStreamStep["status"] }) {
  if (status === "done") {
    return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  }
  if (status === "error") {
    return (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
    );
  }
  return (
    <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
  );
}

function AssistantMarkdownMessage({ message }: { message: AiChatMessage }) {
  if (!message.content && message.status === "streaming") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Bot className="h-4 w-4 text-sky-500 dark:text-sky-300" />
        正在等待回复...
      </div>
    );
  }

  return (
    <MessagePrimitive.Content
      components={{
        Text: AssistantMarkdownTextPart,
      }}
    />
  );
}

function AssistantMarkdownTextPart() {
  return (
    <StreamdownTextPrimitive
      className="kerminal-ai-markdown break-words"
      controls={{
        code: true,
        mermaid: false,
        table: true,
      }}
      parseIncompleteMarkdown
      smooth
    />
  );
}

function AssistantMessageMeta({ message }: { message: AiChatMessage }) {
  if (message.status === "error" || message.status === "streaming") {
    return null;
  }

  const visionMeta = assistantVisionMeta(message.visionUsage);

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {message.providerName && message.model ? (
        <span className="kerminal-muted-surface rounded-full border px-2 py-0.5 text-zinc-600 dark:text-zinc-300">
          {message.providerName} · {message.model}
        </span>
      ) : null}
      <span className="rounded-full border border-sky-400/25 bg-[var(--surface-selected)] px-2 py-0.5 text-sky-700 dark:text-sky-100">
        {message.contextUsed ? "已使用上下文" : "无终端上下文"}
      </span>
      {typeof message.toolCount === "number" ? (
        <span className="kerminal-muted-surface rounded-full border px-2 py-0.5 text-zinc-600 dark:text-zinc-300">
          工具 {message.toolCount}
        </span>
      ) : null}
      {message.responseRedacted ? (
        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-100">
          回复已脱敏
        </span>
      ) : null}
      {visionMeta ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
            visionMeta.className,
          )}
          title={visionMeta.title}
        >
          {visionMeta.hasWarning ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <ImageIcon className="h-3 w-3" />
          )}
          {visionMeta.label}
        </span>
      ) : null}
    </div>
  );
}

function assistantVisionMeta(report: AiChatMessage["visionUsage"]) {
  if (!report?.attachments.length) {
    return null;
  }
  const total = report.attachments.length;
  const visionCount = report.attachments.filter(
    (attachment) => attachment.modelInput === "visionInput",
  ).length;
  const textContextCount = report.attachments.filter(
    (attachment) => attachment.modelInput === "textContext",
  ).length;
  const warnings = report.attachments
    .map((attachment) => attachment.warning?.trim())
    .filter((warning): warning is string => Boolean(warning));
  const hasWarning = warnings.length > 0;
  const suffix = hasWarning ? " · 有降级" : "";
  const title = [
    `Provider 视觉能力: ${report.providerSupportsVision ? "支持" : "不支持"}`,
    `Vision adapter: ${report.visionAdapterEnabled ? "启用" : "未启用"}`,
    ...report.attachments.map(
      (attachment) =>
        `${attachment.id}: requested=${attachment.requestedUsage}, effective=${attachment.effectiveUsage}, modelInput=${attachment.modelInput}${
          attachment.warning ? `, warning=${attachment.warning}` : ""
        }`,
    ),
  ].join("\n");

  if (visionCount > 0) {
    return {
      className: hasWarning
        ? "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-100"
        : "border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-100",
      hasWarning,
      label: `图片已进入模型 ${visionCount}/${total}${suffix}`,
      title,
    };
  }
  if (textContextCount > 0) {
    return {
      className: hasWarning
        ? "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-100"
        : "border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-100",
      hasWarning,
      label: `图片文本上下文 ${textContextCount}/${total}${suffix}`,
      title,
    };
  }
  return {
    className: hasWarning
      ? "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-100"
      : "border-zinc-400/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-200",
    hasWarning,
    label: `图片未发送${suffix}`,
    title,
  };
}

export function PendingInvocationPanel({
  error,
  invocation,
  onApprove,
  onReject,
  state,
}: {
  error: string | null;
  invocation: AiToolPendingInvocation | null;
  onApprove: () => void;
  onReject: () => void;
  state: "confirming" | "idle" | "preparing";
}) {
  const visibleInvocation = invocation?.requiresConfirmation ? invocation : null;
  if (!error && !visibleInvocation) {
    return null;
  }

  return (
    <div className="kerminal-muted-surface rounded-2xl border border-amber-400/25 p-3 shadow-sm shadow-amber-950/5 dark:shadow-black/20">
      {error ? (
        <div
          className="mb-3 rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {state === "preparing" ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          正在准备工具调用...
        </div>
      ) : null}
      {visibleInvocation ? (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {visibleInvocation.toolTitle}
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                {visibleInvocation.toolId} · {riskLabel(visibleInvocation.risk)}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-xs",
                statusTone(visibleInvocation.status),
              )}
            >
              {statusLabel(visibleInvocation.status)}
            </span>
          </div>
          <div className="kerminal-muted-surface mt-2 break-words rounded-lg border px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {visibleInvocation.argumentsSummary}
          </div>
          {visibleInvocation.riskSummary ? (
            <div className="mt-2 flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{visibleInvocation.riskSummary}</span>
            </div>
          ) : null}
          {visibleInvocation.reason ? (
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              {visibleInvocation.reason}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button
              className="gap-2"
              disabled={state === "confirming"}
              onClick={onApprove}
              size="sm"
            >
              <Check className="h-3.5 w-3.5" />
              批准
            </Button>
            <Button
              className="gap-2"
              disabled={state === "confirming"}
              onClick={onReject}
              size="sm"
              variant="secondary"
            >
              <X className="h-3.5 w-3.5" />
              拒绝
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
