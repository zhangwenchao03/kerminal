import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { closeTerminal, getTerminalLogState, listTerminalSessions, resizeTerminal, type TerminalOutputEvent } from "../../lib/terminalApi";
import { closeExternalSshLaunch } from "../../lib/externalLaunchApi";
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
import { terminalRendererFallbackReasonFromState } from "./terminalGpuRenderRecoveryRuntime";
import { createTerminalRendererController } from "./terminalRenderer";
import { resolveRuntimeTerminalRendererFeatureGates } from "./terminalRendererFeatureGates";
import {
  createTerminalRendererHealthWatchdog,
  type TerminalRendererHealthWatchdog,
} from "./terminalRendererHealthWatchdog";
import { createTerminalRendererPerformanceTelemetry } from "./terminalRendererPerformanceTelemetry";
import { terminalRendererRegistry } from "./terminalRendererRegistry";
import { createTerminalSessionResizeCoordinator } from "./terminalSessionResizeCoordinator";
import {
  createTerminalRendererSurfaceCoordinator,
  type TerminalRendererSurfaceCoordinator,
} from "./terminalRendererSurfaceCoordinator";
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
import { createInitialRemoteOutputGate } from "./terminalInitialRemoteOutputGate";
const ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS = 1_000,
  TERMINAL_SESSION_STATUS_POLL_MS = 2_000;
