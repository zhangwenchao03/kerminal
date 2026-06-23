import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  COMMAND_BLOCKS_MAX_COUNT,
  createTerminalCommandBlock,
  type TerminalCommandBlock,
} from "./terminalCommandBlocks";
import { isLikelyShellPrompt } from "./XtermPane.helpers";
import {
  disposeCommandBlockMarkers,
  registerMarkerAtLine,
} from "./XtermPane.runtime.helpers";

interface MutableRef<T> {
  current: T;
}

interface TerminalCommandBlockRefs {
  commandBlockCounterRef: MutableRef<number>;
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>;
  paneId: string;
}

interface TerminalCommandBlockCallbacks {
  onEndMarkerDispose?: () => void;
  onStartMarkerDispose?: () => void;
}

export function clearTerminalCommandBlocks(
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>,
) {
  const blocks = commandBlocksRef.current;
  commandBlocksRef.current = [];
  for (const block of blocks) {
    disposeCommandBlockMarkers(block);
  }
  return blocks.length > 0;
}

export function closeLatestTerminalCommandBlock({
  commandBlocksRef,
  onEndMarkerDispose,
  terminal,
}: {
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>;
  terminal: XtermTerminal;
} & Pick<TerminalCommandBlockCallbacks, "onEndMarkerDispose">) {
  const block = commandBlocksRef.current[commandBlocksRef.current.length - 1];
  if (!block || (block.endMarker && !block.endMarker.isDisposed)) {
    return false;
  }
  if (!block.submitted) {
    removeTerminalCommandBlock(commandBlocksRef, block);
    disposeCommandBlockMarkers(block);
    return true;
  }

  const marker = terminal.registerMarker(-1) ?? terminal.registerMarker(0);
  if (!marker) {
    return false;
  }
  block.endMarker = marker;
  marker.onDispose(() => {
    onEndMarkerDispose?.();
  });
  return true;
}

export function submitTerminalCommandBlock({
  command,
  commandBlockCounterRef,
  commandBlocksRef,
  onEndMarkerDispose,
  onStartMarkerDispose,
  paneId,
  promptLine,
  terminal,
}: {
  command: string;
  promptLine?: number;
  terminal: XtermTerminal;
} & TerminalCommandBlockRefs &
  TerminalCommandBlockCallbacks) {
  const currentBlock = commandBlocksRef.current[commandBlocksRef.current.length - 1];
  if (
    currentBlock &&
    !currentBlock.submitted &&
    !currentBlock.endMarker &&
    !currentBlock.marker.isDisposed
  ) {
    currentBlock.command = command;
    currentBlock.createdAt = Date.now();
    currentBlock.submitted = true;
    return true;
  }

  const changedByClose = closeLatestTerminalCommandBlock({
    commandBlocksRef,
    onEndMarkerDispose,
    terminal,
  });
  const marker = registerMarkerAtLine(terminal, promptLine);
  if (!marker) {
    return changedByClose;
  }

  const index = commandBlockCounterRef.current;
  commandBlockCounterRef.current += 1;
  const block = createTerminalCommandBlock({
    command,
    id: `${paneId}-command-block-${index + 1}`,
    index,
    marker,
  });
  appendTerminalCommandBlock(commandBlocksRef, block);
  registerStartMarkerDispose(commandBlocksRef, block, onStartMarkerDispose);
  return true;
}

