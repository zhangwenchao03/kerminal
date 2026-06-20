import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { closeTerminal, createDockerContainerTerminalSession, createSerialTerminalSession, createSshTerminalSession, createTelnetTerminalSession, createTerminalSession, getTerminalLogState, resizeTerminal, writeTerminal } from "../../lib/terminalApi";
import type { TerminalOutputEvent } from "../../lib/terminalApi";
import { recordCommandHistory } from "../../lib/commandHistoryApi";
import { listTerminalSuggestions, recordTerminalSuggestionAuditEvent, recordTerminalSuggestionFeedback } from "../../lib/terminalSuggestionApi";
import type { CommandSuggestionProvider } from "../../lib/terminalSuggestionApi";
import type { TerminalAppearance } from "../settings/settingsModel";
import { registerTerminalPaneSession, updateTerminalPaneSessionCwd, unregisterTerminalPaneSession } from "./terminalSessionRegistry";
import { createTerminalOutputWriter } from "./terminalOutputWriter";
import { appendCommandBlockOutput, createTerminalCommandBlock } from "./terminalCommandBlocks";
import type { TerminalCommandBlock } from "./terminalCommandBlocks";
import { applyTerminalInputData, createTerminalInputModelState, terminalSuggestionEligibility, updateTerminalInputBufferKind } from "./terminalInputModel";
import { terminalSuggestionProbeScheduler } from "./terminalSuggestionProbeScheduler";
import { appendTerminalOutputHistory } from "../workspace/workspaceSession";
import { buildTerminalCreateRequest, collectCurrentDirOscSequences, errorMessage, isRightArrowInput, resolveGhostSuggestionLayout, terminalGhostSuggestionEqual, terminalSuggestionProviders, type TerminalGhostSuggestion } from "./XtermPane.helpers";

const COMMAND_BLOCKS_MAX_COUNT = 240;

