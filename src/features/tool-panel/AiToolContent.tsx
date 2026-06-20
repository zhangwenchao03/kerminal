import {
  Bot,
  ClipboardCheck,
  History,
  Plus,
  Send,
  Settings,
} from "lucide-react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  streamAiChatMessage,
  type AiCommandExecutionVisibility,
  type AiApplicationContextRequest,
} from "../../lib/aiAgentApi";
import {
  buildAiTerminalContextRequest,
  getAiTerminalContextSnapshot,
  type AiTerminalContextSnapshot,
} from "../../lib/aiContextApi";
import {
  clearAiToolAudits,
  confirmAiToolInvocation,
  exportAiToolAudits,
  listAiToolAudits,
  type AiToolAuditRecord,
  type AiToolPendingInvocation,
} from "../../lib/aiToolInvocationApi";
import { listLlmProviders } from "../../lib/llmProviderApi";
import { getTerminalPaneSession } from "../terminal/terminalSessionRegistry";
import {
  normalizeAppSettings,
  type AiCommandApprovalPolicy,
} from "../settings/settingsModel";
import type { LlmProvider } from "../settings/llmProviderModel";
import { AiAuditManagement } from "./AiAuditManagement";
import {
  ChatMessageBubble,
  CommandVisibilitySwitch,
  ContextStatus,
  ConversationHistory,
  EmptyChatState,
  ExecutionModeSelector,
  PendingInvocationPanel,
  ProviderSelector,
} from "./ai-tool-content/AiToolContentParts";
import {
  AUDIT_EXPORT_LIMIT,
  AUDIT_PANEL_LIMIT,
  aiChatMessageToThreadMessage,
  applyClientAction,
  buildConversationPrompt,
  buildConversationTitle,
  completeAssistantMessage,
  createAssistantDraftMessage,
  createChatMessage,
  createConversation,
  downloadAiAuditExport,
  extractAppendMessageText,
  isBlankConversation,
  limitConversations,
  limitMessages,
  loadCommandVisibility,
  loadConversationState,
  persistCommandVisibility,
  persistConversationState,
  updateConversation,
  updateConversationMessage,
  upsertProcessStep,
  type AiChatMessage,
  type AiToolContentProps,
  type AuditActionState,
  type ChatState,
  type ConversationState,
  type LoadState,
} from "./ai-tool-content/aiToolContentModel";

export type { AiToolContentProps } from "./ai-tool-content/aiToolContentModel";

