// @author kongweiguang

import type { MutableRefObject } from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  appendCommandBlockOutput,
  terminalCommandBlockPlainText,
  type TerminalCommandBlock,
  type TerminalCommandBlockView,
} from "./terminalCommandBlocks";
import {
  clearTerminalCommandBlocks,
  closeLatestTerminalCommandBlock,
  syncTerminalCommandProtocolPromptBlock,
  submitTerminalCommandBlock,
} from "./terminalCommandBlockLifecycle";
import { updateTerminalPaneRuntimeContext } from "./terminalSessionRegistry";
import { collectTerminalShellIntegrationOsc133Segments } from "./terminalShellIntegrationModel";
import type {
  TerminalShellIntegrationEvent,
  TerminalShellIntegrationOsc133Event,
  TerminalShellIntegrationState,
} from "./terminalShellIntegrationModel";

export function createXtermPaneCommandBlockRuntime({
  assistEnabled,
  commandBlockCounterRef,
  commandBlocksRef,
  isDisposed,
  paneId,
  promptLineRef,
  readCurrentCommand,
  readShellIntegrationState,
  reduceShellIntegrationState,
  setCommandBlockNotice,
  setCommandBlockViews,
  shellIntegrationCommandBlockProtocolRef,
  syncCommandBlockViews,
  terminal,
}: {
  assistEnabled: boolean;
  commandBlockCounterRef: MutableRefObject<number>;
  commandBlocksRef: MutableRefObject<TerminalCommandBlock[]>;
  isDisposed: () => boolean;
  paneId: string;
  promptLineRef: MutableRefObject<number | undefined>;
  readCurrentCommand: () => string;
  readShellIntegrationState: () => TerminalShellIntegrationState;
  reduceShellIntegrationState: (
    event: TerminalShellIntegrationEvent,
  ) => TerminalShellIntegrationState;
  setCommandBlockNotice: (notice: string | null) => void;
  setCommandBlockViews: (views: TerminalCommandBlockView[]) => void;
  shellIntegrationCommandBlockProtocolRef: MutableRefObject<boolean>;
  syncCommandBlockViews: () => void;
  terminal: XtermTerminal;
}) {
  let commandBlockViewSyncFrame: number | null = null;
  let shellIntegrationOsc133Buffer = "";
  let pendingProtocolCommand: string | undefined;
  let protocolCommandOutputActive = false;

  const scheduleViewSyncIfLive = () => {
    if (!isDisposed()) {
      scheduleCommandBlockViewSync();
    }
  };

  const closeCurrentCommandBlock = () => {
    if (!assistEnabled) {
      return;
    }
    if (
      closeLatestTerminalCommandBlock({
        commandBlocksRef,
        onEndMarkerDispose: scheduleViewSyncIfLive,
        terminal,
      })
    ) {
      scheduleCommandBlockViewSync();
    }
  };

  const clearCommandBlocks = () => {
    if (!assistEnabled) {
      setCommandBlockViews([]);
      setCommandBlockNotice(null);
      return;
    }
    clearTerminalCommandBlocks(commandBlocksRef);
    setCommandBlockViews([]);
    setCommandBlockNotice(null);
    scheduleCommandBlockViewSync();
  };

  const registerCommandBlock = (command: string) => {
    if (!assistEnabled) {
      return;
    }
    if (
      submitTerminalCommandBlock({
        command,
        commandBlockCounterRef,
        commandBlocksRef,
        onEndMarkerDispose: scheduleViewSyncIfLive,
        onStartMarkerDispose: scheduleViewSyncIfLive,
        paneId,
        promptLine: promptLineRef.current,
        terminal,
      })
    ) {
      scheduleCommandBlockViewSync();
    }
  };

  const latestOpenSubmittedCommandBlock = () => {
    const block = commandBlocksRef.current[commandBlocksRef.current.length - 1];
    if (!block || !block.submitted || block.endMarker) {
      return undefined;
    }
    return block;
  };

  const currentTerminalLine = () => {
    const activeBuffer = terminal.buffer.active as {
      baseY?: number;
      cursorY?: number;
    };
    return typeof activeBuffer.baseY === "number" &&
      typeof activeBuffer.cursorY === "number"
      ? activeBuffer.baseY + activeBuffer.cursorY
      : undefined;
  };

  const syncProtocolPromptBlock = () => {
    if (
      !assistEnabled ||
      !shellIntegrationCommandBlockProtocolRef.current ||
      terminal.buffer.active.type !== "normal"
    ) {
      return;
    }
    const promptLine = currentTerminalLine();
    promptLineRef.current = promptLine;
    if (
      syncTerminalCommandProtocolPromptBlock({
        commandBlockCounterRef,
        commandBlocksRef,
        onEndMarkerDispose: scheduleViewSyncIfLive,
        onStartMarkerDispose: scheduleViewSyncIfLive,
        paneId,
        promptLine,
        terminal,
      })
    ) {
      scheduleCommandBlockViewSync();
    }
  };

  const startProtocolCommandBlock = (commandFromOsc?: string) => {
    if (
      !assistEnabled ||
      !shellIntegrationCommandBlockProtocolRef.current ||
      terminal.buffer.active.type !== "normal"
    ) {
      return;
    }
    const command = (
      commandFromOsc ??
      pendingProtocolCommand ??
      readCurrentCommand()
    ).trim();
    if (!command) {
      return;
    }
    const latestBlock = latestOpenSubmittedCommandBlock();
    if (latestBlock?.command === command) {
      protocolCommandOutputActive = true;
      pendingProtocolCommand = undefined;
      return;
    }
    registerCommandBlock(command);
    protocolCommandOutputActive = true;
    pendingProtocolCommand = undefined;
  };

  const finishProtocolCommandBlock = (options: { closeMarker: boolean }) => {
    if (!assistEnabled || !shellIntegrationCommandBlockProtocolRef.current) {
      return;
    }
    protocolCommandOutputActive = false;
    pendingProtocolCommand = undefined;
    if (options.closeMarker) {
      closeCurrentCommandBlock();
    }
  };

  const handleShellIntegrationOsc133 = (
    event: TerminalShellIntegrationOsc133Event,
    source: "output" | "parser",
  ) => {
    if (!shellIntegrationCommandBlockProtocolRef.current) {
      return;
    }
    switch (event.marker) {
      case "A":
      case "B":
        syncProtocolPromptBlock();
        return;
      case "C":
        startProtocolCommandBlock(event.command);
        return;
      case "D":
        finishProtocolCommandBlock({ closeMarker: source === "parser" });
        return;
    }
  };

  const appendProtocolCommandOutput = (data: string) => {
    if (!assistEnabled || !protocolCommandOutputActive) {
      return;
    }
    appendCommandBlockOutput(commandBlocksRef.current, data);
  };

  const appendShellIntegrationCommandOutput = (data: string) => {
    if (
      !assistEnabled ||
      !shellIntegrationCommandBlockProtocolRef.current ||
      !readShellIntegrationState().trusted
    ) {
      appendCommandBlockOutput(commandBlocksRef.current, data);
      return;
    }
    const collected = collectTerminalShellIntegrationOsc133Segments(
      shellIntegrationOsc133Buffer,
      data,
    );
    shellIntegrationOsc133Buffer = collected.buffer;
    for (const segment of collected.segments) {
      if (segment.type === "data") {
        appendProtocolCommandOutput(segment.data);
        continue;
      }
      reduceShellIntegrationState({
        payload: segment.event.marker,
        type: "osc133",
      });
      handleShellIntegrationOsc133(segment.event, "output");
    }
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

  const latestCommandBlockText = () => {
    if (!assistEnabled) {
      return undefined;
    }
    const block = [...commandBlocksRef.current]
      .reverse()
      .find((candidate) => candidate.submitted && candidate.command.trim());
    return block ? terminalCommandBlockPlainText(block) : undefined;
  };

  const syncCommandBlockRuntimeContext = () => {
    updateTerminalPaneRuntimeContext(paneId, {
      commandBlockText: latestCommandBlockText(),
    });
  };

  const scheduleCommandBlockViewSync = () => {
    if (!assistEnabled || commandBlockViewSyncFrame !== null) {
      return;
    }
    commandBlockViewSyncFrame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => {
            commandBlockViewSyncFrame = null;
            if (!isDisposed()) {
              syncCommandBlockViews();
              syncCommandBlockRuntimeContext();
            }
          })
        : window.setTimeout(() => {
            commandBlockViewSyncFrame = null;
            if (!isDisposed()) {
              syncCommandBlockViews();
              syncCommandBlockRuntimeContext();
            }
          }, 16);
  };

  return {
    appendShellIntegrationCommandOutput,
    clearCommandBlockViewSyncFrame,
    clearCommandBlocks,
    closeCurrentCommandBlock,
    handleShellIntegrationOsc133,
    registerCommandBlock,
    resetProtocolState: () => {
      shellIntegrationOsc133Buffer = "";
      pendingProtocolCommand = undefined;
      protocolCommandOutputActive = false;
    },
    scheduleCommandBlockViewSync,
    setPendingProtocolCommand: (command: string) => {
      pendingProtocolCommand = command;
    },
    syncCommandBlockRuntimeContext,
  };
}