export function installXtermPaneRuntime(params: any) {
  const { args, commandBlockCounterRef, commandBlocksRef, containerRef, cwd, cwdTrackingBufferRef, currentCwdRef, disconnectSessionRef, env, fitAddonRef, focusedRef, ghostSuggestionRef, inputBufferRef, inputModelRef, onCurrentCwdChangeRef, onOutputHistoryChangeRef, outputHistoryRef, paneId, profileId, reconnectSessionRef, remoteHostId, remoteHostProduction, searchAddonRef, sessionIdRef, setCommandBlockNotice, setCommandBlockViews, setConnectionState, setGhostSuggestion, setLogNotice, setLogState, setSearchResults, shell, syncCommandBlockViews, target, terminalAppearance, terminalAppearanceRef, terminalFontWeight, terminalRef, terminalTheme } = params;
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let disposed = false;
    let historyFlushTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let sessionRun = 0;
    let suggestionRequestRun = 0;
    let suggestionTimer: number | null = null;
    let commandBlockViewSyncFrame: number | null = null;
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
    const registerCommandBlock = (command: string) => {
      const marker = terminal.registerMarker(0);
      if (!marker) {
        return;
      }
      const index = commandBlockCounterRef.current;
      commandBlockCounterRef.current += 1;
      const block = createTerminalCommandBlock({
        command,
        id: `${paneId}-command-block-${index + 1}`,
        index,
        marker,
      });
      const nextBlocks = [...commandBlocksRef.current, block];
      const prunedBlocks = nextBlocks.slice(
        0,
        Math.max(0, nextBlocks.length - COMMAND_BLOCKS_MAX_COUNT),
      );
      commandBlocksRef.current = nextBlocks.slice(-COMMAND_BLOCKS_MAX_COUNT);
      for (const prunedBlock of prunedBlocks) {
        prunedBlock.marker.dispose();
      }
      marker.onDispose(() => {
        if (disposed) {
          return;
        }
        commandBlocksRef.current = commandBlocksRef.current.filter(
          (current: TerminalCommandBlock) => current.id !== block.id,
        );
        scheduleCommandBlockViewSync();
      });
      scheduleCommandBlockViewSync();
    };
    const clearCommandBlockViewSyncFrame = () => {
      if (commandBlockViewSyncFrame === null) {
        return;
      }
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(commandBlockViewSyncFrame);
      } else {
        window.clearTimeout(commandBlockViewSyncFrame);
      }
      commandBlockViewSyncFrame = null;
    };
    const scheduleCommandBlockViewSync = () => {
      if (commandBlockViewSyncFrame !== null) {
        return;
      }
      commandBlockViewSyncFrame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(() => {
              commandBlockViewSyncFrame = null;
              if (!disposed) {
                syncCommandBlockViews();
              }
            })
          : window.setTimeout(() => {
              commandBlockViewSyncFrame = null;
              if (!disposed) {
                syncCommandBlockViews();
              }
            }, 16);
    };
    const clearSuggestionTimer = () => {
      if (suggestionTimer !== null) {
        window.clearTimeout(suggestionTimer);
        suggestionTimer = null;
      }
    };
    const remoteProbeSkipReason = (
      inlineSuggestion: TerminalAppearance["inlineSuggestion"],
    ) => {
      if (!inlineSuggestion.remoteProbeEnabled) {
        return "remote-probe-disabled";
      }
      if (
        remoteHostProduction &&
        inlineSuggestion.productionHostPolicy === "restricted"
      ) {
        return "production-host-restricted";
      }
      return undefined;
    };
    const recordRemoteProbeScheduleSkipped = ({
      cwd,
      path,
      provider,
      reason,
    }: {
      cwd?: string;
      path?: string;
      provider: CommandSuggestionProvider;
      reason: string;
    }) => {
      void recordTerminalSuggestionAuditEvent({
        cwd,
        decision: "skipped",
        eventKind: "remoteProbeSchedule",
        metadata: {
          productionHost: String(remoteHostProduction),
          productionHostPolicy:
            terminalAppearanceRef.current.inlineSuggestion.productionHostPolicy,
        },
        paneId,
        path,
        provider,
        reason,
        remoteHostId,
        target: "ssh",
      }).catch(() => undefined);
    };
    const updateGhostSuggestion = (suggestion: TerminalGhostSuggestion) => {
      ghostSuggestionRef.current = suggestion;
      setGhostSuggestion((current: TerminalGhostSuggestion | null) =>
        terminalGhostSuggestionEqual(current, suggestion) ? current : suggestion,
      );
    };
    const hideGhostSuggestion = () => {
      ghostSuggestionRef.current = null;
      setGhostSuggestion((current: TerminalGhostSuggestion | null) =>
        current === null ? current : null,
      );
    };
    const scheduleGitSuggestionRefresh = (path: string | undefined) => {
      const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
      const hostId =
        target?.kind === "dockerContainer" ||
        target?.kind === "telnet" ||
        target?.kind === "serial"
          ? undefined
          : remoteHostId;
      const cwd = path?.trim();
      if (
        !inlineSuggestion.enabled ||
        !inlineSuggestion.providers.git ||
        !hostId ||
        !cwd ||
        target?.kind === "dockerContainer" || target?.kind === "serial"
      ) {
        return;
      }
      const skipReason = remoteProbeSkipReason(inlineSuggestion);
      if (skipReason) {
        recordRemoteProbeScheduleSkipped({
          cwd,
          provider: "git",
          reason: skipReason,
        });
        return;
      }
      terminalSuggestionProbeScheduler.scheduleGit({
        cwd,
        delayMs: 750,
        hostId,
        maxEntries: 500,
        ownerId: paneId,
        ttlSeconds: 60,
      });
    };
    const scheduleRemoteCommandSuggestionRefresh = () => {
      const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
      const hostId =
        target?.kind === "dockerContainer" ||
        target?.kind === "telnet" ||
        target?.kind === "serial"
          ? undefined
          : remoteHostId;
      if (
        !inlineSuggestion.enabled ||
        !inlineSuggestion.providers.remoteCommand ||
        !hostId ||
        target?.kind === "dockerContainer" || target?.kind === "serial"
      ) {
        return;
      }
      const skipReason = remoteProbeSkipReason(inlineSuggestion);
      if (skipReason) {
        recordRemoteProbeScheduleSkipped({
          provider: "remoteCommand",
          reason: skipReason,
        });
        return;
      }
      terminalSuggestionProbeScheduler.scheduleRemoteCommand({
        delayMs: 500,
        hostId,
        maxEntries: 1500,
        ownerId: paneId,
        ttlSeconds: 300,
      });
    };
    const scheduleRemoteHistorySuggestionRefresh = () => {
      const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
      const hostId =
        target?.kind === "dockerContainer" ||
        target?.kind === "telnet" ||
        target?.kind === "serial"
          ? undefined
          : remoteHostId;
      if (
        !inlineSuggestion.enabled ||
        !inlineSuggestion.providers.history ||
        !hostId ||
        target?.kind === "dockerContainer" || target?.kind === "serial"
      ) {
        return;
      }
      const skipReason = remoteProbeSkipReason(inlineSuggestion);
      if (skipReason) {
        recordRemoteProbeScheduleSkipped({
          provider: "history",
          reason: skipReason,
        });
        return;
      }
      terminalSuggestionProbeScheduler.scheduleRemoteHistory({
        delayMs: 650,
        hostId,
        maxEntries: 1000,
        ownerId: paneId,
        ttlSeconds: 900,
      });
    };
    const scheduleRemotePathSuggestionRefresh = (path: string | undefined) => {
      const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
      const hostId =
        target?.kind === "dockerContainer" ||
        target?.kind === "telnet" ||
        target?.kind === "serial"
          ? undefined
          : remoteHostId;
      const normalizedPath = path?.trim();
      if (
        !inlineSuggestion.enabled ||
        !inlineSuggestion.providers.remotePath ||
        !hostId ||
        !normalizedPath ||
        target?.kind === "dockerContainer" || target?.kind === "serial"
      ) {
        return;
      }
      const skipReason = remoteProbeSkipReason(inlineSuggestion);
      if (skipReason) {
        recordRemoteProbeScheduleSkipped({
          path: normalizedPath,
          provider: "remotePath",
          reason: skipReason,
        });
        return;
      }
      terminalSuggestionProbeScheduler.scheduleRemotePath({
        delayMs: 250,
        hostId,
        maxEntries: 250,
        ownerId: paneId,
        path: normalizedPath,
        ttlSeconds: 30,
      });
    };
    const clearGhostSuggestion = () => {
      clearSuggestionTimer();
      suggestionRequestRun += 1;
      hideGhostSuggestion();
    };
    const refreshGhostSuggestionLayout = () => {
      const suggestion = ghostSuggestionRef.current;
      if (!suggestion) {
        return;
      }
      const layout = resolveGhostSuggestionLayout(
        container,
        terminal,
        terminalAppearanceRef.current,
        inputModelRef.current,
      );
      if (!layout) {
        clearGhostSuggestion();
        return;
      }
      updateGhostSuggestion({ ...suggestion, ...layout });
    };
    const scheduleGhostSuggestion = () => {
      clearSuggestionTimer();
      const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
      if (!inlineSuggestion.enabled) {
        clearGhostSuggestion();
        return;
      }
      inputModelRef.current = updateTerminalInputBufferKind(
        inputModelRef.current,
        terminal.buffer.active.type,
      );
      const eligibility = terminalSuggestionEligibility(inputModelRef.current);
      if (!eligibility.eligible) {
        clearGhostSuggestion();
        return;
      }
      suggestionTimer = window.setTimeout(() => {
        suggestionTimer = null;
        const requestRun = ++suggestionRequestRun;
        const model = inputModelRef.current;
        const layout = resolveGhostSuggestionLayout(
          container,
          terminal,
          terminalAppearanceRef.current,
          model,
        );
        if (!layout) {
          clearGhostSuggestion();
          return;
        }
        const sessionId = sessionIdRef.current;
        const containerHostId =
          target?.kind === "dockerContainer" ? target.hostId : undefined;
        const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
        const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
        const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
        const suggestionRemoteHostId =
          containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
        const suggestionTarget = containerHostId
          ? "dockerContainer"
          : telnetHostId
            ? "telnet"
            : serialHostId
              ? "serial"
            : sshHostId
              ? "ssh"
              : "local";
        const suggestionProviders = terminalSuggestionProviders({
          hasSshRemote: Boolean(sshHostId && !containerHostId),
          inlineSuggestion: terminalAppearanceRef.current.inlineSuggestion,
          remoteHostProduction,
        });
        if (suggestionProviders.length === 0) {
          clearGhostSuggestion();
          return;
        }
        void listTerminalSuggestions({
          cursor: model.cursor,
          cwd: currentCwdRef.current ?? cwd,
          input: model.command,
          limit: 1,
          paneId,
          profileId,
          providers: suggestionProviders,
          remoteHostId: suggestionRemoteHostId,
          sessionId: sessionId ?? undefined,
          shell,
          target: suggestionTarget,
        })
          .then((suggestions) => {
            if (disposed || requestRun !== suggestionRequestRun) {
              return;
            }
            const candidate = suggestions.find(
              (item) => item.suffix.length > 0,
            );
            if (!candidate) {
              hideGhostSuggestion();
              return;
            }
            const nextSuggestion = {
              ...layout,
              candidate,
              suffix: candidate.suffix,
            };
            updateGhostSuggestion(nextSuggestion);
          })
          .catch(() => {
            if (!disposed && requestRun === suggestionRequestRun) {
              hideGhostSuggestion();
            }
          });
      }, 60);
    };
    const recordGhostSuggestionFeedback = (
      action: "accepted" | "dismissed",
      suggestion: TerminalGhostSuggestion,
      input: string,
    ) => {
      const sessionId = sessionIdRef.current;
        const containerHostId =
          target?.kind === "dockerContainer" ? target.hostId : undefined;
        const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
        const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
        const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
        const suggestionRemoteHostId =
          containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
        const suggestionTarget = containerHostId
          ? "dockerContainer"
          : telnetHostId
            ? "telnet"
            : serialHostId
              ? "serial"
            : sshHostId
            ? "ssh"
            : "local";
      const candidate = suggestion.candidate;
      void recordTerminalSuggestionFeedback({
        action,
        cwd: currentCwdRef.current ?? cwd,
        input,
        paneId,
        profileId,
        provider: candidate.provider,
        remoteHostId: suggestionRemoteHostId,
        replacementText: candidate.replacementText,
        sessionId: sessionId ?? undefined,
        shell,
        sourceId: candidate.sourceId,
        target: suggestionTarget,
      }).catch(() => undefined);
    };
    const acceptGhostSuggestion = (sessionId: string) => {
      if (
        terminalAppearanceRef.current.inlineSuggestion.acceptKey !==
        "rightArrow"
      ) {
        return false;
      }
      const suggestion = ghostSuggestionRef.current;
      if (!suggestion?.suffix) {
        return false;
      }
      recordGhostSuggestionFeedback(
        "accepted",
        suggestion,
        inputModelRef.current.command,
      );
      void writeTerminal(sessionId, suggestion.suffix);
      const accepted = applyTerminalInputData(
        inputModelRef.current,
        suggestion.suffix,
      );
      inputModelRef.current = accepted.state;
      inputBufferRef.current = accepted.state.command;
      clearGhostSuggestion();
      scheduleCommandBlockViewSync();
      return true;
    };
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      if (isRightArrowInput(data) && acceptGhostSuggestion(sessionId)) {
        return;
      }
      void writeTerminal(sessionId, data);
      const collected = applyTerminalInputData(inputModelRef.current, data);
      inputModelRef.current = updateTerminalInputBufferKind(
        collected.state,
        terminal.buffer.active.type,
      );
      inputBufferRef.current = inputModelRef.current.command;
      if (collected.commands.length === 0) {
        scheduleCommandBlockViewSync();
        scheduleGhostSuggestion();
      }
      for (const command of collected.commands) {
        const dismissedSuggestion = ghostSuggestionRef.current;
        clearGhostSuggestion();
        registerCommandBlock(command);
        if (!command) {
          continue;
        }
        if (
          dismissedSuggestion &&
          dismissedSuggestion.candidate.replacementText !== command
        ) {
          recordGhostSuggestionFeedback("dismissed", dismissedSuggestion, command);
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
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (!terminalAppearanceRef.current.selectionCopy) {
        return;
      }
      const selection = terminal.getSelection?.() ?? "";
      if (selection) {
        void navigator.clipboard?.writeText(selection);
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
      scheduleCommandBlockViewSync();
      refreshGhostSuggestionLayout();
    });
    const writeParsedDisposable = terminal.onWriteParsed(() => {
      scheduleCommandBlockViewSync();
      refreshGhostSuggestionLayout();
    });
    const bufferChangeDisposable = terminal.buffer.onBufferChange(() => {
      inputModelRef.current = updateTerminalInputBufferKind(
        inputModelRef.current,
        terminal.buffer.active.type,
      );
      inputBufferRef.current = inputModelRef.current.command;
      if (terminal.buffer.active.type === "alternate") {
        clearGhostSuggestion();
      } else {
        refreshGhostSuggestionLayout();
      }
      scheduleCommandBlockViewSync();
    });
    terminal.open(container);
    terminalRef.current = terminal;
    const outputWriter = createTerminalOutputWriter(terminal);
    outputWriter.writeNow(outputHistoryRef.current ?? "");

    const flushOutputHistory = () => {
      if (historyFlushTimer !== null) {
        window.clearTimeout(historyFlushTimer);
        historyFlushTimer = null;
      }
      onOutputHistoryChangeRef.current?.(outputHistoryRef.current);
    };

    const scheduleOutputHistoryFlush = () => {
      if (historyFlushTimer !== null) {
        return;
      }
      historyFlushTimer = window.setTimeout(() => {
        historyFlushTimer = null;
        onOutputHistoryChangeRef.current?.(outputHistoryRef.current);
      }, 100);
    };

    const appendOutputHistory = (data: string) => {
      const nextHistory = appendTerminalOutputHistory(
        outputHistoryRef.current,
        data,
      );
      if (nextHistory === outputHistoryRef.current) {
        return;
      }
      outputHistoryRef.current = nextHistory;
      scheduleOutputHistoryFlush();
    };

    const fitAndResize = () => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      const dimensions = fitAddon.proposeDimensions();
      if (!sessionId || !dimensions) {
        return;
      }

      void resizeTerminal(sessionId, {
        cols: dimensions.cols,
        rows: dimensions.rows,
      });
      refreshGhostSuggestionLayout();
    };

    const clearSessionState = (sessionId: string) => {
      if (sessionIdRef.current === sessionId) {
        sessionIdRef.current = null;
      }
      unregisterTerminalPaneSession(paneId, sessionId);
      setLogState({ active: false, bytesWritten: 0 });
    };

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (
        !terminalAppearanceRef.current.autoReconnect ||
        reconnectTimer !== null
      ) {
        return;
      }
      outputWriter.writeNow("\r\n3 秒后自动重新连接...\r\n");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void startSession("reconnect");
      }, 3000);
    };

    const closeActiveSession = async () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return true;
      }

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
      clearGhostSuggestion();
      outputWriter.writeNow(
        reason === "reconnect"
          ? "\r\n正在重新连接...\r\n"
          : target?.kind === "dockerContainer"
          ? "正在进入容器...\r\n"
          : target?.kind === "telnet"
            ? "正在连接 Telnet 主机...\r\n"
            : target?.kind === "serial"
              ? "正在连接 Serial 设备...\r\n"
            : remoteHostId
              ? "正在连接 SSH 主机...\r\n"
              : "正在启动本地终端...\r\n",
      );

      const handleOutput = (event: TerminalOutputEvent) => {
        if (disposed || sessionRun !== currentRun) {
          return;
        }

        if (event.kind === "data") {
          if (remoteHostId || target?.kind === "dockerContainer") {
            const tracked = collectCurrentDirOscSequences(
              cwdTrackingBufferRef.current,
              event.data,
            );
            cwdTrackingBufferRef.current = tracked.buffer;
            for (const nextCwd of tracked.paths) {
              if (nextCwd !== currentCwdRef.current) {
                currentCwdRef.current = nextCwd;
                updateTerminalPaneSessionCwd(paneId, nextCwd);
                onCurrentCwdChangeRef.current?.(nextCwd);
                scheduleGitSuggestionRefresh(nextCwd);
                scheduleRemotePathSuggestionRefresh(nextCwd);
              }
            }
          }
          appendCommandBlockOutput(commandBlocksRef.current, event.data);
          outputWriter.write(event.data);
          appendOutputHistory(event.data);
          return;
        }
        if (event.kind === "closed") {
          clearGhostSuggestion();
          clearSessionState(event.sessionId);
          outputWriter.writeNow("\r\n会话已结束。\r\n");
          setConnectionState("closed");
          scheduleReconnect();
          return;
        }
        clearGhostSuggestion();
        outputWriter.writeNow(`\r\n终端输出读取失败：${event.data}\r\n`);
        setConnectionState("error");
        scheduleReconnect();
      };

      try {
        const session =
          target?.kind === "dockerContainer"
            ? await createDockerContainerTerminalSession(
                {
                  cols: terminal.cols,
                  containerId: target.containerId,
                  hostId: target.hostId,
                  rows: terminal.rows,
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
                    cols: terminal.cols,
                    hostId: target.hostId,
                    rows: terminal.rows,
                  },
                  handleOutput,
                )
              : target?.kind === "serial"
                ? await createSerialTerminalSession(
                    {
                      cols: terminal.cols,
                      hostId: target.hostId,
                      rows: terminal.rows,
                    },
                    handleOutput,
                  )
            : remoteHostId
              ? await createSshTerminalSession(
                  {
                    cols: terminal.cols,
                    hostId: remoteHostId,
                    rows: terminal.rows,
                  },
                  handleOutput,
                )
              : await createTerminalSession(
                  buildTerminalCreateRequest({
                    args,
                    cols: terminal.cols,
                    cwd,
                    env,
                    rows: terminal.rows,
                    shell,
                  }),
                  handleOutput,
                );

        if (disposed || sessionRun !== currentRun) {
          void closeTerminal(session.id);
          return;
        }
        sessionIdRef.current = session.id;
        registerTerminalPaneSession(paneId, session.id, {
          cwd: currentCwdRef.current ?? cwd,
          profileId,
          remoteHostId:
            target?.kind === "dockerContainer" ||
            target?.kind === "telnet" ||
            target?.kind === "serial"
              ? target.hostId
              : remoteHostId,
          shell,
          target:
            target?.kind === "dockerContainer"
              ? "dockerContainer"
              : target?.kind === "telnet"
                ? "telnet"
                : target?.kind === "serial"
                  ? "serial"
                : remoteHostId
                ? "ssh"
                : "local",
        });
        setConnectionState("connected");
        scheduleGitSuggestionRefresh(currentCwdRef.current ?? cwd);
        scheduleRemoteCommandSuggestionRefresh();
        scheduleRemoteHistorySuggestionRefresh();
        scheduleRemotePathSuggestionRefresh(currentCwdRef.current ?? cwd);
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
          `\r\n${
            target?.kind === "dockerContainer"
              ? "容器会话启动失败"
              : target?.kind === "telnet"
                ? "Telnet 会话启动失败"
                : target?.kind === "serial"
                  ? "Serial 会话启动失败"
              : remoteHostId
                ? "SSH 会话启动失败"
                : "本地终端启动失败"
          }：${errorMessage(error)}\r\n`,
        );
        setConnectionState("error");
      }
    };

    const disconnectSession = async () => {
      const currentRun = ++sessionRun;
      clearReconnectTimer();
      terminalSuggestionProbeScheduler.cancelOwner(paneId);
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        setConnectionState("disconnected");
        outputWriter.writeNow(
          "\r\n当前没有活动会话，可通过右键菜单重新连接。\r\n",
        );
        return;
      }

      clearSessionState(sessionId);
      setLogNotice(null);
      inputBufferRef.current = "";
      inputModelRef.current = createTerminalInputModelState();
      cwdTrackingBufferRef.current = "";
      clearGhostSuggestion();
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
      clearReconnectTimer();
      terminalSuggestionProbeScheduler.cancelOwner(paneId);
      clearSuggestionTimer();
      clearCommandBlockViewSyncFrame();
      flushOutputHistory();
      inputDisposable.dispose();
      selectionDisposable.dispose();
      searchResultDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      bufferChangeDisposable.dispose();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      reconnectSessionRef.current = null;
      disconnectSessionRef.current = null;
      if (sessionId) {
        unregisterTerminalPaneSession(paneId, sessionId);
        void closeTerminal(sessionId);
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