export function syncTerminalCommandPromptBlocks({
  commandBlockCounterRef,
  commandBlocksRef,
  onEndMarkerDispose,
  onStartMarkerDispose,
  paneId,
  promptLine,
  terminal,
}: {
  promptLine?: number;
  terminal: XtermTerminal;
} & TerminalCommandBlockRefs &
  TerminalCommandBlockCallbacks) {
  if (
    typeof promptLine !== "number" ||
    terminal.buffer.active.type !== "normal"
  ) {
    return false;
  }

  let changed = closeLatestSubmittedBlockBeforePrompt({
    commandBlocksRef,
    onEndMarkerDispose,
    promptLine,
    terminal,
  });

  changed =
    removeStaleCurrentPromptBlock(commandBlocksRef, promptLine) || changed;

  for (const line of collectTrailingEmptyPromptLines(terminal, promptLine)) {
    if (hasLiveCommandBlockBoundaryAtLine(commandBlocksRef.current, line)) {
      continue;
    }
    const marker = registerMarkerAtLine(terminal, line);
    if (!marker) {
      continue;
    }
    const idIndex = commandBlockCounterRef.current;
    commandBlockCounterRef.current += 1;
    const visualIndex = commandBlocksRef.current.filter(
      (block) =>
        !block.marker.isDisposed &&
        block.marker.line >= 0 &&
        block.marker.line < line,
    ).length;
    const block = createTerminalCommandBlock({
      command: "",
      id: `${paneId}-command-block-${idIndex + 1}`,
      index: visualIndex,
      marker,
      submitted: true,
    });
    insertTerminalCommandBlockByLine(commandBlocksRef, block);
    registerStartMarkerDispose(commandBlocksRef, block, onStartMarkerDispose);
    changed = true;
  }

  return (
    ensureCurrentPromptCommandBlock({
      commandBlockCounterRef,
      commandBlocksRef,
      onStartMarkerDispose,
      paneId,
      promptLine,
      terminal,
    }) || changed
  );
}

export function collectTrailingEmptyPromptLines(
  terminal: XtermTerminal,
  promptLine: number,
) {
  const lines: number[] = [];
  const buffer = terminal.buffer.active;
  const promptText = normalizeEmptyPromptLine(
    buffer.getLine(promptLine)?.translateToString(true) ?? "",
  );
  if (!promptText) {
    return lines;
  }

  const startLine = Math.max(0, promptLine - COMMAND_BLOCKS_MAX_COUNT);
  for (let line = promptLine - 1; line >= startLine; line -= 1) {
    const text = normalizeEmptyPromptLine(
      buffer.getLine(line)?.translateToString(true) ?? "",
    );
    if (text !== promptText) {
      break;
    }
    lines.unshift(line);
  }
  return lines;
}

function closeLatestSubmittedBlockBeforePrompt({
  commandBlocksRef,
  onEndMarkerDispose,
  promptLine,
  terminal,
}: {
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>;
  promptLine: number;
  terminal: XtermTerminal;
} & Pick<TerminalCommandBlockCallbacks, "onEndMarkerDispose">) {
  const latestSubmittedBlock =
    commandBlocksRef.current[commandBlocksRef.current.length - 1];
  if (
    !latestSubmittedBlock ||
    !latestSubmittedBlock.submitted ||
    latestSubmittedBlock.endMarker ||
    latestSubmittedBlock.marker.isDisposed ||
    latestSubmittedBlock.marker.line >= promptLine
  ) {
    return false;
  }

  const marker = registerMarkerAtLine(
    terminal,
    Math.max(latestSubmittedBlock.marker.line, promptLine - 1),
  );
  if (!marker) {
    return false;
  }
  latestSubmittedBlock.endMarker = marker;
  marker.onDispose(() => {
    onEndMarkerDispose?.();
  });
  return true;
}

function removeStaleCurrentPromptBlock(
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>,
  promptLine: number,
) {
  const staleCurrentBlock =
    commandBlocksRef.current[commandBlocksRef.current.length - 1];
  if (
    !staleCurrentBlock ||
    staleCurrentBlock.submitted ||
    staleCurrentBlock.endMarker ||
    staleCurrentBlock.marker.line === promptLine
  ) {
    return false;
  }

  removeTerminalCommandBlock(commandBlocksRef, staleCurrentBlock);
  disposeCommandBlockMarkers(staleCurrentBlock);
  return true;
}

