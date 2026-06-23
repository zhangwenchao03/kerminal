import { isTauri } from "@tauri-apps/api/core";
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { streamAiChatMessage, type AiCommandExecutionVisibility } from "../../lib/aiAgentApi";
import {
  cancelAiAgentRun,
  getAiAgentRun,
  resumeAiAgentRun,
  retryAiAgentRunLastStep,
  type AiAgentHarnessRunResult,
  type AiAgentRunSnapshot,
} from "../../lib/aiAgentRunApi";
import { getAiTerminalContextSnapshot, type AiTerminalContextSnapshot } from "../../lib/aiContextApi";
import { clearAiToolAudits, exportAiToolAudits, listAiToolAudits, type AiToolAuditRecord } from "../../lib/aiToolInvocationApi";
import { listLlmProviders } from "../../lib/llmProviderApi";
import { getTerminalPaneSession } from "../terminal/terminalSessionRegistry";
import { normalizeAppSettings, type AiCommandApprovalPolicy } from "../settings/settingsModel";
import type { LlmProvider } from "../settings/llmProviderModel";
import type { AiAuditContextOpenRequest } from "./AiAuditManagement";
import { AiAttachmentPreviewDialog } from "./ai-tool-content/AiAttachmentPreviewDialog";
import { AiContextSnapshotDetailDialog } from "./ai-tool-content/AiContextSnapshotDetailDialog";
import { AiToolContentComposer } from "./ai-tool-content/AiToolContentComposer";
import { AiToolContentHeader } from "./ai-tool-content/AiToolContentHeader";
import { AiThreadViewport } from "./ai-tool-content/AiThreadViewport";
import { AiConversationHistoryDialog } from "./ai-tool-content/AiConversationHistoryDialog";
import { activateStoredConversationSlot, conversationFromStoredConversation, createAndActivateStoredConversation, deleteStoredConversationRecord, getStoredConversationRecord, mergeStoredConversationIntoState, persistAssistantErrorMessage, persistAssistantResponseMessage, persistMessageContextSnapshot, persistUserChatMessage } from "./ai-tool-content/aiConversationPersistence";
import { findAuditContextAttachment, resolveAuditContextConversationId, resolveAuditContextMessageId } from "./ai-tool-content/auditContextJump";
import { buildAiChatAttachmentContexts, buildAiToolAuditContext, captureAiTerminalSnapshotForPersistence, useAiToolContentLatestRefs, useStoredConversationSlotHydration, type AiConversationSlotHydrationState } from "./ai-tool-content/aiToolContentRuntime";
import { AI_TERMINAL_SESSION_NOT_READY_ERROR, isAiTerminalContextReadinessBlocked, resolveAiWorkspaceTarget } from "./ai-tool-content/aiTargetResolution";
import { aiAgentRunResultChangesRemoteHostTree, resolveAiToolInvocation } from "./ai-tool-content/aiToolInvocationResolution";
import { appendPendingInvocations, loadPendingInvocationQueue, removePendingInvocation, selectActivePendingInvocation, type AiPendingInvocationQueueItem } from "./ai-tool-content/aiPendingInvocationQueue";
import { useAiPendingInvocationRecovery } from "./ai-tool-content/useAiPendingInvocationRecovery";
import { useConversationRunningState } from "./ai-tool-content/useConversationRunningState";
import { useAutoResolvePendingInvocation } from "./ai-tool-content/useAutoResolvePendingInvocation";
import { useAiPendingAttachments } from "./ai-tool-content/useAiPendingAttachments";
import { useAiConversationHistoryList, type AiConversationHistoryRow } from "./ai-tool-content/useAiConversationHistoryList";
import { buildAiChatHistory } from "./ai-tool-content/aiConversationTranscript";
import { AUDIT_EXPORT_LIMIT, AUDIT_PANEL_LIMIT, aiChatMessageToThreadMessage, buildConversationTitle, completeAssistantMessage, createAssistantDraftMessage, createChatMessage, createConversation, downloadAiAuditExport, extractAppendMessageText, isBlankConversation, limitConversations, limitMessages, loadCommandVisibility, loadConversationState, persistCommandVisibility, persistConversationState, resolveAiConversationRouteSelection, updateConversation, updateConversationMessage, upsertProcessStep, type AiChatAttachment, type AiChatMessage, type AiToolContentProps, type AuditActionState, type ConversationState, type LoadState } from "./ai-tool-content/aiToolContentModel";

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
  const [auditActionState, setAuditActionState] = useState<AuditActionState>("idle");
  const [auditClearRequested, setAuditClearRequested] = useState(false);
  const [auditMessage, setAuditMessage] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState>(loadConversationState);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSnapshot, setContextSnapshot] = useState<AiTerminalContextSnapshot | null>(null);
  const [contextState, setContextState] = useState<LoadState>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [snapshotDetailId, setSnapshotDetailId] = useState<string | null>(null);
  const [slotHydrationState, setSlotHydrationState] = useState<AiConversationSlotHydrationState>("idle");
  const [commandVisibility, setCommandVisibility] = useState<AiCommandExecutionVisibility>(loadCommandVisibility);
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<AiChatAttachment | null>(null);
  const [pendingInvocations, setPendingInvocations] =
    useState<AiPendingInvocationQueueItem[]>(loadPendingInvocationQueue);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerState, setProviderState] = useState<LoadState>("idle");
  const [runActionState, setRunActionState] = useState<"cancelling" | "idle" | "retrying">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [runFinalMessage, setRunFinalMessage] = useState<string | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<AiAgentRunSnapshot | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [toolAudits, setToolAudits] = useState<AiToolAuditRecord[]>([]);
  const [toolInvocationError, setToolInvocationError] = useState<string | null>(null);
  const [toolInvocationState, setToolInvocationState] = useState<"idle" | "preparing" | "confirming">("idle");
  const autoResolvedInvocationIdsRef = useRef(new Set<string>());

  const activeConversation = useMemo(
    () => conversationState.conversations.find((conversation) => conversation.id === conversationState.activeConversationId) ?? conversationState.conversations[0],
    [conversationState],
  );
  const selectableProviders = useMemo(
    () => llmProviders.filter((provider) => provider.enabled && provider.apiKeyConfigured),
    [llmProviders],
  );
  const selectedProvider = useMemo(
    () =>
      selectableProviders.find(
        (provider) => provider.id === selectedProviderId,
      ) ??
      selectableProviders.find((provider) => provider.isDefault) ??
      selectableProviders[0],
    [selectableProviders, selectedProviderId],
  );
  const conversationRunning = useConversationRunningState(activeConversation?.id);
  const sending = conversationRunning.activeConversationRunning;
  const normalizedSettings = useMemo(() => normalizeAppSettings(settings), [settings]);
  const currentWorkspaceTarget = useMemo(
    () =>
      resolveAiWorkspaceTarget({
        activeTab,
        focusedPane,
        selectedMachine,
        sessionId: focusedPane?.id
          ? getTerminalPaneSession(focusedPane.id)
          : undefined,
        settings: normalizedSettings,
      }),
    [
      activeTab?.id,
      activeTab?.machineId,
      activeTab?.title,
      focusedPane?.id,
      focusedPane?.machineId,
      focusedPane?.title,
      normalizedSettings,
      selectedMachine?.id,
      selectedMachine?.kind,
      selectedMachine?.name,
    ],
  );
  const conversationSlot = currentWorkspaceTarget.conversationSlot;
  const terminalContextBlocked = isAiTerminalContextReadinessBlocked(
    currentWorkspaceTarget,
  );
  const pendingInvocationItem = selectActivePendingInvocation(
    pendingInvocations,
    activeConversation?.id,
    conversationSlot,
  );
  const pendingInvocation = pendingInvocationItem?.invocation ?? null;
  const newConversationDisabled = Boolean(activeConversation && isBlankConversation(activeConversation));
  const conversationPersistenceEnabled = useMemo(() => isTauri(), []);
  const {
    addLocalImageAttachment,
    attachmentDropActive,
    attachmentDropZoneRef,
    clearPendingAttachments,
    handleAttachmentDragLeave,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleAttachmentPaste,
    importingAttachment,
    pendingAttachments,
    removePendingAttachment,
  } = useAiPendingAttachments({
    activeConversation,
    conversationPersistenceEnabled,
    conversationSlot,
    setChatError,
    setConversationState,
  });
  const { activeConversationRef, commandVisibilityRef, pendingAttachmentsRef, selectedProviderRef } =
    useAiToolContentLatestRefs({
    activeConversation,
    commandVisibility,
    pendingAttachments,
    selectedProvider,
  });
  useStoredConversationSlotHydration({
    conversationPersistenceEnabled,
    conversationSlot,
    onHydrationStateChange: setSlotHydrationState,
    setConversationState,
  });
  const historyPersistenceEnabled =
    conversationPersistenceEnabled && slotHydrationState !== "failed";
  const historyList = useAiConversationHistoryList({
    conversationPersistenceEnabled: historyPersistenceEnabled,
    conversations: conversationState.conversations,
    currentSlot: conversationSlot,
    open: historyOpen,
    query: historyQuery,
  });
  useAiPendingInvocationRecovery({ conversationPersistenceEnabled, pendingInvocations, setPendingInvocations, setToolInvocationError });
  const submitAssistantMessage = async (rawMessage: string) => {
    const message = rawMessage.trim();
    const currentActiveConversation = activeConversationRef.current;
    const attachmentsForMessage = pendingAttachmentsRef.current;
    if (!currentActiveConversation || conversationRunning.isConversationRunning(currentActiveConversation.id)) {
      setChatError(null);
      return;
    }
    if (!message && attachmentsForMessage.length === 0) {
      setChatError("请输入要发送给 AI 的内容或添加图片");
      return;
    }
    const requestWorkspaceTarget = resolveAiWorkspaceTarget({
      activeTab,
      focusedPane,
      selectedMachine,
      sessionId: focusedPane?.id
        ? getTerminalPaneSession(focusedPane.id)
        : undefined,
      settings: normalizedSettings,
    });
    const now = Date.now();
    const userMessage = {
      ...createChatMessage("user", message, now),
      ...(attachmentsForMessage.length > 0
        ? { attachments: attachmentsForMessage }
        : {}),
    };
    const assistantDraft = createAssistantDraftMessage(now + 1);
    const requestMessageText =
      message || "请分析我发送的图片，提取其中可操作的信息。";
    const requestHistory = buildAiChatHistory(currentActiveConversation.messages);
    const requestConversationId = currentActiveConversation.id;
    if (!conversationRunning.startConversationRun(requestConversationId)) {
      setChatError(null);
      return;
    }
    const requestProvider = selectedProviderRef.current;
    const requestProviderId = requestProvider?.id;
    const requestApplicationContext = requestWorkspaceTarget.applicationContext;
    const requestConversationSlot = requestWorkspaceTarget.conversationSlot;
    const requestTerminalContext = requestWorkspaceTarget.terminalContext;
    const persistedContextSnapshot = conversationPersistenceEnabled
      ? captureAiTerminalSnapshotForPersistence(requestTerminalContext).then(
          ({ terminalSnapshot, terminalSnapshotError }) =>
            persistMessageContextSnapshot({
              applicationContext: requestApplicationContext,
              attachments: attachmentsForMessage,
              conversationId: requestConversationId,
              conversationSlot: requestConversationSlot,
              executionVisibility: commandVisibilityRef.current,
              providerContextStrategy: requestProvider?.contextStrategy,
              providerId: requestProvider?.id,
              providerModel: requestProvider?.model,
              providerName: requestProvider?.name,
              terminalContext: requestTerminalContext,
              terminalSnapshot,
              terminalSnapshotError,
            }),
        )
      : Promise.resolve(null);
    const persistedUserMessage = conversationPersistenceEnabled
      ? persistedContextSnapshot.then((snapshot) =>
          persistUserChatMessage({
            attachmentIds: attachmentsForMessage.map((attachment) => attachment.id),
            content: message,
            contextSnapshotId: snapshot?.id,
            conversationId: requestConversationId,
          }),
        )
      : Promise.resolve(null);

    void persistedContextSnapshot.then((snapshot) => {
      if (!snapshot?.id) {
        return;
      }
      setConversationState((current) =>
        updateConversationMessage(
          current,
          requestConversationId,
          userMessage.id,
          (currentUserMessage) => ({
            ...currentUserMessage,
            contextSnapshotId: snapshot.id,
          }),
        ),
      );
    });
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
            ? buildConversationTitle(
                message || attachmentsForMessage[0]?.originalName || "图片对话",
              )
            : conversation.title,
        updatedAt: now,
      })),
    );
    clearPendingAttachments();
    setChatError(null);
    try {
      const response = await streamAiChatMessage(
        {
          conversationId: requestConversationId,
          conversationSlotJson: JSON.stringify(requestConversationSlot),
          message: requestMessageText,
          ...(requestHistory.length > 0 ? { history: requestHistory } : {}),
          ...(attachmentsForMessage.length > 0
            ? { attachments: buildAiChatAttachmentContexts(attachmentsForMessage) }
            : {}),
          applicationContext: requestApplicationContext,
          ...(requestProviderId ? { providerId: requestProviderId } : {}),
          terminalContext: requestTerminalContext,
          executionVisibility: commandVisibilityRef.current,
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
      await persistedUserMessage;
      if (conversationPersistenceEnabled) {
        void persistAssistantResponseMessage({
          conversationId: requestConversationId,
          response,
        });
      }
      setConversationState((current) =>
        updateConversationMessage(
          current,
          requestConversationId,
          assistantDraft.id,
          (draft) => completeAssistantMessage(draft, response),
        ),
      );
      if (response.pendingInvocations.length > 0) {
        setPendingInvocations((current) =>
          appendPendingInvocations(current, {
            conversationId: requestConversationId,
            conversationSlot: requestConversationSlot,
            invocations: response.pendingInvocations,
          }),
        );
        setToolInvocationError(null);
      }
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      void persistedUserMessage;
      if (conversationPersistenceEnabled) {
        void persistAssistantErrorMessage({
          content: `回复生成失败：${message}`,
          conversationId: requestConversationId,
        });
      }
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
      conversationRunning.finishConversationRun(requestConversationId);
    }
  };

  const assistantRuntime = useExternalStoreRuntime<AiChatMessage>({
    convertMessage: aiChatMessageToThreadMessage,
    isRunning: sending,
    isSendDisabled:
      sending || importingAttachment || !activeConversation,
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
    const runId = pendingInvocation?.runId?.trim();
    if (!runId || runSnapshot?.run.id === runId) {
      return;
    }
    void loadPendingRunSnapshot(runId);
  }, [pendingInvocation?.runId, runSnapshot?.run.id]);

  useEffect(() => {
    if (!highlightedMessageId || typeof document === "undefined") {
      return;
    }

    const scrollTimer = window.setTimeout(() => {
      const element = document.querySelector(
        '[data-kerminal-ai-message-highlighted="true"]',
      );
      if (element instanceof HTMLElement && element.scrollIntoView) {
        element.scrollIntoView({ block: "center" });
      }
    }, 0);
    const clearTimer = window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === highlightedMessageId ? null : current,
      );
    }, 5000);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [conversationState.activeConversationId, highlightedMessageId]);

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

  const toggleHistory = () => {
    setHistoryOpen((open) => !open);
    setAuditOpen(false);
  };

  const toggleAudit = () => {
    setAuditOpen((open) => !open);
    setHistoryOpen(false);
  };

  const loadContext = async () => {
    setContextState("loading");
    setContextError(null);
    const requestWorkspaceTarget = resolveAiWorkspaceTarget({
      activeTab,
      focusedPane,
      selectedMachine,
      sessionId: focusedPane?.id
        ? getTerminalPaneSession(focusedPane.id)
        : undefined,
      settings: normalizedSettings,
    });
    if (isAiTerminalContextReadinessBlocked(requestWorkspaceTarget)) {
      setContextSnapshot(null);
      setContextError(AI_TERMINAL_SESSION_NOT_READY_ERROR);
      setContextState("error");
      return;
    }
    try {
      const snapshot = await getAiTerminalContextSnapshot(
        requestWorkspaceTarget.terminalSnapshotRequest,
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

  const applyAgentRunResult = async (
    result: AiAgentHarnessRunResult,
    conversationId: string,
    targetConversationSlot = conversationSlot,
    ignoredAuditIds: string[] = [],
  ) => {
    setRunSnapshot(result.snapshot);
    setRunFinalMessage(result.finalMessage ?? null);
    setRunError(null);
    if (result.pendingInvocation) {
      setPendingInvocations((current) =>
        appendPendingInvocations(current, {
          conversationId,
          conversationSlot: targetConversationSlot,
          invocations: [result.pendingInvocation!],
        }),
      );
    }
    if (
      aiAgentRunResultChangesRemoteHostTree({
        ignoredAuditIds,
        result,
      })
    ) {
      await onRemoteHostCreated?.();
    }
  };

  const removePendingInvocationsForRun = (runId: string) => {
    setPendingInvocations((current) =>
      current.filter((item) => item.invocation.runId !== runId),
    );
  };

  const refreshAiPanel = () => {
    void loadContext();
    void loadProviders();
    void loadAudits();
  };

  const loadPendingRunSnapshot = async (runId: string) => {
    try {
      const snapshot = await getAiAgentRun({ runId });
      setRunSnapshot(snapshot);
      setRunFinalMessage(null);
      setRunError(null);
    } catch (nextError) {
      setRunError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const cancelVisibleRun = async () => {
    const runId = runSnapshot?.run.id ?? pendingInvocation?.runId;
    if (!runId) {
      return;
    }

    setRunActionState("cancelling");
    setRunError(null);
    try {
      const snapshot = await cancelAiAgentRun({ runId });
      setRunSnapshot(snapshot);
      setRunFinalMessage(null);
      removePendingInvocationsForRun(runId);
    } catch (nextError) {
      setRunError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRunActionState("idle");
    }
  };

  const retryVisibleRunLastStep = async () => {
    const sourceSnapshot = runSnapshot;
    const conversation = activeConversation;
    if (!sourceSnapshot || !conversation) {
      return;
    }

    setRunActionState("retrying");
    setRunError(null);
    try {
      removePendingInvocationsForRun(sourceSnapshot.run.id);
      const result = await retryAiAgentRunLastStep({
        runId: sourceSnapshot.run.id,
      });
      await applyAgentRunResult(result, conversation.id);
    } catch (nextError) {
      setRunError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setRunActionState("idle");
    }
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
  const selectStoredConversation = async (conversationId: string, historyRow?: AiConversationHistoryRow) => {
    const routeSelection = historyRow
      ? resolveAiConversationRouteSelection(historyRow, conversationSlot)
      : { focusTabId: undefined, shouldActivateCurrentSlot: true };
    if (!routeSelection.focusTabId && !routeSelection.shouldActivateCurrentSlot) {
      setChatError("该历史会话绑定到其它主机或面板，请先切换到对应目标后继续。");
      setHistoryOpen(false);
      return;
    }
    try {
      const storedConversation = await getStoredConversationRecord(conversationId);
      setConversationState((current) => mergeStoredConversationIntoState(current, storedConversation));
      if (routeSelection.focusTabId) {
        onFocusTab?.(routeSelection.focusTabId);
      }
      if (routeSelection.shouldActivateCurrentSlot) {
        await activateStoredConversationSlot(conversationId, conversationSlot).catch(() => null);
      }
      setChatError(null);
      setHistoryOpen(false);
    } catch (nextError) {
      setChatError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const selectConversation = (conversationId: string, historyRow?: AiConversationHistoryRow) => {
    if (conversationPersistenceEnabled) {
      void selectStoredConversation(conversationId, historyRow);
      return;
    }

    setConversationState((current) => ({
      ...current,
      activeConversationId: conversationId,
    }));
    setChatError(null);
    setHistoryOpen(false);
  };
  const startStoredConversation = async () => {
    try {
      const storedConversation =
        await createAndActivateStoredConversation(conversationSlot);
      setConversationState((current) =>
        mergeStoredConversationIntoState(current, storedConversation),
      );
      setChatError(null);
      setHistoryOpen(false);
    } catch (nextError) {
      setChatError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const startNewConversation = () => {
    if (conversationPersistenceEnabled) {
      void startStoredConversation();
      return;
    }

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
        conversations: limitConversations([
          conversation,
          ...current.conversations,
        ]),
      };
    });
    setChatError(null);
    setHistoryOpen(false);
  };

  const deleteConversation = (conversationId: string) => {
    if (conversationPersistenceEnabled) {
      void deleteStoredConversationRecord(conversationId).catch(() => null);
    }

    setConversationState((current) => {
      const remaining = limitConversations(
        current.conversations.filter(
          (conversation) => conversation.id !== conversationId,
        ),
      );
      const conversations =
        remaining.length > 0 ? remaining : [createConversation()];
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

  const openAttachmentPreview = (attachment: AiChatAttachment) => {
    setPreviewAttachment(attachment);
  };

  const openAuditContext = async (request: AiAuditContextOpenRequest) => {
    const snapshotId = request.target === "contextSnapshot" ? request.context.contextSnapshotId?.trim() : null;
    if (snapshotId) {
      setSnapshotDetailId(snapshotId);
      setAuditOpen(false);
      setHistoryOpen(false);
      setChatError(null);
      setToolInvocationError(null);
    }

    try {
      const conversationId = await resolveAuditContextConversationId(request);
      const openedConversation = await loadConversationForAuditContext(conversationId);
      const messageId = resolveAuditContextMessageId(openedConversation, request);

      if (!snapshotId) {
        setAuditOpen(false);
        setHistoryOpen(false);
      }
      setChatError(null);
      setToolInvocationError(null);
      setHighlightedMessageId(messageId);

      if (request.target === "attachments") {
        const attachment = findAuditContextAttachment(
          openedConversation,
          request.attachmentIds ?? request.context.attachmentIds,
        );
        if (attachment) {
          setPreviewAttachment(attachment);
        } else {
          setChatError("已打开相关会话，但没有找到审计关联的附件。");
        }
      }
    } catch (nextError) {
      setToolInvocationError(
        `${snapshotId ? "已打开快照详情，但无法恢复关联会话" : "无法打开审计上下文"}：${
          nextError instanceof Error ? nextError.message : String(nextError)
        }`,
      );
    }
  };

  const loadConversationForAuditContext = async (conversationId: string) => {
    if (conversationPersistenceEnabled) {
      const storedConversation = await getStoredConversationRecord(conversationId);
      await activateStoredConversationSlot(conversationId, conversationSlot).catch(() => null);
      setConversationState((current) => mergeStoredConversationIntoState(current, storedConversation));
      return conversationFromStoredConversation(storedConversation);
    }

    const localConversation = conversationState.conversations.find((conversation) => conversation.id === conversationId);
    if (!localConversation) {
      throw new Error(`AI 会话不存在: ${conversationId}`);
    }
    setConversationState((current) => ({ ...current, activeConversationId: conversationId }));
    return localConversation;
  };

  const resolvePendingInvocation = async (approved: boolean) => {
    if (!pendingInvocationItem) {
      return;
    }

    setToolInvocationState("confirming");
    setToolInvocationError(null);
    try {
      const pendingConversation = conversationState.conversations.find(
        (conversation) => conversation.id === pendingInvocationItem.conversationId,
      );
      const auditContext = buildAiToolAuditContext({
        conversation: pendingConversation,
        conversationSlot: pendingInvocationItem.conversationSlot,
        invocationId: pendingInvocationItem.invocation.id,
      });
      const audit = await resolveAiToolInvocation({
        approved,
        auditContext,
        handlers: {
          onCreateTerminal,
          onFocusTab,
          onOpenTool,
          onOpenSshTerminal,
          onRemoteHostCreated,
          onSplitPane,
        },
        invocation: pendingInvocationItem.invocation,
      });
      setPendingInvocations((current) =>
        removePendingInvocation(current, pendingInvocationItem.invocation.id),
      );
      setToolAudits((current) =>
        [audit, ...current.filter((item) => item.id !== audit.id)].slice(
          0,
          AUDIT_PANEL_LIMIT,
        ),
      );
      setAuditMessage(null);
      if (pendingInvocationItem.invocation.runId) {
        const resumeResult = await resumeAiAgentRun({
          audit,
          runId: pendingInvocationItem.invocation.runId,
        });
        await applyAgentRunResult(
          resumeResult,
          pendingInvocationItem.conversationId,
          pendingInvocationItem.conversationSlot,
          [audit.id],
        );
      }
    } catch (nextError) {
      setToolInvocationError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setToolInvocationState("idle");
    }
  };

  useAutoResolvePendingInvocation({
    autoResolvedInvocationIdsRef,
    pendingInvocation,
    resolvePendingInvocation,
    toolInvocationState,
  });

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
    <section className="kerminal-terminal-surface flex h-full min-h-0 flex-col text-zinc-950 dark:text-zinc-50">
      <AiToolContentHeader
        activeConversation={activeConversation}
        auditActionState={auditActionState}
        auditClearRequested={auditClearRequested}
        auditMessage={auditMessage}
        auditOpen={auditOpen}
        commandVisibility={commandVisibility}
        conversationSlot={conversationSlot}
        contextError={contextError}
        contextSnapshot={contextSnapshot}
        contextState={contextState}
        historyOpen={historyOpen}
        newConversationDisabled={newConversationDisabled}
        onCancelClearAudits={() => setAuditClearRequested(false)}
        onCommandVisibilityChange={setCommandVisibility}
        onConfirmClearAudits={() => void handleConfirmClearAudits()}
        onExportAudits={() => void handleExportAudits()}
        onOpenAiSettings={openAiSettings}
        onOpenAuditContext={(request) => void openAuditContext(request)}
        onRefreshAuditList={() => void refreshAuditList()}
        onRequestClearAudits={() => setAuditClearRequested(true)}
        onStartNewConversation={startNewConversation}
        onToggleAudit={toggleAudit}
        onToggleHistory={toggleHistory}
        settingsDisabled={!onOpenSettingsSection && !onOpenTool}
        terminalSessionReady={!terminalContextBlocked}
        toolAudits={toolAudits}
      />

      <AssistantRuntimeProvider runtime={assistantRuntime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <AiThreadViewport
            activeConversation={activeConversation}
            highlightedMessageId={highlightedMessageId}
            onOpenAttachment={openAttachmentPreview}
          />

          <AiToolContentComposer
            activeConversation={activeConversation}
            attachmentDropActive={attachmentDropActive}
            attachmentDropZoneRef={attachmentDropZoneRef}
            chatError={chatError}
            importingAttachment={importingAttachment}
            onAddImage={() => void addLocalImageAttachment()}
            onApproveInvocation={() => void resolvePendingInvocation(true)}
            onCancelRun={() => void cancelVisibleRun()}
            onAttachmentDragLeave={handleAttachmentDragLeave}
            onAttachmentDragOver={handleAttachmentDragOver}
            onAttachmentDrop={handleAttachmentDrop}
            onAttachmentPaste={handleAttachmentPaste}
            onCommandApprovalPolicyChange={onSettingsChange ? updateCommandApprovalPolicy : undefined}
            onOpenAiSettings={onOpenSettingsSection || onOpenTool ? openAiSettings : undefined}
            onOpenAttachment={openAttachmentPreview}
            onProviderChange={setSelectedProviderId}
            onRejectInvocation={() => void resolvePendingInvocation(false)}
            onRemoveAttachment={removePendingAttachment}
            onRetryRun={() => void retryVisibleRunLastStep()}
            onSendImageOnly={() => void submitAssistantMessage("")}
            pendingAttachments={pendingAttachments}
            pendingInvocation={pendingInvocation}
            providerError={providerError}
            providerState={providerState}
            providers={selectableProviders}
            selectedProviderId={selectedProvider?.id ?? ""}
            sending={sending}
            settings={normalizedSettings}
            runActionState={runActionState}
            runError={runError}
            runFinalMessage={runFinalMessage}
            runSnapshot={runSnapshot}
            toolInvocationError={toolInvocationError}
            toolInvocationState={toolInvocationState}
          />
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
      <AiAttachmentPreviewDialog
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        onError={setChatError}
      />
      <AiContextSnapshotDetailDialog
        onClose={() => setSnapshotDetailId(null)}
        onError={setChatError}
        snapshotId={snapshotDetailId}
      />
      <AiConversationHistoryDialog
        activeConversationId={conversationState.activeConversationId}
        canFilterCurrentHost={historyList.canFilterCurrentHost}
        canNextPage={historyList.canNextPage}
        canPreviousPage={historyList.canPreviousPage}
        currentSlot={conversationSlot}
        error={historyList.error}
        filter={historyList.filter}
        loading={historyList.loading}
        onClose={() => setHistoryOpen(false)}
        onDelete={(conversationId) => {
          deleteConversation(conversationId);
          historyList.removeConversationFromHistory(conversationId);
        }}
        onFilterChange={historyList.setFilter}
        onNextPage={() => historyList.setPage((current) => current + 1)}
        onPreviousPage={() => historyList.setPage((current) => Math.max(1, current - 1))}
        onQueryChange={setHistoryQuery}
        onSelect={selectConversation}
        open={historyOpen}
        page={historyList.page}
        query={historyQuery}
        rows={historyList.rows}
        usingRemoteRows={historyList.usingRemoteRows}
      />
    </section>
  );
}