export function AiToolContent({
  activeTab,
  focusedPane,
  onCreateTerminal,
  onFocusTab,
  onOpenSettingsSection,
  onOpenTool,
  onOpenSshTerminal,
  onRemoteHostCreated,
  onSettingsChange,
  onSplitPane,
  selectedMachine,
  settings,
}: AiToolContentProps) {
  const [auditActionState, setAuditActionState] =
    useState<AuditActionState>("idle");
  const [auditClearRequested, setAuditClearRequested] = useState(false);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [conversationState, setConversationState] = useState<ConversationState>(
    loadConversationState,
  );
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSnapshot, setContextSnapshot] =
    useState<AiTerminalContextSnapshot | null>(null);
  const [contextState, setContextState] = useState<LoadState>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [commandVisibility, setCommandVisibility] =
    useState<AiCommandExecutionVisibility>(loadCommandVisibility);
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  const [pendingInvocations, setPendingInvocations] = useState<
    AiToolPendingInvocation[]
  >([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerState, setProviderState] = useState<LoadState>("idle");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [toolAudits, setToolAudits] = useState<AiToolAuditRecord[]>([]);
  const [toolInvocationError, setToolInvocationError] = useState<string | null>(
    null,
  );
  const [toolInvocationState, setToolInvocationState] =
    useState<"idle" | "preparing" | "confirming">("idle");

  const activeConversation = useMemo(
    () =>
      conversationState.conversations.find(
        (conversation) =>
          conversation.id === conversationState.activeConversationId,
      ) ?? conversationState.conversations[0],
    [conversationState],
  );
  const selectableProviders = useMemo(
    () =>
      llmProviders.filter(
        (provider) => provider.enabled && provider.apiKeyConfigured,
      ),
    [llmProviders],
  );
  const selectedProvider = useMemo(
    () =>
      selectableProviders.find((provider) => provider.id === selectedProviderId) ??
      selectableProviders.find((provider) => provider.isDefault) ??
      selectableProviders[0],
    [selectableProviders, selectedProviderId],
  );
  const sending = chatState === "sending";
  const pendingInvocation = pendingInvocations[0] ?? null;
  const newConversationDisabled = Boolean(
    activeConversation && isBlankConversation(activeConversation),
  );
  const normalizedSettings = useMemo(
    () => normalizeAppSettings(settings),
    [settings],
  );

  const terminalContext = () => {
    const sessionId = focusedPane?.id
      ? getTerminalPaneSession(focusedPane.id)
      : undefined;

    return sessionId
      ? buildAiTerminalContextRequest({
          activeTab,
          focusedPane,
          selectedMachine,
          sessionId,
          settings: normalizedSettings,
        })
      : undefined;
  };

  const applicationContext = (): AiApplicationContextRequest => {
    const sessionId = focusedPane?.id
      ? getTerminalPaneSession(focusedPane.id)
      : undefined;

    return {
      activeToolId: "ai",
      activeTab: activeTab
        ? {
            id: activeTab.id,
            machineId: activeTab.machineId,
            title: activeTab.title,
          }
        : undefined,
      focusedPane: focusedPane
        ? {
            id: focusedPane.id,
            machineId: focusedPane.machineId,
            mode: focusedPane.mode,
            sessionId,
            status: focusedPane.status,
            title: focusedPane.title,
          }
        : undefined,
      selectedMachine: selectedMachine
        ? {
            id: selectedMachine.id,
            kind: selectedMachine.kind,
            name: selectedMachine.name,
            production:
              selectedMachine.kind === "ssh"
                ? selectedMachine.production
                : undefined,
            status: selectedMachine.status,
          }
        : undefined,
    };
  };

  const submitAssistantMessage = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || sending || !activeConversation) {
      setChatError(message ? null : "请输入要发送给 AI 的内容");
      return;
    }

    const now = Date.now();
    const userMessage = createChatMessage("user", message, now);
    const assistantDraft = createAssistantDraftMessage(now + 1);
    const requestMessage = buildConversationPrompt(
      activeConversation.messages,
      message,
    );
    const requestConversationId = activeConversation.id;
    const requestProviderId = selectedProvider?.id;
    const requestTerminalContext = terminalContext();
    const requestApplicationContext = applicationContext();

    setConversationState((current) =>
      updateConversation(current, requestConversationId, (conversation) => ({
        ...conversation,
        messages: limitMessages([
          ...conversation.messages,
          userMessage,
          assistantDraft,
        ]),
        title:
          conversation.messages.length === 0
            ? buildConversationTitle(message)
            : conversation.title,
        updatedAt: now,
      })),
    );
    setChatState("sending");
    setChatError(null);

    try {
      const response = await streamAiChatMessage(
        {
          conversationId: requestConversationId,
          message: requestMessage,
          applicationContext: requestApplicationContext,
          ...(requestProviderId ? { providerId: requestProviderId } : {}),
          terminalContext: requestTerminalContext,
          executionVisibility: commandVisibility,
        },
        {
          onDelta: (delta) => {
            setConversationState((current) =>
              updateConversationMessage(
                current,
                requestConversationId,
                assistantDraft.id,
                (draft) => ({
                  ...draft,
                  content: draft.content + delta,
                  status: "streaming",
                }),
              ),
            );
          },
          onStep: (step) => {
            setConversationState((current) =>
              updateConversationMessage(
                current,
                requestConversationId,
                assistantDraft.id,
                (draft) => ({
                  ...draft,
                  processSteps: upsertProcessStep(draft.processSteps, step),
                  status: step.status === "error" ? "error" : "streaming",
                }),
              ),
            );
          },
        },
      );
      setConversationState((current) =>
        updateConversationMessage(
          current,
          requestConversationId,
          assistantDraft.id,
          (draft) => completeAssistantMessage(draft, response),
        ),
      );
      if (response.pendingInvocations.length > 0) {
        setPendingInvocations((current) => [
          ...current,
          ...response.pendingInvocations,
        ]);
        setToolInvocationError(null);
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setChatError(message);
      setConversationState((current) =>
        updateConversationMessage(
          current,
          requestConversationId,
          assistantDraft.id,
          (draft) => ({
            ...draft,
            content: draft.content || `回复生成失败：${message}`,
            processSteps: upsertProcessStep(draft.processSteps, {
              detail: message,
              id: "complete",
              status: "error",
              title: "对话失败",
            }),
            status: "error",
          }),
        ),
      );
    } finally {
      setChatState("idle");
    }
  };

  const assistantRuntime = useExternalStoreRuntime<AiChatMessage>({
    convertMessage: aiChatMessageToThreadMessage,
    isRunning: sending,
    isSendDisabled: sending || !activeConversation,
    messages: activeConversation?.messages ?? [],
    onNew: async (message: AppendMessage) => {
      await submitAssistantMessage(extractAppendMessageText(message));
    },
  });

  useEffect(() => {
    persistConversationState(conversationState);
  }, [conversationState]);

  useEffect(() => {
    persistCommandVisibility(commandVisibility);
  }, [commandVisibility]);

  useEffect(() => {
    refreshAiPanel();
  }, [
    activeTab?.id,
    focusedPane?.id,
    normalizedSettings.ai.contextMaxOutputBytes,
    selectedMachine?.id,
  ]);

  useEffect(() => {
    setSelectedProviderId((current) => {
      if (
        current &&
        selectableProviders.some((provider) => provider.id === current)
      ) {
        return current;
      }
      return (
        selectableProviders.find((provider) => provider.isDefault)?.id ??
        selectableProviders[0]?.id ??
        ""
      );
    });
  }, [selectableProviders]);

  const openAiSettings = () => {
    if (onOpenSettingsSection) {
      onOpenSettingsSection("settings-ai");
      return;
    }
    onOpenTool?.("settings");
  };

  const loadContext = async () => {
    setContextState("loading");
    setContextError(null);
    try {
      const sessionId = focusedPane?.id
        ? getTerminalPaneSession(focusedPane.id)
        : undefined;
      const snapshot = await getAiTerminalContextSnapshot(
        buildAiTerminalContextRequest({
          activeTab,
          focusedPane,
          selectedMachine,
          sessionId,
          settings: normalizedSettings,
        }),
      );
      setContextSnapshot(snapshot);
      setContextState("idle");
    } catch (nextError) {
      setContextSnapshot(null);
      setContextError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setContextState("error");
    }
  };

  const loadProviders = async () => {
    setProviderState("loading");
    setProviderError(null);
    try {
      setLlmProviders(await listLlmProviders());
      setProviderState("idle");
    } catch (nextError) {
      setProviderError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setProviderState("error");
    }
  };

  const loadAudits = async () => {
    try {
      setToolAudits(await listAiToolAudits({ limit: AUDIT_PANEL_LIMIT }));
    } catch (nextError) {
      setToolInvocationError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  };

  const refreshAiPanel = () => {
    void loadContext();
    void loadProviders();
    void loadAudits();
  };

  const updateCommandApprovalPolicy = (policy: AiCommandApprovalPolicy) => {
    onSettingsChange?.(
      normalizeAppSettings({
        ...normalizedSettings,
        ai: {
          ...normalizedSettings.ai,
          commandApprovalPolicy: policy,
          requireRemoteApproval: policy !== "relaxed",
        },
      }),
    );
  };

  const selectConversation = (conversationId: string) => {
    setConversationState((current) => ({
      ...current,
      activeConversationId: conversationId,
    }));
    setChatError(null);
    setHistoryOpen(false);
  };

  const startNewConversation = () => {
    setConversationState((current) => {
      const active = current.conversations.find(
        (conversation) => conversation.id === current.activeConversationId,
      );
      if (active && isBlankConversation(active)) {
        return {
          activeConversationId: active.id,
          conversations: limitConversations(current.conversations),
        };
      }

      const existingDraft = current.conversations.find(isBlankConversation);
      if (existingDraft) {
        return {
          activeConversationId: existingDraft.id,
          conversations: limitConversations(current.conversations),
        };
      }

      const conversation = createConversation();
      return {
        activeConversationId: conversation.id,
        conversations: limitConversations([conversation, ...current.conversations]),
      };
    });
    setChatError(null);
    setHistoryOpen(false);
  };

  const deleteConversation = (conversationId: string) => {
    setConversationState((current) => {
      const remaining = limitConversations(
        current.conversations.filter(
          (conversation) => conversation.id !== conversationId,
        ),
      );
      const conversations = remaining.length > 0 ? remaining : [createConversation()];
      const activeConversationId = conversations.some(
        (conversation) => conversation.id === current.activeConversationId,
      )
        ? current.activeConversationId
        : conversations[0].id;

      return {
        activeConversationId,
        conversations,
      };
    });
  };

  const resolvePendingInvocation = async (approved: boolean) => {
    if (!pendingInvocation) {
      return;
    }

    setToolInvocationState("confirming");
    setToolInvocationError(null);
    try {
      const audit = await confirmAiToolInvocation({
        approved,
        invocationId: pendingInvocation.id,
      });
      if (approved && audit.status === "succeeded") {
        applyClientAction(pendingInvocation.clientAction, {
          onCreateTerminal,
          onFocusTab,
          onOpenTool,
          onOpenSshTerminal,
          onSplitPane,
        });
        if (pendingInvocation.toolId === "remote_host.create") {
          await onRemoteHostCreated?.();
        }
      }
      setPendingInvocations((current) =>
        current.filter((invocation) => invocation.id !== pendingInvocation.id),
      );
      setToolAudits((current) =>
        [audit, ...current.filter((item) => item.id !== audit.id)].slice(
          0,
          AUDIT_PANEL_LIMIT,
        ),
      );
      setAuditMessage(null);
    } catch (nextError) {
      setToolInvocationError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setToolInvocationState("idle");
    }
  };

  const refreshAuditList = async () => {
    setAuditMessage(null);
    await loadAudits();
  };

  const handleExportAudits = async () => {
    setAuditActionState("exporting");
    setToolInvocationError(null);
    setAuditMessage(null);
    try {
      const exported = await exportAiToolAudits({ limit: AUDIT_EXPORT_LIMIT });
      downloadAiAuditExport(exported);
      setAuditMessage(`已导出 ${exported.count} 条 AI 工具审计。`);
    } catch (nextError) {
      setToolInvocationError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setAuditActionState("idle");
    }
  };

  const handleConfirmClearAudits = async () => {
    setAuditActionState("clearing");
    setToolInvocationError(null);
    setAuditMessage(null);
    try {
      const result = await clearAiToolAudits();
      setToolAudits([]);
      setAuditClearRequested(false);
      setAuditMessage(`已清空 ${result.clearedCount} 条 AI 工具审计。`);
    } catch (nextError) {
      setToolInvocationError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setAuditActionState("idle");
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-50/80 text-zinc-950 dark:bg-[#101012] dark:text-zinc-50">
      <header className="relative shrink-0 border-b border-black/8 px-4 py-3 dark:border-white/8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            <span className="truncate">Kerminal Agent</span>
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <CommandVisibilitySwitch
              value={commandVisibility}
              onChange={setCommandVisibility}
            />
            <Button
              aria-label={historyOpen ? "关闭历史会话" : "查看历史会话"}
              aria-pressed={historyOpen}
              className="h-8 w-8 rounded-lg"
              onClick={() => {
                setHistoryOpen((open) => !open);
                setAuditOpen(false);
              }}
              size="icon"
              title={historyOpen ? "关闭历史会话" : "查看历史会话"}
              variant={historyOpen ? "secondary" : "ghost"}
            >
              <History className="h-4 w-4" />
            </Button>
            <Button
              aria-label="新建 AI 对话"
              className="h-8 w-8 rounded-lg"
              disabled={newConversationDisabled}
              onClick={startNewConversation}
              size="icon"
              title={
                newConversationDisabled ? "当前已有空白对话" : "新建 AI 对话"
              }
              variant="ghost"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              aria-label={auditOpen ? "关闭工具审计" : "查看工具审计"}
              aria-pressed={auditOpen}
              className="h-8 w-8 rounded-lg"
              onClick={() => {
                setAuditOpen((open) => !open);
                setHistoryOpen(false);
              }}
              size="icon"
              title={auditOpen ? "关闭工具审计" : "查看工具审计"}
              variant={auditOpen ? "secondary" : "ghost"}
            >
              <ClipboardCheck className="h-4 w-4" />
            </Button>
            <Button
              aria-label="打开 AI 设置"
              className="h-8 w-8 rounded-lg"
              disabled={!onOpenSettingsSection && !onOpenTool}
              onClick={openAiSettings}
              size="icon"
              title="打开 AI 设置"
              variant="ghost"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ContextStatus
          error={contextError}
          snapshot={contextSnapshot}
          state={contextState}
        />

        {historyOpen ? (
          <div className="absolute left-3 right-3 top-[calc(100%-0.25rem)] z-30 overflow-hidden rounded-xl border border-black/10 bg-zinc-50/96 shadow-2xl shadow-black/15 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96 dark:shadow-black/50">
            <ConversationHistory
              activeConversationId={conversationState.activeConversationId}
              conversations={conversationState.conversations}
              onDelete={deleteConversation}
              onQueryChange={setHistoryQuery}
              onSelect={selectConversation}
              query={historyQuery}
            />
          </div>
        ) : null}

        {auditOpen ? (
          <div className="kerminal-scrollbar absolute left-3 right-3 top-[calc(100%-0.25rem)] z-30 max-h-[28rem] overflow-y-auto rounded-xl border border-black/10 bg-zinc-50/96 p-3 shadow-2xl shadow-black/15 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/96 dark:shadow-black/50">
            <AiAuditManagement
              actionState={auditActionState}
              audits={toolAudits}
              clearRequested={auditClearRequested}
              message={auditMessage}
              onCancelClear={() => setAuditClearRequested(false)}
              onConfirmClear={() => void handleConfirmClearAudits()}
              onExport={() => void handleExportAudits()}
              onRefresh={() => void refreshAuditList()}
              onRequestClear={() => setAuditClearRequested(true)}
            />
          </div>
        ) : null}
      </header>

      <AssistantRuntimeProvider runtime={assistantRuntime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport
            aria-label="AI 对话消息"
            autoScroll
            className="kerminal-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5"
          >
            <ThreadPrimitive.Empty>
              <EmptyChatState />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const chatMessage = activeConversation?.messages.find(
                  (item) => item.id === message.id,
                );
                if (!chatMessage) {
                  return null;
                }
                return (
                  <ChatMessageBubble
                    message={chatMessage}
                  />
                );
              }}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>

          <div className="shrink-0 space-y-3 border-t border-black/8 p-3 dark:border-white/8">
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
              onApprove={() => void resolvePendingInvocation(true)}
              onReject={() => void resolvePendingInvocation(false)}
            />

            <ComposerPrimitive.Root className="rounded-2xl border border-black/10 bg-zinc-50/90 p-3 shadow-sm shadow-black/5 dark:border-white/10 dark:bg-white/6 dark:shadow-black/20">
              <label className="sr-only" htmlFor="ai-chat-input">
                AI 对话输入
              </label>
              <ComposerPrimitive.Input
                aria-label="AI 对话输入"
                className="max-h-40 min-h-20 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                disabled={sending}
                id="ai-chat-input"
                placeholder="让 AI 帮你做点什么..."
                submitMode="enter"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <ExecutionModeSelector
                    onChange={
                      onSettingsChange ? updateCommandApprovalPolicy : undefined
                    }
                    settings={normalizedSettings}
                  />
                  <ProviderSelector
                    error={providerError}
                    onChange={setSelectedProviderId}
                    onOpenSettings={
                      onOpenSettingsSection || onOpenTool
                        ? openAiSettings
                        : undefined
                    }
                    providers={selectableProviders}
                    selectedProviderId={selectedProvider?.id ?? ""}
                    state={providerState}
                  />
                </div>
                <ComposerPrimitive.Send
                  aria-label="发送 AI 消息"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm shadow-sky-950/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-400 dark:text-zinc-950 dark:hover:bg-sky-300"
                  title="发送 AI 消息"
                  type="submit"
                >
                  <Send className="h-4 w-4" />
                </ComposerPrimitive.Send>
              </div>
            </ComposerPrimitive.Root>
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </section>
  );
}