function ensureCurrentPromptCommandBlock({
  commandBlockCounterRef,
  commandBlocksRef,
  onStartMarkerDispose,
  paneId,
  promptLine,
  terminal,
}: {
  promptLine: number;
  terminal: XtermTerminal;
} & TerminalCommandBlockRefs &
  Pick<TerminalCommandBlockCallbacks, "onStartMarkerDispose">) {
  const submittedBlockAtPrompt = commandBlocksRef.current.some(
    (block) =>
      block.submitted &&
      !block.endMarker &&
      !block.marker.isDisposed &&
      block.marker.line === promptLine,
  );
  const hasCurrentPromptBlock = commandBlocksRef.current.some(
    (block) =>
      !block.submitted &&
      !block.endMarker &&
      !block.marker.isDisposed &&
      block.marker.line === promptLine,
  );
  if (submittedBlockAtPrompt || hasCurrentPromptBlock) {
    return false;
  }

  const marker = registerMarkerAtLine(terminal, promptLine);
  if (!marker) {
    return false;
  }
  const index = commandBlockCounterRef.current;
  commandBlockCounterRef.current += 1;
  const block = createTerminalCommandBlock({
    command: "",
    id: `${paneId}-command-block-${index + 1}`,
    index,
    marker,
    submitted: false,
  });
  appendTerminalCommandBlock(commandBlocksRef, block);
  registerStartMarkerDispose(commandBlocksRef, block, onStartMarkerDispose);
  return true;
}

function appendTerminalCommandBlock(
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>,
  block: TerminalCommandBlock,
) {
  commandBlocksRef.current = pruneTerminalCommandBlocks([
    ...commandBlocksRef.current,
    block,
  ]);
}

function insertTerminalCommandBlockByLine(
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>,
  block: TerminalCommandBlock,
) {
  const insertIndex = commandBlocksRef.current.findIndex(
    (current) =>
      !current.marker.isDisposed && current.marker.line > block.marker.line,
  );
  const nextBlocks =
    insertIndex >= 0
      ? [
          ...commandBlocksRef.current.slice(0, insertIndex),
          block,
          ...commandBlocksRef.current.slice(insertIndex),
        ]
      : [...commandBlocksRef.current, block];
  commandBlocksRef.current = pruneTerminalCommandBlocks(nextBlocks);
}

function pruneTerminalCommandBlocks(blocks: TerminalCommandBlock[]) {
  const prunedBlocks = blocks.slice(
    0,
    Math.max(0, blocks.length - COMMAND_BLOCKS_MAX_COUNT),
  );
  for (const prunedBlock of prunedBlocks) {
    disposeCommandBlockMarkers(prunedBlock);
  }
  return blocks.slice(-COMMAND_BLOCKS_MAX_COUNT);
}

function registerStartMarkerDispose(
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>,
  block: TerminalCommandBlock,
  onStartMarkerDispose?: () => void,
) {
  block.marker.onDispose(() => {
    removeTerminalCommandBlock(commandBlocksRef, block);
    block.endMarker?.dispose();
    onStartMarkerDispose?.();
  });
}

function removeTerminalCommandBlock(
  commandBlocksRef: MutableRef<TerminalCommandBlock[]>,
  block: TerminalCommandBlock,
) {
  commandBlocksRef.current = commandBlocksRef.current.filter(
    (current) => current.id !== block.id,
  );
}

function hasLiveCommandBlockBoundaryAtLine(
  blocks: TerminalCommandBlock[],
  line: number,
) {
  return blocks.some((block) => {
    const hasStartAtLine = !block.marker.isDisposed && block.marker.line === line;
    const hasEndAtLine =
      block.endMarker &&
      !block.endMarker.isDisposed &&
      block.endMarker.line === line;
    return hasStartAtLine || hasEndAtLine;
  });
}

function normalizeEmptyPromptLine(text: string) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return isLikelyShellPrompt(trimmed) ? trimmed : undefined;
}
