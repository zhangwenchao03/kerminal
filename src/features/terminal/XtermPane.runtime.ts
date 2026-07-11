import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { closeTerminal, getTerminalLogState, listTerminalSessions, resizeTerminal, type TerminalOutputEvent } from "../../lib/terminalApi";
import {
  markTerminalPaneSessionDisconnected,
  markTerminalPaneSessionReconnected,
  registerTerminalPaneSession,
  updateTerminalPaneSessionCwd,
  unregisterTerminalPaneSession,
} from "./terminalSessionRegistry";
import { createTerminalOutputWriter } from "./terminalOutputWriter";
import { createXtermPaneCommandBlockRuntime } from "./XtermPane.commandBlockRuntime";
import { createXtermPaneGhostSuggestions } from "./XtermPane.ghostSuggestions";
import { createTerminalInlineSshAuthPrompt } from "./XtermPane.inlineSshAuthPrompt";
import { createXtermPaneTerminalSession } from "./XtermPane.sessionFactory";
import { createTerminalInputModelState } from "./terminalInputModel";
import { terminalSuggestionProbeScheduler } from "./terminalSuggestionProbeScheduler";
import { createTerminalRemoteSuggestionPrewarm } from "./terminalRemoteSuggestionPrewarm";
import { createTerminalOutputHistoryBuffer } from "./terminalOutputHistoryBuffer";
import { createTerminalGpuRenderRecoveryRuntime, terminalRendererFallbackReasonFromState, type TerminalGpuRenderRecoveryController } from "./terminalGpuRenderRecoveryRuntime";
import { refreshTerminalRendererDimensions } from "./terminalRendererDimensions";
import { createTerminalRendererController } from "./terminalRenderer";
import { terminalRendererRegistry } from "./terminalRendererRegistry";
import type { TerminalRendererFallbackReason } from "./terminalRendererPolicy";
import { createTerminalOutputInstrumentation, runTerminalOutputInstrumentationStep } from "./terminalOutputInstrumentation";
import { collectCurrentDirOscSequences, errorMessage } from "./XtermPane.helpers";
import { registerCommandBlockClearHandlers, terminalSessionFailureLabel, terminalSessionTargetKind } from "./XtermPane.runtime.helpers";
import { installShellIntegrationOscHandlers, isClearScreenCommand } from "./XtermPane.shellIntegration";
import { KITTY_KEYBOARD_PROTOCOL_ENABLE, shouldEnableKittyKeyboardProtocol } from "./terminalKeyboardPolicy";
import { createTerminalShellIntegrationState, reduceTerminalShellIntegrationState } from "./terminalShellIntegrationModel";
import { createSshTerminalFailureTracker, formatSshTerminalFailureMessage } from "./terminalSshFailurePolicy";
import { createTerminalReconnectRuntime } from "./terminalReconnectRuntime";
import { registerTerminalRuntimeDiagnosticsPane } from "./terminalRuntimeDiagnosticsStore";
import { createXtermPaneActivityRuntime } from "./XtermPane.activityRuntime";
import { registerXtermPaneRuntimeEvents } from "./XtermPane.runtime.events";
import { createXtermPaneArtifactRuntime } from "./XtermPane.artifacts";
const ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS = 1_000,
  INITIAL_REMOTE_OUTPUT_IMMEDIATE_WRITE_MS = 8_000,
  TERMINAL_SESSION_STATUS_POLL_MS = 2_000;
