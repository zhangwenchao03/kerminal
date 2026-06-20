import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  EyeOff,
  History,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  MessagePartPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import { StreamdownTextPrimitive } from "@assistant-ui/react-streamdown";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type { AiCommandExecutionVisibility, AiChatStreamStep } from "../../../lib/aiAgentApi";
import type { AiTerminalContextSnapshot } from "../../../lib/aiContextApi";
import type { AiToolPendingInvocation } from "../../../lib/aiToolInvocationApi";
import { cn } from "../../../lib/cn";
import type { AiCommandApprovalPolicy, AppSettings } from "../../settings/settingsModel";
import type { LlmProvider } from "../../settings/llmProviderModel";
import { riskLabel } from "../toolRegistryModel";
import {
  compactId,
  conversationMatchesHistoryQuery,
  formatBytes,
  formatHistoryTime,
  hasConversationHistoryContent,
  normalizeHistorySearchQuery,
  statusLabel,
  statusTone,
  type AiChatMessage,
  type AiConversation,
  type LoadState,
} from "./aiToolContentModel";

export function ContextStatus({
  error,
  snapshot,
  state,
}: {
  error: string | null;
  snapshot: AiTerminalContextSnapshot | null;
  state: LoadState;
}) {
  const progress =
    snapshot && snapshot.output.maxBytes > 0
      ? Math.min(
          100,
          Math.max(
            2,
            Math.round(
              (snapshot.output.capturedBytes / snapshot.output.maxBytes) * 100,
            ),
          ),
        )
      : 0;

  if (state === "loading") {
    return (
      <div className="mt-3 space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            正在读取当前终端上下文
          </span>
          <span>上下文</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
          <div className="h-full w-1/3 rounded-full bg-sky-500/70" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 space-y-2 text-xs text-amber-700 dark:text-amber-100">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </span>
          <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
            上下文不可用
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
          <div className="h-full w-0 rounded-full bg-amber-500/70" />
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="mt-3 space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center justify-between gap-3">
          <span>暂未绑定真实终端上下文</span>
          <span>0 / 0 B</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
          <div className="h-full w-0 rounded-full bg-zinc-400/70" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100">
          当前上下文已连接 · {snapshot.source.paneTitle ?? snapshot.source.paneId}
        </span>
        <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
          {formatBytes(snapshot.output.capturedBytes)} /{" "}
          {formatBytes(snapshot.output.maxBytes)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/8">
        <div
          className="h-full rounded-full bg-sky-500/80"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-zinc-500 dark:text-zinc-400">
        <span className="truncate">Session {compactId(snapshot.session.id)}</span>
        {snapshot.redacted ? <span className="shrink-0">已脱敏</span> : null}
      </div>
    </div>
  );
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
      className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-lg border border-black/10 bg-black/[0.03] p-0.5 dark:border-white/10 dark:bg-white/6"
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
          "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition",
          terminalSelected
            ? "bg-sky-500 text-white shadow-sm shadow-sky-950/15 dark:bg-sky-400 dark:text-zinc-950"
            : "text-zinc-500 hover:bg-black/[0.05] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100",
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
          "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition",
          !terminalSelected
            ? "bg-zinc-900 text-white shadow-sm shadow-black/15 dark:bg-zinc-100 dark:text-zinc-950"
            : "text-zinc-500 hover:bg-black/[0.05] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100",
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

export function ExecutionModeSelector({
  onChange,
  settings,
}: {
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
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 dark:text-amber-100"
      title={permissionTitle}
    >
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
      <Select
        aria-label="AI 执行模式"
        buttonClassName="h-6 border-0 bg-transparent px-1 text-xs font-medium shadow-none hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-400/20 dark:hover:bg-white/10"
        className="min-w-0 max-w-[7.5rem]"
        disabled={!onChange}
        menuClassName="w-52"
        onValueChange={(value) =>
          onChange?.(value as AiCommandApprovalPolicy)
        }
        options={approvalPolicyOptions.map((option) => ({
          description: option.description,
          label: option.label,
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
  error,
  onChange,
  onOpenSettings,
  providers,
  selectedProviderId,
  state,
}: {
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
        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.03] px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/6 dark:text-zinc-300 dark:hover:bg-white/10"
        disabled={state === "loading" || !onOpenSettings}
        onClick={onOpenSettings}
        title={error ?? "在设置里配置 LLM Provider"}
        type="button"
      >
        <Bot className="h-3.5 w-3.5 shrink-0" />
        {state === "loading"
          ? "加载模型"
          : error
            ? "模型加载失败"
            : "配置模型"}
      </button>
    );
  }

  return (
    <div
      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.03] px-2.5 text-xs font-medium text-zinc-600 dark:border-white/10 dark:bg-white/6 dark:text-zinc-300"
      title={error ?? "选择本次对话使用的模型"}
    >
      <Bot className="h-3.5 w-3.5 shrink-0" />
      <Select
        aria-label="AI 模型"
        align="right"
        buttonClassName="h-6 border-0 bg-transparent px-1 text-xs font-medium shadow-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/15 dark:hover:bg-white/10"
        className="min-w-0 max-w-[12rem]"
        menuClassName="w-72"
        onValueChange={onChange}
        options={providers.map((provider) => ({
          label: `${provider.name} · ${provider.model}`,
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
  const historyConversations = conversations.filter(hasConversationHistoryContent);
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
          className="h-9 w-full rounded-lg border border-black/8 bg-zinc-100/80 px-8 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-sky-400/50 focus:ring-4 focus:ring-sky-500/10 dark:border-white/10 dark:bg-white/6 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="搜索历史、模型或内容"
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label="清空历史搜索"
            className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-zinc-400 transition hover:bg-black/6 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            onClick={() => onQueryChange("")}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="kerminal-scrollbar max-h-80 space-y-1 overflow-y-auto pr-1">
        {historyConversations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/10 px-3 py-6 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            暂无历史会话
          </div>
        ) : null}
        {historyConversations.length > 0 && filteredConversations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/10 px-3 py-6 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
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
                  ? "bg-sky-500/10 ring-1 ring-sky-400/20"
                  : "hover:bg-black/[0.04] dark:hover:bg-white/8",
              )}
              key={conversation.id}
            >
              <button
                className="min-w-0 flex-1 text-left"
                aria-current={active ? "true" : undefined}
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
  message,
}: {
  message: AiChatMessage;
}) {
  const fromUser = message.role === "user";
  return (
    <MessagePrimitive.Root asChild>
      <article
        className={cn(
          "flex gap-2",
          fromUser ? "justify-end" : "justify-start",
        )}
      >
        {!fromUser ? (
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100">
            <Bot className="h-3.5 w-3.5" />
          </div>
        ) : null}
        <div
          className={cn(
            "max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm",
            fromUser
              ? "bg-sky-500 text-white shadow-sky-950/20"
              : "w-full border border-black/8 bg-black/[0.03] text-zinc-800 shadow-black/5 dark:border-white/8 dark:bg-black/20 dark:text-zinc-200",
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
          {!fromUser ? <AssistantMessageMeta message={message} /> : null}
        </div>
        {fromUser ? (
          <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
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
      className="mb-3 space-y-1.5 rounded-xl border border-sky-400/15 bg-sky-500/8 p-2.5 dark:border-sky-300/15 dark:bg-sky-400/8"
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
    return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />;
  }
  return <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />;
}

function AssistantMarkdownMessage({ message }: { message: AiChatMessage }) {
  if (!message.content && message.status === "streaming") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Bot className="h-4 w-4 animate-pulse text-sky-500 dark:text-sky-300" />
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

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {message.providerName && message.model ? (
            <span className="rounded-full border border-zinc-400/20 bg-zinc-100/80 px-2 py-0.5 text-zinc-600 dark:bg-black/20 dark:text-zinc-300">
          {message.providerName} · {message.model}
        </span>
      ) : null}
      <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-100">
        {message.contextUsed ? "已使用上下文" : "无终端上下文"}
      </span>
      {typeof message.toolCount === "number" ? (
        <span className="rounded-full border border-zinc-400/20 bg-zinc-100/80 px-2 py-0.5 text-zinc-600 dark:bg-black/20 dark:text-zinc-300">
          工具 {message.toolCount}
        </span>
      ) : null}
      {message.responseRedacted ? (
        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-100">
          回复已脱敏
        </span>
      ) : null}
    </div>
  );
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
  if (!error && !invocation) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 dark:bg-amber-500/10">
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
      {invocation ? (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {invocation.toolTitle}
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                {invocation.toolId} · {riskLabel(invocation.risk)}
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-xs",
                statusTone(invocation.status),
              )}
            >
              {statusLabel(invocation.status)}
            </span>
          </div>
          <div className="mt-2 break-words rounded-lg bg-zinc-50/65 px-3 py-2 font-mono text-xs text-zinc-700 dark:bg-black/20 dark:text-zinc-300">
            {invocation.argumentsSummary}
          </div>
          {invocation.riskSummary ? (
            <div className="mt-2 flex gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{invocation.riskSummary}</span>
            </div>
          ) : null}
          {invocation.reason ? (
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              {invocation.reason}
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
