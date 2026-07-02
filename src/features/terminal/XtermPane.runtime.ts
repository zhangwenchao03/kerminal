import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { closeTerminal, createDockerContainerTerminalSession, createSerialTerminalSession, createSshTerminalSession, createTelnetTerminalSession, createTerminalSession, getTerminalLogState, listTerminalSessions, resizeTerminal, writeTerminal } from "../../lib/terminalApi";
import type { TerminalOutputEvent } from "../../lib/terminalApi";
import { recordCommandHistory } from "../../lib/commandHistoryApi";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import { markTerminalPaneSessionDisconnected, markTerminalPaneSessionReconnected, registerTerminalPaneSession, updateTerminalPaneRuntimeContext, updateTerminalPaneSessionCwd, unregisterTerminalPaneSession } from "./terminalSessionRegistry";
import { createTerminalOutputWriter } from "./terminalOutputWriter";
import { createXtermPaneCommandBlockRuntime } from "./XtermPane.commandBlockRuntime";
import { createXtermPaneGhostSuggestions } from "./XtermPane.ghostSuggestions";
import { applyTerminalInputData, createTerminalInputModelState, updateTerminalInputBufferKind, updateTerminalInputComposition } from "./terminalInputModel";
import { terminalSuggestionProbeScheduler } from "./terminalSuggestionProbeScheduler";
import { createTerminalRemoteSuggestionPrewarm } from "./terminalRemoteSuggestionPrewarm";
import { createTerminalOutputHistoryBuffer } from "./terminalOutputHistoryBuffer";
import { refreshTerminalRendererDimensions } from "./terminalRendererDimensions";
import { createTerminalRendererController } from "./terminalRenderer";
import { terminalRendererRegistry } from "./terminalRendererRegistry";
import { createTerminalOutputInstrumentation, runTerminalOutputInstrumentationStep } from "./terminalOutputInstrumentation";
import { buildTerminalCreateRequest, collectCurrentDirOscSequences, errorMessage, isRightArrowInput, normalizeTerminalSessionSize } from "./XtermPane.helpers";
import { registerCommandBlockClearHandlers, terminalSessionFailureLabel, terminalSessionTargetKind } from "./XtermPane.runtime.helpers";
import { installShellIntegrationOscHandlers, isClearScreenCommand } from "./XtermPane.shellIntegration";
import { KITTY_KEYBOARD_PROTOCOL_ENABLE, resolveTerminalInputCompatibilityOverride, resolveTerminalRuntimeKeydownOverride, shouldEnableKittyKeyboardProtocol } from "./terminalKeyboardPolicy";
import { createTerminalShellIntegrationState, reduceTerminalShellIntegrationState } from "./terminalShellIntegrationModel";
import { createSshTerminalFailureTracker, formatSshTerminalFailureMessage } from "./terminalSshFailurePolicy";
import { createTerminalReconnectRuntime } from "./terminalReconnectRuntime";
import { registerTerminalRuntimeDiagnosticsPane } from "./terminalRuntimeDiagnosticsStore";
const ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS = 1_000;
const INITIAL_REMOTE_OUTPUT_IMMEDIATE_WRITE_MS = 8_000;
const TERMINAL_SESSION_STATUS_POLL_MS = 2_000;
export function installXtermPaneRuntime(params: any) {
  const { args, commandBlockCounterRef, commandBlocksRef, containerRef, cwd, cwdTrackingBufferRef, currentCwdRef, disconnectSessionRef, env, fitAddonRef, focusedRef, ghostSuggestionRef, inputBufferRef, inputModelRef, onAgentSignalRef, onCurrentCwdChangeRef, onOutputHistoryChangeRef, onSessionFinishedRef, onTerminalDimensionsChangeRef, outputHistoryRef, paneId, profileId, promptLineRef, reconnectSessionRef, remoteCommand, remoteHostId, remoteHostProduction, searchAddonRef, sessionIdRef, setCommandBlockNotice, setCommandBlockViews, setConnectionState, setGhostSuggestion, setLogNotice, setLogState, setSearchResults, shellIntegrationCommandBlockProtocolRef, shell, shellAssistEnabled = true, startupMessage, syncCommandBlockViews, target, terminalAppearance, terminalAppearanceRef, terminalFontWeight, terminalRef, terminalRendererControllerRef, terminalRuntimeLifecycleControllerRef, terminalRuntimeLifecycleRef, terminalTheme, transientStartupMessage, visibleRef } = params;
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    let disposed = false;
    let sessionStatusPollTimer: number | null = null;
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
    const reduceShellIntegrationRuntimeState = (
      event: Parameters<typeof reduceTerminalShellIntegrationState>[1],
    ) => {
      shellIntegrationState = reduceTerminalShellIntegrationState(
        shellIntegrationState,
        event,
      );
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
      isDisposed: () => disposed,
      paneId,
      profileId,
      remoteHostId,
      remoteHostProduction,
      scheduleCommandBlockViewSync: commandBlockRuntime.scheduleCommandBlockViewSync,
      sessionIdRef,
      setGhostSuggestion,
      shell,
      target,
      terminal,
      terminalAppearanceRef,
    });
    const shouldPreserveCommandBlockForOriginEraseBelow = () => {
      if (!assistEnabled) {
        return false;
      }
      const block = commandBlocksRef.current[commandBlocksRef.current.length - 1];
      if (!block || block.endMarker || isClearScreenCommand(block.command)) {
        return false;
      }
      return (
        Date.now() - block.createdAt <=
        ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS
      );
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
    const updateCurrentCwdFromTerminal = (
      nextCwd: string,
      options: { prewarmRemoteSuggestions: boolean },
    ) => {
      if (nextCwd === currentCwdRef.current) {
        return;
      }
      currentCwdRef.current = nextCwd;
      updateTerminalPaneSessionCwd(paneId, nextCwd);
      onCurrentCwdChangeRef.current?.(nextCwd);
      if (!assistEnabled || !options.prewarmRemoteSuggestions) {
        return;
      }
      runTerminalOutputInstrumentationStep(
        terminalOutputInstrumentation,
        "remotePrewarmGit",
        nextCwd.length,
        () => remoteSuggestionPrewarm.scheduleGit(nextCwd),
      );
      runTerminalOutputInstrumentationStep(
        terminalOutputInstrumentation,
        "remotePrewarmPath",
        nextCwd.length,
        () => remoteSuggestionPrewarm.scheduleRemotePath(nextCwd),
      );
    };
    const shellIntegrationOscDisposables = installShellIntegrationOscHandlers(
      terminal,
      {
        onCurrentCwd: (nextCwd) =>
          updateCurrentCwdFromTerminal(nextCwd, {
            prewarmRemoteSuggestions: false,
          }),
        reduceState: (event) => {
          shellIntegrationState = reduceTerminalShellIntegrationState(
            shellIntegrationState,
            event,
          );
        },
        readState: () => shellIntegrationState,
        writeState: (nextState) => {
          shellIntegrationState = nextState;
        },
        onOsc133: (event) =>
          commandBlockRuntime.handleShellIntegrationOsc133(event, "parser"),
      },
    );
    const inputDisposable = terminal.onData((data) => {
      terminalRuntimeLifecycleControllerRef?.current?.markUserInteraction();
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      if (
        isRightArrowInput(data) &&
        ghostSuggestions.acceptGhostSuggestion(sessionId)
      ) {
        return;
      }
      const collected = applyTerminalInputData(inputModelRef.current, data);
      inputModelRef.current = updateTerminalInputBufferKind(
        collected.state,
        terminal.buffer.active.type,
      );
      shellIntegrationState = reduceTerminalShellIntegrationState(
        shellIntegrationState,
        { data, type: "input" },
      );
      inputBufferRef.current = inputModelRef.current.command;
      for (const command of collected.commands) {
        const dismissedSuggestion = ghostSuggestionRef.current;
        ghostSuggestions.clearGhostSuggestion();
        if (
          assistEnabled &&
          shellIntegrationCommandBlockProtocolRef.current &&
          shellIntegrationState.trusted
        ) {
          commandBlockRuntime.setPendingProtocolCommand(command);
        } else {
          commandBlockRuntime.registerCommandBlock(command);
        }
        if (!command) {
          continue;
        }
        if (assistEnabled) {
          if (
            dismissedSuggestion &&
            dismissedSuggestion.candidate.replacementText !== command
          ) {
            ghostSuggestions.recordGhostSuggestionFeedback(
              "dismissed",
              dismissedSuggestion,
              command,
            );
          }
          const commandCwd = currentCwdRef.current ?? cwd;
          const containerHostId =
            target?.kind === "dockerContainer" ? target.hostId : undefined;
          const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
          const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
          const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
          const historyRemoteHostId =
            containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
          const historyTarget = containerHostId
            ? "dockerContainer"
            : telnetHostId
              ? "telnet"
              : serialHostId
                ? "serial"
              : sshHostId
                ? "ssh"
                : "local";
          void recordCommandHistory({
            command,
            cwd: commandCwd,
            paneId,
            profileId,
            remoteHostId: historyRemoteHostId,
            sessionId,
            shell,
            source: "user",
            target: historyTarget,
          });
        }
      }
      void writeTerminal(sessionId, data);
      if (collected.commands.length === 0) {
        commandBlockRuntime.scheduleCommandBlockViewSync();
        ghostSuggestions.scheduleGhostSuggestion();
      }
    });
    terminal.attachCustomKeyEventHandler((event) => {
      const compatibilityOverride = resolveTerminalInputCompatibilityOverride(
        event,
        inputCompatibilityMode,
      );
      if (compatibilityOverride) {
        event.preventDefault();
        event.stopPropagation();
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          terminalRuntimeLifecycleControllerRef?.current?.markUserInteraction();
          shellIntegrationState = reduceTerminalShellIntegrationState(
            shellIntegrationState,
            { data: compatibilityOverride.data, type: "input" },
          );
          void writeTerminal(sessionId, compatibilityOverride.data);
        }
        return false;
      }
      return true;
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection?.() ?? "";
      updateTerminalPaneRuntimeContext(paneId, { selectedText: selection });
      if (!terminalAppearanceRef.current.selectionCopy) {
        return;
      }
      if (selection) {
        void writeDesktopClipboardText(selection);
      }
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    const searchResultDisposable = searchAddon.onDidChangeResults((event) => {
      setSearchResults({
        hasSearched: true,
        resultCount: event.resultCount,
        resultIndex: event.resultIndex,
      });
    });
    const scrollDisposable = terminal.onScroll(() => {
      commandBlockRuntime.scheduleCommandBlockViewSync();
      ghostSuggestions.refreshGhostSuggestionLayout();
    });
    const writeParsedDisposable = terminal.onWriteParsed(() => {
      commandBlockRuntime.clearCommandBlockViewSyncFrame();
      syncCommandBlockViews();
      commandBlockRuntime.syncCommandBlockRuntimeContext();
      ghostSuggestions.refreshGhostSuggestionLayout();
    });
    const bufferChangeDisposable = terminal.buffer.onBufferChange(() => {
      const nextBufferType = terminal.buffer.active.type;
      shellIntegrationState = reduceTerminalShellIntegrationState(
        shellIntegrationState,
        {
          bufferType: nextBufferType === "alternate" ? "alternate" : "normal",
          type: "buffer",
        },
      );
      if (nextBufferType === "alternate") {
        commandBlockRuntime.closeCurrentCommandBlock();
      }
      inputModelRef.current = updateTerminalInputBufferKind(
        inputModelRef.current,
        nextBufferType,
      );
      inputBufferRef.current = inputModelRef.current.command;
      if (nextBufferType === "alternate") {
        ghostSuggestions.clearGhostSuggestion();
      } else {
        ghostSuggestions.refreshGhostSuggestionLayout();
      }
      commandBlockRuntime.scheduleCommandBlockViewSync();
    });
    const xtermElement = container.querySelector(".xterm");
    const compositionTarget = xtermElement ?? container;
    const handleCompositionStart = () => {
      inputModelRef.current = updateTerminalInputComposition(
        inputModelRef.current,
        true,
      );
      inputBufferRef.current = inputModelRef.current.command;
      ghostSuggestions.clearGhostSuggestion();
    };
    const handleCompositionEnd = () => {
      inputModelRef.current = updateTerminalInputComposition(
        inputModelRef.current,
        false,
      );
      inputBufferRef.current = inputModelRef.current.command;
      ghostSuggestions.scheduleGhostSuggestion();
    };
    compositionTarget.addEventListener(
      "compositionstart",
      handleCompositionStart,
    );
    compositionTarget.addEventListener("compositionend", handleCompositionEnd);
    terminal.open(container);
    terminalRef.current = terminal;
    let rendererBackend = "cpu";
    const terminalRendererController = createTerminalRendererController({
      onStateChange: (state) => {
        terminalRendererRegistry.updatePaneState(paneId, state);
        if (state.backend !== rendererBackend) {
          rendererBackend = state.backend;
          refreshTerminalRendererDimensions({ fitAddon, onDimensionsChange: onTerminalDimensionsChangeRef.current, resizeTerminal, sessionId: sessionIdRef.current, terminal });
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
    if (shouldEnableKittyKeyboardProtocol(inputCompatibilityMode)) {
      terminal.write(KITTY_KEYBOARD_PROTOCOL_ENABLE);
    }
    let suppressNextPasteEvent = false;
    let suppressPasteResetTimer: number | null = null;
    const clearRuntimePasteSuppression = () => {
      suppressNextPasteEvent = false;
      if (suppressPasteResetTimer !== null) {
        window.clearTimeout(suppressPasteResetTimer);
        suppressPasteResetTimer = null;
      }
    };
    const armRuntimePasteSuppression = () => {
      clearRuntimePasteSuppression();
      suppressNextPasteEvent = true;
      suppressPasteResetTimer = window.setTimeout(() => {
        suppressNextPasteEvent = false;
        suppressPasteResetTimer = null;
      }, 500);
    };
    const handleRuntimeKeydown = (event: KeyboardEvent) => {
      const runtimeOverride = resolveTerminalRuntimeKeydownOverride(event);
      if (!runtimeOverride) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (runtimeOverride.suppressPasteEvent) {
        armRuntimePasteSuppression();
      }
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        shellIntegrationState = reduceTerminalShellIntegrationState(
          shellIntegrationState,
          { data: runtimeOverride.data, type: "input" },
        );
        void writeTerminal(sessionId, runtimeOverride.data);
      }
    };
    const handleRuntimePaste = (event: ClipboardEvent) => {
      if (!suppressNextPasteEvent) {
        return;
      }

      clearRuntimePasteSuppression();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    container.addEventListener("keydown", handleRuntimeKeydown, true);
    container.addEventListener("paste", handleRuntimePaste, true);
    const commandBlockClearHandlersDisposable = registerCommandBlockClearHandlers(
      terminal,
      commandBlockRuntime.clearCommandBlocks,
      {
        shouldPreserveOriginEraseBelow:
          shouldPreserveCommandBlockForOriginEraseBelow,
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
    const fitAndResize = () => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      const dimensions = { cols: terminal.cols, rows: terminal.rows };
      onTerminalDimensionsChangeRef.current?.(dimensions);
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
    const isSshTerminalTarget = () =>
      Boolean(remoteHostId && target?.kind !== "dockerContainer" && target?.kind !== "telnet" && target?.kind !== "serial");
    const reconnectRuntime = createTerminalReconnectRuntime({
      isSshTerminalTarget,
      outputWriter,
      readAutoReconnect: () => terminalAppearanceRef.current.autoReconnect,
      sshFailureTracker,
      startSession: () => void startSession("reconnect"),
      window,
    });
    const unregisterRuntimeDiagnostics = registerTerminalRuntimeDiagnosticsPane({
      getSnapshot: () => ({ focused: focusedRef.current, historyStats: outputHistoryBuffer.stats(), paneId, runtimeWorkMode: terminalRuntimeLifecycleRef?.current?.workMode ?? "full", sessionId: sessionIdRef.current ?? undefined, sshFailure: isSshTerminalTarget() ? sshFailureTracker.current() : undefined, sshReconnect: reconnectRuntime.diagnosticsSnapshot(), sshTarget: isSshTerminalTarget(), visible: visibleRef?.current ?? true, writerStats: outputWriter.stats() }),
    });
    const hasRemoteTerminalTarget = () =>
      Boolean(
        remoteHostId ||
          target?.kind === "dockerContainer" ||
          target?.kind === "telnet" ||
          target?.kind === "serial",
      );
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
          outputWriter.writeNow(
            `\r\n关闭终端会话失败：${errorMessage(error)}\r\n`,
          );
          setConnectionState("error");
        }
        return false;
      }
    };

    const finishSessionClosed = (
      sessionId: string,
      sessionStartedAtMs: number,
      currentRun: number,
      message = "\r\n会话已结束。\r\n",
    ) => {
      if (
        disposed ||
        sessionRun !== currentRun ||
        sessionIdRef.current !== sessionId
      ) {
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
      outputWriter.writeNow(
        isSshTerminalTarget()
          ? formatSshTerminalFailureMessage(sshFailureTracker.current(), message)
          : message,
      );
      setConnectionState("closed");
      reconnectRuntime.scheduleReconnect();
    };

    const scheduleSessionStatusPoll = (
      sessionId: string,
      sessionStartedAtMs: number,
      currentRun: number,
    ) => {
      clearSessionStatusPollTimer();
      sessionStatusPollTimer = window.setTimeout(() => {
        sessionStatusPollTimer = null;
        if (
          disposed ||
          sessionRun !== currentRun ||
          sessionIdRef.current !== sessionId
        ) {
          return;
        }
        void listTerminalSessions()
          .then((sessions) => {
            if (
              disposed ||
              sessionRun !== currentRun ||
              sessionIdRef.current !== sessionId
            ) {
              return;
            }
            const session = sessions.find(
              (candidate) => candidate.id === sessionId,
            );
            if (!session || session.status === "exited") {
              finishSessionClosed(
                sessionId,
                sessionStartedAtMs,
                currentRun,
                "\r\n会话已退出，可通过右键菜单重新连接。\r\n",
              );
              return;
            }
            scheduleSessionStatusPoll(sessionId, sessionStartedAtMs, currentRun);
          })
          .catch(() => {
            if (
              !disposed &&
              sessionRun === currentRun &&
              sessionIdRef.current === sessionId
            ) {
              scheduleSessionStatusPoll(
                sessionId,
                sessionStartedAtMs,
                currentRun,
              );
            }
          });
      }, TERMINAL_SESSION_STATUS_POLL_MS);
    };

    const startSession = async (reason: "initial" | "reconnect") => {
      const currentRun = ++sessionRun;
      const closed = await closeActiveSession();
      if (!closed || disposed || sessionRun !== currentRun) {
        return;
      }

      setConnectionState("connecting");
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
      transientStartupNoticeVisible =
        reason === "initial" &&
        startupNotice.trim().length > 0 &&
        (transientStartupMessage || hasRemoteTerminalTarget());
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
          if (isSshTerminalTarget()) {
            sshFailureTracker.append(event.data);
          }
          if (transientStartupNoticeVisible) {
            outputWriter.writeNow("\x1b[1A\x1b[2K\r");
            transientStartupNoticeVisible = false;
          }
          if (remoteHostId || target?.kind === "dockerContainer") {
            const tracked = runTerminalOutputInstrumentationStep(
              terminalOutputInstrumentation,
              "cwdOsc",
              event.data.length,
              () =>
                collectCurrentDirOscSequences(
                  cwdTrackingBufferRef.current,
                  event.data,
                ),
            );
            cwdTrackingBufferRef.current = tracked.buffer;
            for (const nextCwd of tracked.paths) {
              updateCurrentCwdFromTerminal(nextCwd, {
                prewarmRemoteSuggestions: true,
              });
            }
          }
          if (assistEnabled) {
            runTerminalOutputInstrumentationStep(
              terminalOutputInstrumentation,
              "commandBlock",
              event.data.length,
              () =>
                commandBlockRuntime.appendShellIntegrationCommandOutput(
                  event.data,
                ),
            );
          }
          runTerminalOutputInstrumentationStep(
            terminalOutputInstrumentation,
            "writer",
            event.data.length,
            () => {
              const initialRemoteOutput =
                hasRemoteTerminalTarget() &&
                Date.now() - sessionStartedAtMs <=
                  INITIAL_REMOTE_OUTPUT_IMMEDIATE_WRITE_MS;
              if (initialRemoteOutput) {
                outputWriter.writeNow(event.data);
                return;
              }
              outputWriter.write(event.data);
            },
          );
          runTerminalOutputInstrumentationStep(
            terminalOutputInstrumentation,
            "history",
            event.data.length,
            () => outputHistoryBuffer.append(event.data),
          );
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
        const sessionSize = normalizeTerminalSessionSize({
          cols: terminal.cols,
          rows: terminal.rows,
        });
        const session =
          target?.kind === "dockerContainer"
            ? await createDockerContainerTerminalSession(
                {
                  cols: sessionSize.cols,
                  containerId: target.containerId,
                  hostId: target.hostId,
                  rows: sessionSize.rows,
                  runtime: target.runtime,
                  shell,
                  user: target.user,
                  workdir: target.workdir,
                },
                handleOutput,
              )
            : target?.kind === "telnet"
              ? await createTelnetTerminalSession(
                  {
                    cols: sessionSize.cols,
                    hostId: target.hostId,
                    rows: sessionSize.rows,
                  },
                  handleOutput,
                )
              : target?.kind === "serial"
                ? await createSerialTerminalSession(
                    {
                      cols: sessionSize.cols,
                      hostId: target.hostId,
                      rows: sessionSize.rows,
                    },
                    handleOutput,
                  )
            : remoteHostId
              ? await createSshTerminalSession(
                  {
                    cols: sessionSize.cols,
                    ...(currentCwdRef.current ?? cwd
                      ? { cwd: currentCwdRef.current ?? cwd }
                      : {}),
                    hostId: remoteHostId,
                    ...(remoteCommand ? { remoteCommand } : {}),
                    rows: sessionSize.rows,
                  },
                  handleOutput,
                )
              : await createTerminalSession(
                  buildTerminalCreateRequest({
                    args,
                    cols: sessionSize.cols,
                    cwd,
                    env,
                    rows: sessionSize.rows,
                    shell,
                  }),
                  handleOutput,
                );

        if (disposed || sessionRun !== currentRun) {
          void closeTerminal(session.id);
          return;
        }
        const shellIntegrationTrusted =
          !hasRemoteTerminalTarget() &&
          session.shellIntegration?.status === "enabled";
        shellIntegrationState = reduceTerminalShellIntegrationState(
          shellIntegrationState,
          {
            trusted: shellIntegrationTrusted,
            type: "session",
          },
        );
        shellIntegrationCommandBlockProtocolRef.current =
          assistEnabled && shellIntegrationTrusted;
        sessionIdRef.current = session.id;
        registerTerminalPaneSession(paneId, session.id, {
          containerId:
            target?.kind === "dockerContainer" ? target.containerId : undefined,
          containerRuntime:
            target?.kind === "dockerContainer"
              ? (target.runtime ?? "docker")
              : undefined,
          cwd: currentCwdRef.current ?? cwd,
          profileId,
          remoteHostId:
            target?.kind === "dockerContainer" ||
            target?.kind === "telnet" ||
            target?.kind === "serial"
              ? target.hostId
              : remoteHostId,
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
            if (
              !disposed &&
              sessionRun === currentRun &&
              sessionIdRef.current === session.id
            ) {
              setLogState(nextState);
            }
          })
          .catch(() => {
            if (
              !disposed &&
              sessionRun === currentRun &&
              sessionIdRef.current === session.id
            ) {
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
        outputWriter.writeNow(
          `\r\n${terminalSessionFailureLabel(target, remoteHostId)}：${errorMessage(error)}\r\n`,
        );
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
        outputWriter.writeNow(
          "\r\n当前没有活动会话，可通过右键菜单重新连接。\r\n",
        );
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
      commandBlockRuntime.clearCommandBlockViewSyncFrame();
      outputHistoryBuffer.dispose();
      unregisterRuntimeDiagnostics();
      inputDisposable.dispose();
      selectionDisposable.dispose();
      searchResultDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      bufferChangeDisposable.dispose();
      compositionTarget.removeEventListener(
        "compositionstart",
        handleCompositionStart,
      );
      compositionTarget.removeEventListener(
        "compositionend",
        handleCompositionEnd,
      );
      container.removeEventListener("keydown", handleRuntimeKeydown, true);
      container.removeEventListener("paste", handleRuntimePaste, true);
      clearRuntimePasteSuppression();
      for (const disposable of shellIntegrationOscDisposables) {
        disposable.dispose();
      }
      commandBlockClearHandlersDisposable.dispose();
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
      unregisterTerminalRenderer();
      if (terminalRendererControllerRef.current === terminalRendererController) {
        terminalRendererControllerRef.current = null;
      }
      outputWriter.dispose();
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