export function installXtermPaneRuntime(params: any) {
  const {
    activityRuntimeRef,
    args,
    commandBlockCounterRef,
    commandBlocksRef,
    containerRef,
    cwd,
    cwdTrackingBufferRef,
    currentCwdRef,
    disconnectSessionRef,
    env,
    fitAddonRef,
    focusedRef,
    ghostSuggestionRef,
    inputBufferRef,
    inputModelRef,
    onAgentSignalRef,
    onCurrentCwdChangeRef,
    onOutputHistoryChangeRef,
    onSessionFinishedRef,
    onTerminalDimensionsChangeRef,
    outputHistoryRef,
    paneId,
    profileId,
    promptLineRef,
    reconnectSessionRef,
    remoteCommand,
    remoteHostId,
    remoteHostProduction,
    searchAddonRef,
    sessionIdRef,
    setCommandBlockNotice,
    setCommandBlockViews,
    setConnectionState,
    setGhostSuggestion,
    setLogNotice,
    setLogState,
    setSearchResults,
    setSuggestionMenu,
    shellIntegrationCommandBlockProtocolRef,
    shell,
    shellAssistEnabled = true,
    startupMessage,
    suggestionMenuIntentRef,
    syncCommandBlockViews,
    target,
    terminalAppearance,
    terminalAppearanceRef,
    terminalFontWeight,
    terminalGpuRenderRecoveryControllerRef,
    terminalRef,
    terminalRendererControllerRef,
    terminalRuntimeLifecycleControllerRef,
    terminalRuntimeLifecycleRef,
    terminalTheme,
    transientStartupMessage,
    visibleRef,
  } = params;
  const container = containerRef.current;
  if (!container) {
    return undefined;
  }
  let disposed = false,
    sessionStatusPollTimer: number | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let sessionRun = 0;
  let shellIntegrationState = createTerminalShellIntegrationState();
  const assistEnabled = shellAssistEnabled !== false;
  const inputCompatibilityMode = params.inputCompatibilityMode === "agentTui" ? "agentTui" : "shell";
  commandBlocksRef.current = [];
  inputModelRef.current = createTerminalInputModelState();
  setCommandBlockViews([]);
  setCommandBlockNotice(null);
  setGhostSuggestion(null);
  setSuggestionMenu(null);
  const terminal = new XtermTerminal({
    cols: 80,
    cursorBlink: terminalAppearance.cursorBlink,
    cursorInactiveStyle: "outline",
    cursorStyle: terminalAppearance.cursorStyle,
    fontFamily: terminalAppearance.fontFamily,
    fontSize: terminalAppearance.fontSize,
    fontWeight: terminalFontWeight,
    fontWeightBold: 700,
    lineHeight: terminalAppearance.lineHeight,
    macOptionIsMeta: terminalAppearance.macOptionIsMeta,
    minimumContrastRatio: 4.5,
    rows: 24,
    scrollback: terminalAppearance.scrollback,
    theme: terminalTheme,
  });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon({ highlightLimit: 1000 });
  fitAddonRef.current = fitAddon;
  searchAddonRef.current = searchAddon;
  const reduceShellIntegrationRuntimeState = (event: Parameters<typeof reduceTerminalShellIntegrationState>[1]) => {
    shellIntegrationState = reduceTerminalShellIntegrationState(shellIntegrationState, event);
    return shellIntegrationState;
  };
  const commandBlockRuntime = createXtermPaneCommandBlockRuntime({
    assistEnabled,
    commandBlockCounterRef,
    commandBlocksRef,
    isDisposed: () => disposed,
    paneId,
    promptLineRef,
    readCurrentCommand: () => inputModelRef.current.command,
    readShellIntegrationState: () => shellIntegrationState,
    reduceShellIntegrationState: reduceShellIntegrationRuntimeState,
    setCommandBlockNotice,
    setCommandBlockViews,
    shellIntegrationCommandBlockProtocolRef,
    syncCommandBlockViews,
    terminal,
  });
  const artifactRuntime = createXtermPaneArtifactRuntime({
    paneId,
    profileId,
    remoteHostId,
    target,
  });
  const canScheduleSuggestionProbe = () => terminalRuntimeLifecycleRef?.current?.shouldRunSuggestionProbe !== false;
  const ghostSuggestions = createXtermPaneGhostSuggestions({
    assistEnabled,
    canScheduleSuggestion: canScheduleSuggestionProbe,
    container,
    currentCwdRef,
    cwd,
    ghostSuggestionRef,
    inputBufferRef,
    inputModelRef,
    inputCompatibilityMode,
    isDisposed: () => disposed,
    paneId,
    profileId,
    remoteHostId,
    remoteHostProduction,
    scheduleCommandBlockViewSync: commandBlockRuntime.scheduleCommandBlockViewSync,
    sessionIdRef,
    setGhostSuggestion,
    setSuggestionMenu,
    shell,
    target,
    terminal,
    terminalAppearanceRef,
  });
  suggestionMenuIntentRef.current = (intent: any) => (sessionIdRef.current ? ghostSuggestions.handleMenuIntent(intent, sessionIdRef.current) : false);
  const shouldPreserveCommandBlockForOriginEraseBelow = () => {
    if (!assistEnabled) {
      return false;
    }
    const block = commandBlocksRef.current[commandBlocksRef.current.length - 1];
    if (!block || block.endMarker || isClearScreenCommand(block.command)) {
      return false;
    }
    return Date.now() - block.createdAt <= ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS;
  };
  const remoteSuggestionPrewarm = createTerminalRemoteSuggestionPrewarm({
    canScheduleProbe: canScheduleSuggestionProbe,
    paneId,
    remoteHostId,
    remoteHostProduction,
    target,
    terminalAppearanceRef,
  });
  const terminalOutputInstrumentation = createTerminalOutputInstrumentation({
    paneId,
  });
  const updateCurrentCwdFromTerminal = (nextCwd: string, options: { prewarmRemoteSuggestions: boolean }) => {
    if (nextCwd === currentCwdRef.current) {
      return;
    }
    currentCwdRef.current = nextCwd;
    updateTerminalPaneSessionCwd(paneId, nextCwd);
    onCurrentCwdChangeRef.current?.(nextCwd);
    if (!assistEnabled || !options.prewarmRemoteSuggestions) {
      return;
    }
    runTerminalOutputInstrumentationStep(terminalOutputInstrumentation, "remotePrewarmGit", nextCwd.length, () => remoteSuggestionPrewarm.scheduleGit(nextCwd));
    runTerminalOutputInstrumentationStep(terminalOutputInstrumentation, "remotePrewarmPath", nextCwd.length, () => remoteSuggestionPrewarm.scheduleRemotePath(nextCwd));
  };
  const shellIntegrationOscDisposables = installShellIntegrationOscHandlers(terminal, {
    reduceState: (event) => {
      shellIntegrationState = reduceTerminalShellIntegrationState(shellIntegrationState, event);
    },
    readState: () => shellIntegrationState,
    writeState: (nextState) => {
      shellIntegrationState = nextState;
    },
    onOsc133: (event) => commandBlockRuntime.handleShellIntegrationOsc133(event, "parser"),
    onCurrentCwd: (nextCwd) =>
      updateCurrentCwdFromTerminal(nextCwd, {
        prewarmRemoteSuggestions: false,
      }),
  });
  let gpuRenderRecoveryController: TerminalGpuRenderRecoveryController | null = null;

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  const terminalInlineSshAuthPrompt = createTerminalInlineSshAuthPrompt({
    markUserInteraction: () => terminalRuntimeLifecycleControllerRef?.current?.markUserInteraction(),
    terminal,
  });
  const compositionTarget = container.querySelector(".xterm") ?? container;
  terminal.open(container);
  terminalRef.current = terminal;
  const activityRuntime = createXtermPaneActivityRuntime({
    connectionState: "connecting",
    container,
    paneId,
    terminal,
    visible: visibleRef?.current ?? true,
  });
  activityRuntimeRef.current = activityRuntime;
  let rendererBackend = "cpu";
  let lastRecordedRendererFallbackReason: TerminalRendererFallbackReason | undefined;
  const terminalRendererController = createTerminalRendererController({
    onStateChange: (state) => {
      terminalRendererRegistry.updatePaneState(paneId, state);
      const fallbackReason = terminalRendererFallbackReasonFromState(state.fallbackReason);
      if (fallbackReason && fallbackReason !== lastRecordedRendererFallbackReason) {
        lastRecordedRendererFallbackReason = fallbackReason;
        terminalRendererRegistry.recordPaneFailure(paneId, fallbackReason);
      } else if (!fallbackReason) {
        lastRecordedRendererFallbackReason = undefined;
      }
      if (state.backend !== rendererBackend) {
        rendererBackend = state.backend;
        refreshTerminalRendererDimensions({
          fitAddon,
          onDimensionsChange: onTerminalDimensionsChangeRef.current,
          resizeTerminal,
          sessionId: sessionIdRef.current,
          terminal,
        });
        gpuRenderRecoveryController?.trigger(state.backend === "gpu" ? "renderer-attached" : "renderer-disposed");
      }
    },
    paneId,
    rendererType: terminalAppearance.rendererType,
    terminal,
  });
  terminalRendererControllerRef.current = terminalRendererController;
  terminalRendererRegistry.updateMode(terminalAppearance.rendererType);
  const unregisterTerminalRenderer = terminalRendererRegistry.registerPane({
    controller: terminalRendererController,
    focused: focusedRef.current,
    paneId,
    visible: visibleRef?.current ?? true,
  });
  gpuRenderRecoveryController = createTerminalGpuRenderRecoveryRuntime({
    paneId,
    renderer: terminalRendererController,
    terminal,
  });
  terminalGpuRenderRecoveryControllerRef.current = gpuRenderRecoveryController;
  if (shouldEnableKittyKeyboardProtocol(inputCompatibilityMode)) {
    terminal.write(KITTY_KEYBOARD_PROTOCOL_ENABLE);
  }
  const runtimeEvents = registerXtermPaneRuntimeEvents({
    activityRuntimeRef,
    assistEnabled,
    commandBlockRuntime,
    compositionTarget,
    container,
    currentCwdRef,
    cwd,
    getGpuRenderRecoveryController: () => gpuRenderRecoveryController,
    ghostSuggestions,
    ghostSuggestionRef,
    inputBufferRef,
    inputCompatibilityMode,
    inputModelRef,
    paneId,
    profileId,
    readShellIntegrationState: () => shellIntegrationState,
    remoteHostId,
    searchAddon,
    sessionIdRef,
    setSearchResults,
    shell,
    shellIntegrationCommandBlockProtocolRef,
    syncCommandBlockViews,
    target,
    terminal,
    terminalAppearanceRef,
    terminalInlineSshAuthPrompt,
    terminalRuntimeLifecycleControllerRef,
    writeShellIntegrationState: (nextState) => {
      shellIntegrationState = nextState;
    },
    onArtifactCommandBlock: (id, command) => artifactRuntime.queueCommandBlock(id, command),
    onArtifactInvalidate: (reason) => artifactRuntime.invalidate(reason),
  });
  const commandBlockClearHandlersDisposable = registerCommandBlockClearHandlers(
    terminal,
    () => {
      commandBlockRuntime.clearCommandBlocks();
      artifactRuntime.invalidate("clear");
    },
    {
      shouldPreserveOriginEraseBelow: shouldPreserveCommandBlockForOriginEraseBelow,
    },
  );
  const outputWriter = createTerminalOutputWriter(terminal);
  outputWriter.writeNow(outputHistoryRef.current ?? "");
  const outputHistoryBuffer = createTerminalOutputHistoryBuffer({
    flushDelayMs: () => terminalRuntimeLifecycleRef?.current?.outputHistoryFlushIntervalMs ?? 100,
    onOutputHistoryChangeRef,
    outputHistoryRef,
  });
  const sshFailureTracker = createSshTerminalFailureTracker();
  let lastDevicePixelRatio = typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1;
  const fitAndResize = () => {
    fitAddon.fit();
    const sessionId = sessionIdRef.current;
    const dimensions = { cols: terminal.cols, rows: terminal.rows };
    onTerminalDimensionsChangeRef.current?.(dimensions);
    const nextDevicePixelRatio = typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1;
    gpuRenderRecoveryController?.trigger(nextDevicePixelRatio !== lastDevicePixelRatio ? "device-pixel-ratio-changed" : "resize");
    lastDevicePixelRatio = nextDevicePixelRatio;
    if (!sessionId) {
      return;
    }
    void resizeTerminal(sessionId, dimensions);
    ghostSuggestions.refreshGhostSuggestionLayout();
  };
  const clearSessionState = (sessionId: string) => {
    if (sessionIdRef.current === sessionId) {
      sessionIdRef.current = null;
    }
    unregisterTerminalPaneSession(paneId, sessionId);
    shellIntegrationState = createTerminalShellIntegrationState();
    shellIntegrationCommandBlockProtocolRef.current = false;
    commandBlockRuntime.resetProtocolState();
    setLogState({ active: false, bytesWritten: 0 });
  };
  const clearSessionStatusPollTimer = () => {
    if (sessionStatusPollTimer !== null) {
      window.clearTimeout(sessionStatusPollTimer);
      sessionStatusPollTimer = null;
    }
  };
  const isSshTerminalTarget = () => Boolean(remoteHostId && target?.kind !== "dockerContainer" && target?.kind !== "telnet" && target?.kind !== "serial");
  const reconnectRuntime = createTerminalReconnectRuntime({
    isSshTerminalTarget,
    outputWriter,
    readAutoReconnect: () => terminalAppearanceRef.current.autoReconnect,
    sshFailureTracker,
    startSession: () => void startSession("reconnect"),
    window,
  });
  const unregisterRuntimeDiagnostics = registerTerminalRuntimeDiagnosticsPane({
    getSnapshot: () => ({
      focused: focusedRef.current,
      historyStats: outputHistoryBuffer.stats(),
      paneId,
      runtimeWorkMode: terminalRuntimeLifecycleRef?.current?.workMode ?? "full",
      sessionId: sessionIdRef.current ?? undefined,
      sshFailure: isSshTerminalTarget() ? sshFailureTracker.current() : undefined,
      sshReconnect: reconnectRuntime.diagnosticsSnapshot(),
      sshTarget: isSshTerminalTarget(),
      visible: visibleRef?.current ?? true,
      writerStats: outputWriter.stats(),
    }),
  });
  const hasRemoteTerminalTarget = () => Boolean(remoteHostId || target?.kind === "dockerContainer" || target?.kind === "telnet" || target?.kind === "serial");
  let transientStartupNoticeVisible = false;
  const startupNoticeFor = (reason: "initial" | "reconnect") => {
    if (reason === "reconnect") {
      return "\r\n正在重新连接...\r\n";
    }
    if (typeof startupMessage === "string") {
      return startupMessage;
    }
    return target?.kind === "dockerContainer"
      ? "正在进入容器...\r\n"
      : target?.kind === "telnet"
        ? "正在连接 Telnet 主机...\r\n"
        : target?.kind === "serial"
          ? "正在连接 Serial 设备...\r\n"
          : remoteHostId
            ? "正在连接 SSH 主机...\r\n"
            : "正在启动本地终端...\r\n";
  };

  const closeActiveSession = async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return true;
    }

    clearSessionStatusPollTimer();
    clearSessionState(sessionId);
    try {
      await closeTerminal(sessionId);
      return true;
    } catch (error: unknown) {
      if (!disposed) {
        outputWriter.writeNow(`\r\n关闭终端会话失败：${errorMessage(error)}\r\n`);
        setConnectionState("error");
      }
      return false;
    }
  };

  const finishSessionClosed = (sessionId: string, sessionStartedAtMs: number, currentRun: number, message = "\r\n会话已结束。\r\n") => {
    if (disposed || sessionRun !== currentRun || sessionIdRef.current !== sessionId) {
      return;
    }
    clearSessionStatusPollTimer();
    ghostSuggestions.clearGhostSuggestion();
    markTerminalPaneSessionDisconnected(paneId, sessionId);
    clearSessionState(sessionId);
    onSessionFinishedRef?.current?.({
      durationMs: Math.max(0, Date.now() - sessionStartedAtMs),
      reason: "closed",
      sessionId,
    });
    outputWriter.writeNow(isSshTerminalTarget() ? formatSshTerminalFailureMessage(sshFailureTracker.current(), message) : message);
    setConnectionState("closed");
    reconnectRuntime.scheduleReconnect();
  };

  const scheduleSessionStatusPoll = (sessionId: string, sessionStartedAtMs: number, currentRun: number) => {
    clearSessionStatusPollTimer();
    sessionStatusPollTimer = window.setTimeout(() => {
      sessionStatusPollTimer = null;
      if (disposed || sessionRun !== currentRun || sessionIdRef.current !== sessionId) {
        return;
      }
      void listTerminalSessions()
        .then((sessions) => {
          if (disposed || sessionRun !== currentRun || sessionIdRef.current !== sessionId) {
            return;
          }
          const session = sessions.find((candidate) => candidate.id === sessionId);
          if (!session || session.status === "exited") {
            finishSessionClosed(sessionId, sessionStartedAtMs, currentRun, "\r\n会话已退出，可通过右键菜单重新连接。\r\n");
            return;
          }
          scheduleSessionStatusPoll(sessionId, sessionStartedAtMs, currentRun);
        })
        .catch(() => {
          if (!disposed && sessionRun === currentRun && sessionIdRef.current === sessionId) {
            scheduleSessionStatusPoll(sessionId, sessionStartedAtMs, currentRun);
          }
        });
    }, TERMINAL_SESSION_STATUS_POLL_MS);
  };

  const startSession = async (reason: "initial" | "reconnect") => {
    const currentRun = ++sessionRun;
    artifactRuntime.invalidate("restart");
    const closed = await closeActiveSession();
    if (!closed || disposed || sessionRun !== currentRun) {
      return;
    }

    setConnectionState(reason === "reconnect" ? "reconnecting" : "connecting");
    terminalSuggestionProbeScheduler.cancelOwner(paneId);
    setLogNotice(null);
    inputBufferRef.current = "";
    inputModelRef.current = createTerminalInputModelState();
    cwdTrackingBufferRef.current = "";
    shellIntegrationState = createTerminalShellIntegrationState();
    shellIntegrationCommandBlockProtocolRef.current = false;
    commandBlockRuntime.resetProtocolState();
    ghostSuggestions.clearGhostSuggestion();
    sshFailureTracker.reset();
    const startupNotice = startupNoticeFor(reason);
    transientStartupNoticeVisible = reason === "initial" && startupNotice.trim().length > 0 && (transientStartupMessage || hasRemoteTerminalTarget());
    outputWriter.writeNow(startupNotice);
    const sessionStartedAtMs = Date.now();

    const handleOutput = (event: TerminalOutputEvent) => {
      if (disposed || sessionRun !== currentRun) {
        return;
      }

      if (event.kind === "agentSignal") {
        if (event.agentSignal) {
          onAgentSignalRef?.current?.(event.agentSignal);
        }
        return;
      }

      if (event.kind === "data") {
        artifactRuntime.queueOutput(event.data);
        activityRuntime.markOutput();
        if (isSshTerminalTarget()) {
          sshFailureTracker.append(event.data);
        }
        if (transientStartupNoticeVisible) {
          outputWriter.writeNow("\x1b[1A\x1b[2K\r");
          transientStartupNoticeVisible = false;
        }
        if (remoteHostId || target?.kind === "dockerContainer") {
          const tracked = runTerminalOutputInstrumentationStep(terminalOutputInstrumentation, "cwdOsc", event.data.length, () =>
            collectCurrentDirOscSequences(cwdTrackingBufferRef.current, event.data),
          );
          cwdTrackingBufferRef.current = tracked.buffer;
          for (const nextCwd of tracked.paths) {
            updateCurrentCwdFromTerminal(nextCwd, {
              prewarmRemoteSuggestions: true,
            });
          }
        }
        if (assistEnabled) {
          runTerminalOutputInstrumentationStep(terminalOutputInstrumentation, "commandBlock", event.data.length, () => commandBlockRuntime.appendShellIntegrationCommandOutput(event.data));
        }
        runTerminalOutputInstrumentationStep(terminalOutputInstrumentation, "writer", event.data.length, () => {
          const initialRemoteOutput = hasRemoteTerminalTarget() && Date.now() - sessionStartedAtMs <= INITIAL_REMOTE_OUTPUT_IMMEDIATE_WRITE_MS;
          if (initialRemoteOutput) {
            outputWriter.writeNow(event.data);
            return;
          }
          outputWriter.write(event.data);
        });
        runTerminalOutputInstrumentationStep(terminalOutputInstrumentation, "history", event.data.length, () => outputHistoryBuffer.append(event.data));
        return;
      }
      if (event.kind === "closed") {
        finishSessionClosed(event.sessionId, sessionStartedAtMs, currentRun);
        return;
      }
      ghostSuggestions.clearGhostSuggestion();
      clearSessionStatusPollTimer();
      markTerminalPaneSessionDisconnected(paneId, event.sessionId);
      outputWriter.writeNow(`\r\n终端输出读取失败：${event.data}\r\n`);
      setConnectionState("error");
      reconnectRuntime.scheduleReconnect();
    };

    try {
      const session = await createXtermPaneTerminalSession({
        args,
        cols: terminal.cols,
        currentCwd: currentCwdRef.current,
        cwd,
        env,
        onOutput: handleOutput,
        promptForSecret: terminalInlineSshAuthPrompt.promptForSecret,
        remoteCommand,
        remoteHostId,
        rows: terminal.rows,
        shell,
        target,
      });

      if (disposed || sessionRun !== currentRun) {
        void closeTerminal(session.id);
        return;
      }
      const shellIntegrationTrusted = !hasRemoteTerminalTarget() && session.shellIntegration?.status === "enabled";
      shellIntegrationState = reduceTerminalShellIntegrationState(shellIntegrationState, {
        trusted: shellIntegrationTrusted,
        type: "session",
      });
      shellIntegrationCommandBlockProtocolRef.current = assistEnabled && shellIntegrationTrusted;
      sessionIdRef.current = session.id;
      registerTerminalPaneSession(paneId, session.id, {
        containerId: target?.kind === "dockerContainer" ? target.containerId : undefined,
        containerRuntime: target?.kind === "dockerContainer" ? (target.runtime ?? "docker") : undefined,
        cwd: currentCwdRef.current ?? cwd,
        profileId,
        remoteHostId: target?.kind === "dockerContainer" || target?.kind === "telnet" || target?.kind === "serial" ? target.hostId : remoteHostId,
        shell,
        target: terminalSessionTargetKind(target, remoteHostId),
        targetRef: session.targetRef,
        targetToken: session.targetToken,
      });
      if (reason === "reconnect") {
        markTerminalPaneSessionReconnected(paneId, session.id);
      }
      setConnectionState("connected");
      reconnectRuntime.resetSshReconnectAttempts();
      scheduleSessionStatusPoll(session.id, sessionStartedAtMs, currentRun);
      if (assistEnabled) {
        remoteSuggestionPrewarm.scheduleGit(currentCwdRef.current ?? cwd);
        remoteSuggestionPrewarm.scheduleRemoteCommand();
        remoteSuggestionPrewarm.scheduleRemoteHistory();
        remoteSuggestionPrewarm.scheduleRemotePath(currentCwdRef.current ?? cwd);
      }
      void getTerminalLogState(session.id)
        .then((nextState) => {
          if (!disposed && sessionRun === currentRun && sessionIdRef.current === session.id) {
            setLogState(nextState);
          }
        })
        .catch(() => {
          if (!disposed && sessionRun === currentRun && sessionIdRef.current === session.id) {
            setLogState({ active: false, bytesWritten: 0 });
          }
        });
      fitAndResize();
      if (focusedRef.current) {
        terminal.focus();
      }
    } catch (error: unknown) {
      if (disposed || sessionRun !== currentRun) {
        return;
      }
      outputWriter.writeNow(`\r\n${terminalSessionFailureLabel(target, remoteHostId)}：${errorMessage(error)}\r\n`);
      setConnectionState("error");
    }
  };

  const disconnectSession = async () => {
    const currentRun = ++sessionRun;
    reconnectRuntime.clearReconnectTimer();
    clearSessionStatusPollTimer();
    terminalSuggestionProbeScheduler.cancelOwner(paneId);
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setConnectionState("disconnected");
      outputWriter.writeNow("\r\n当前没有活动会话，可通过右键菜单重新连接。\r\n");
      return;
    }

    markTerminalPaneSessionDisconnected(paneId, sessionId);
    clearSessionState(sessionId);
    setLogNotice(null);
    inputBufferRef.current = "";
    inputModelRef.current = createTerminalInputModelState();
    cwdTrackingBufferRef.current = "";
    ghostSuggestions.clearGhostSuggestion();
    try {
      await closeTerminal(sessionId);
      if (disposed || sessionRun !== currentRun) {
        return;
      }
      setConnectionState("disconnected");
      outputWriter.writeNow("\r\n连接已断开，可通过右键菜单重新连接。\r\n");
    } catch (error: unknown) {
      if (disposed || sessionRun !== currentRun) {
        return;
      }
      outputWriter.writeNow(`\r\n断开连接失败：${errorMessage(error)}\r\n`);
      setConnectionState("error");
    }
  };
  reconnectSessionRef.current = () => startSession("reconnect");
  disconnectSessionRef.current = disconnectSession;
  void startSession("initial");
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);
  }
  return () => {
    disposed = true;
    sessionRun += 1;
    resizeObserver?.disconnect();
    reconnectRuntime.clearReconnectTimer();
    clearSessionStatusPollTimer();
    terminalSuggestionProbeScheduler.cancelOwner(paneId);
    ghostSuggestions.dispose();
    suggestionMenuIntentRef.current = null;
    commandBlockRuntime.clearCommandBlockViewSyncFrame();
    artifactRuntime.close();
    outputHistoryBuffer.dispose();
    unregisterRuntimeDiagnostics();
    runtimeEvents.dispose();
    for (const disposable of shellIntegrationOscDisposables) {
      disposable.dispose();
    }
    commandBlockClearHandlersDisposable.dispose();
    terminalInlineSshAuthPrompt.finish(null);
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    shellIntegrationCommandBlockProtocolRef.current = false;
    commandBlockRuntime.resetProtocolState();
    reconnectSessionRef.current = null;
    disconnectSessionRef.current = null;
    if (sessionId) {
      unregisterTerminalPaneSession(paneId, sessionId);
      void closeTerminal(sessionId);
    }
    gpuRenderRecoveryController?.dispose();
    if (terminalGpuRenderRecoveryControllerRef.current === gpuRenderRecoveryController) terminalGpuRenderRecoveryControllerRef.current = null;
    unregisterTerminalRenderer();
    if (terminalRendererControllerRef.current === terminalRendererController) {
      terminalRendererControllerRef.current = null;
    }
    outputWriter.dispose();
    activityRuntime.dispose();
    if (activityRuntimeRef.current === activityRuntime) {
      activityRuntimeRef.current = null;
    }
    terminal.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    searchAddonRef.current = null;
    cwdTrackingBufferRef.current = "";
    ghostSuggestionRef.current = null;
    setGhostSuggestion(null);
    setLogState({ active: false, bytesWritten: 0 });
    setLogNotice(null);
  };
}