const TERMINAL_RENDERER_FEATURE_GATES =
  resolveRuntimeTerminalRendererFeatureGates();
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
    terminalRef,
    terminalRendererControllerRef,
    terminalRuntimeLifecycleControllerRef,
    terminalRuntimeLifecycleRef,
    terminalSurfaceCoordinatorRef,
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
  let devicePixelRatioMediaQuery: MediaQueryList | null = null;
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
  let rendererSurfaceCoordinator: TerminalRendererSurfaceCoordinator | null =
    null;
  let rendererHealthWatchdog: TerminalRendererHealthWatchdog | null = null;

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  const terminalInlineSshAuthPrompt = createTerminalInlineSshAuthPrompt({
    markUserInteraction: () => terminalRuntimeLifecycleControllerRef?.current?.markUserInteraction(),
    terminal,
  });
  const compositionTarget = container.querySelector(".xterm") ?? container;
  terminal.open(container);
  // 会话创建需要首个 cols/rows；后续所有 surface 变化统一交给 coordinator。
  fitAddon.fit();
  let lastReportedSurfaceDimensions = {
    cols: terminal.cols,
    rows: terminal.rows,
  };
  let reuseInitialSurfaceDimensions = true;
  onTerminalDimensionsChangeRef.current?.(lastReportedSurfaceDimensions);
  const sessionResizeCoordinator = createTerminalSessionResizeCoordinator({
    resize: resizeTerminal,
  });
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
  const rendererTelemetry = createTerminalRendererPerformanceTelemetry();
  const terminalRendererController = createTerminalRendererController({
    compatibilityGate: {
      forceContextLoss:
        TERMINAL_RENDERER_FEATURE_GATES.privateCleanupCompat,
      privateRendererCleanup:
        TERMINAL_RENDERER_FEATURE_GATES.privateCleanupCompat,
    },
    healthWatchdogEnabled: TERMINAL_RENDERER_FEATURE_GATES.healthWatchdog,
    lifecycleV2Enabled: TERMINAL_RENDERER_FEATURE_GATES.lifecycleV2,
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
        rendererSurfaceCoordinator?.invalidate();
      }
    },
    paneId,
    rendererType: terminalAppearance.rendererType,
    telemetry: TERMINAL_RENDERER_FEATURE_GATES.performanceTelemetry
      ? rendererTelemetry
      : undefined,
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
  const outputWriter = createTerminalOutputWriter(terminal, {
    adaptive: TERMINAL_RENDERER_FEATURE_GATES.adaptiveOutputScheduler,
    callbackMode: "auto",
    cadence:
      visibleRef?.current === false
        ? "hidden"
        : focusedRef.current
          ? "focused"
          : "visible",
    telemetry: TERMINAL_RENDERER_FEATURE_GATES.performanceTelemetry
      ? rendererTelemetry
      : undefined,
  });
  outputWriter.writeNow(outputHistoryRef.current ?? "");
  const outputHistoryBuffer = createTerminalOutputHistoryBuffer({
    flushDelayMs: () => terminalRuntimeLifecycleRef?.current?.outputHistoryFlushIntervalMs ?? 100,
    onOutputHistoryChangeRef,
    outputHistoryRef,
  });
  const sshFailureTracker = createSshTerminalFailureTracker();
  rendererSurfaceCoordinator = createTerminalRendererSurfaceCoordinator({
    fit: () => {
      if (reuseInitialSurfaceDimensions) {
        return lastReportedSurfaceDimensions;
      }
      fitAddon.fit();
      return { cols: terminal.cols, rows: terminal.rows };
    },
    measure: () => {
      const rect = container.getBoundingClientRect();
      const visible =
        visibleRef?.current !== false &&
        document.visibilityState !== "hidden" &&
        container.isConnected;
      return {
        dpr:
          typeof window.devicePixelRatio === "number"
            ? window.devicePixelRatio
            : 1,
        height: rect.height,
        minimized: !visible || rect.width <= 0 || rect.height <= 0,
        visible,
        width: rect.width,
      };
    },
    onDimensionsChange: (dimensions) => {
      if (
        dimensions.cols === lastReportedSurfaceDimensions.cols &&
        dimensions.rows === lastReportedSurfaceDimensions.rows
      ) {
        return;
      }
      lastReportedSurfaceDimensions = dimensions;
      onTerminalDimensionsChangeRef.current?.(dimensions);
      sessionResizeCoordinator.request(dimensions);
      ghostSuggestions.refreshGhostSuggestionLayout();
    },
    onStableSurface: () => {
      terminalRendererRegistry.updatePaneVisibility(paneId, true);
      terminalRendererController.resume();
      terminalRendererController.attach();
      terminalRuntimeLifecycleControllerRef?.current?.markVisibleRecoveryComplete();
      rendererHealthWatchdog?.check();
    },
  });
  rendererHealthWatchdog = TERMINAL_RENDERER_FEATURE_GATES.healthWatchdog
    ? createTerminalRendererHealthWatchdog({
        container,
        renderer: terminalRendererController,
        surfaceSnapshot: () => rendererSurfaceCoordinator?.getSnapshot(),
      })
    : null;
  if (terminalSurfaceCoordinatorRef) {
    terminalSurfaceCoordinatorRef.current = (invalidate = false) => {
      if (invalidate) {
        rendererSurfaceCoordinator?.invalidate();
        return;
      }
      rendererSurfaceCoordinator?.notify();
    };
  }
  const fitAndResize = () => rendererSurfaceCoordinator?.notify();
  const handleDocumentVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      terminalRendererController.suspend();
      terminalRendererRegistry.updatePaneVisibility(paneId, false);
      rendererSurfaceCoordinator?.notify();
      return;
    }
    rendererSurfaceCoordinator?.invalidate();
  };
  const handleWindowSurfaceChange = () =>
    rendererSurfaceCoordinator?.invalidate();
  const bindDevicePixelRatioListener = () => {
    devicePixelRatioMediaQuery?.removeEventListener(
      "change",
      handleDevicePixelRatioChange,
    );
    devicePixelRatioMediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        : null;
    devicePixelRatioMediaQuery?.addEventListener(
      "change",
      handleDevicePixelRatioChange,
    );
  };
  function handleDevicePixelRatioChange() {
    bindDevicePixelRatioListener();
    rendererSurfaceCoordinator?.invalidate();
  }
  rendererSurfaceCoordinator.flush();
  reuseInitialSurfaceDimensions = false;
  const clearSessionState = (sessionId: string) => {
    if (sessionIdRef.current === sessionId) {
      sessionIdRef.current = null;
    }
    sessionResizeCoordinator.clearSession(sessionId);
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
  const externalLaunchId = remoteHostId?.startsWith("external:")
    ? remoteHostId.slice("external:".length)
    : null;
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
    const initialRemoteOutputGate = createInitialRemoteOutputGate(sessionStartedAtMs);

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
          if (
            hasRemoteTerminalTarget() &&
            initialRemoteOutputGate.shouldWriteNow(event.data)
          ) {
            outputWriter.writeNow(event.data);
            return;
          }
          outputWriter.setCadence(
            visibleRef?.current === false
              ? "hidden"
              : focusedRef.current
                ? "focused"
                : "visible",
          );
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
      const requestedDimensions = {
        cols: terminal.cols,
        rows: terminal.rows,
      };
      const session = await createXtermPaneTerminalSession({
        args,
        cols: requestedDimensions.cols,
        currentCwd: currentCwdRef.current,
        cwd,
        env,
        onOutput: handleOutput,
        promptForSecret: terminalInlineSshAuthPrompt.promptForSecret,
        remoteCommand,
        remoteHostId,
        rows: requestedDimensions.rows,
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
      sessionResizeCoordinator.bindSession(session.id, requestedDimensions);
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
      sessionResizeCoordinator.request(lastReportedSurfaceDimensions);
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
  document.addEventListener(
    "visibilitychange",
    handleDocumentVisibilityChange,
  );
  window.addEventListener("resize", handleWindowSurfaceChange);
  bindDevicePixelRatioListener();
  return () => {
    disposed = true;
    sessionRun += 1;
    resizeObserver?.disconnect();
    document.removeEventListener(
      "visibilitychange",
      handleDocumentVisibilityChange,
    );
    window.removeEventListener("resize", handleWindowSurfaceChange);
    devicePixelRatioMediaQuery?.removeEventListener(
      "change",
      handleDevicePixelRatioChange,
    );
    devicePixelRatioMediaQuery = null;
    rendererHealthWatchdog?.dispose();
    rendererHealthWatchdog = null;
    rendererSurfaceCoordinator?.dispose();
    rendererSurfaceCoordinator = null;
    if (terminalSurfaceCoordinatorRef?.current) {
      terminalSurfaceCoordinatorRef.current = null;
    }
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
    sessionResizeCoordinator.dispose();
    shellIntegrationCommandBlockProtocolRef.current = false;
    commandBlockRuntime.resetProtocolState();
    reconnectSessionRef.current = null;
    disconnectSessionRef.current = null;
    if (sessionId) {
      unregisterTerminalPaneSession(paneId, sessionId);
    }
    if (externalLaunchId) {
      const closeSession = sessionId
        ? closeTerminal(sessionId).catch(() => undefined)
        : Promise.resolve();
      void closeSession.finally(() =>
        closeExternalSshLaunch(externalLaunchId).catch(() => undefined),
      );
    } else if (sessionId) {
      void closeTerminal(sessionId);
    }
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
