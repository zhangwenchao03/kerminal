import type { ISearchOptions } from "@xterm/addon-search";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalCreateRequest } from "../../lib/terminalApi";
import { writeTerminal } from "../../lib/terminalApi";
import type {
  CommandSuggestionCandidate,
  CommandSuggestionProvider,
} from "../../lib/terminalSuggestionApi";
import type { TerminalAppearance } from "../settings/settingsModel";
import type { TerminalContextMenuPosition } from "./TerminalContextMenu";
import type { TerminalCommandBlockView } from "./terminalCommandBlocks";
import {
  applyTerminalInputData,
  createTerminalInputModelState,
  type TerminalInputModelState,
} from "./terminalInputModel";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "closed"
  | "error";

export interface TerminalGhostSuggestion {
  candidate: CommandSuggestionCandidate;
  left: number;
  lineHeight: number;
  maxWidth: number;
  suffix: string;
  top: number;
}

const CURRENT_DIR_OSC_PREFIX = "\u001b]1337;CurrentDir=";
const OSC_BEL_TERMINATOR = "\u0007";
const OSC_ST_TERMINATOR = "\u001b\\";
const MAX_CWD_TRACKING_BUFFER_LENGTH = 4096;

export function terminalSuggestionProviders({
  hasSshRemote,
  inlineSuggestion,
  remoteHostProduction,
}: {
  hasSshRemote: boolean;
  inlineSuggestion: TerminalAppearance["inlineSuggestion"];
  remoteHostProduction?: boolean;
}): CommandSuggestionProvider[] {
  if (!inlineSuggestion.enabled) {
    return [];
  }
  const providers: CommandSuggestionProvider[] = [];
  if (inlineSuggestion.providers.history) {
    providers.push("history");
  }
  if (
    hasSshRemote &&
    terminalInlineSuggestionAllowsRemoteProbe({
      inlineSuggestion,
      remoteHostProduction,
    })
  ) {
    if (inlineSuggestion.providers.remotePath) {
      providers.push("remotePath");
    }
    if (inlineSuggestion.providers.remoteCommand) {
      providers.push("remoteCommand");
    }
    if (inlineSuggestion.providers.git) {
      providers.push("git");
    }
  }
  if (inlineSuggestion.providers.spec) {
    providers.push("spec");
  }
  return providers;
}

export function terminalInlineSuggestionAllowsRemoteProbe({
  inlineSuggestion,
  remoteHostProduction,
}: {
  inlineSuggestion: TerminalAppearance["inlineSuggestion"];
  remoteHostProduction?: boolean;
}) {
  if (!inlineSuggestion.remoteProbeEnabled) {
    return false;
  }
  return !(
    remoteHostProduction &&
    inlineSuggestion.productionHostPolicy === "restricted"
  );
}

export function terminalGhostSuggestionEqual(
  current: TerminalGhostSuggestion | null,
  next: TerminalGhostSuggestion | null,
) {
  if (current === next) {
    return true;
  }
  if (!current || !next) {
    return false;
  }
  return (
    current.suffix === next.suffix &&
    nearlyEqual(current.left, next.left) &&
    nearlyEqual(current.maxWidth, next.maxWidth) &&
    nearlyEqual(current.top, next.top) &&
    current.candidate.provider === next.candidate.provider &&
    current.candidate.sourceId === next.candidate.sourceId &&
    current.candidate.replacementText === next.candidate.replacementText &&
    current.candidate.description === next.candidate.description
  );
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 0.25;
}

export function resolveTerminalRowHeight(
  container: HTMLDivElement | null,
  terminalAppearance: TerminalAppearance,
  terminal?: Pick<XtermTerminal, "rows">,
) {
  const screenElement = container?.querySelector(".xterm-screen");
  if (
    screenElement instanceof HTMLElement &&
    terminal &&
    terminal.rows > 0
  ) {
    const measuredHeight = screenElement.getBoundingClientRect().height;
    if (measuredHeight > 0) {
      return measuredHeight / terminal.rows;
    }
  }

  const rowElement = container?.querySelector(".xterm-rows > div");
  if (rowElement instanceof HTMLElement) {
    const measuredHeight = rowElement.getBoundingClientRect().height;
    if (measuredHeight > 0) {
      return measuredHeight;
    }
    const computedLineHeight = Number.parseFloat(
      window.getComputedStyle(rowElement).lineHeight,
    );
    if (Number.isFinite(computedLineHeight) && computedLineHeight > 0) {
      return computedLineHeight;
    }
  }

  return Math.max(
    12,
    terminalAppearance.fontSize * terminalAppearance.lineHeight,
  );
}

export function resolveGhostSuggestionLayout(
  container: HTMLDivElement,
  terminal: XtermTerminal,
  terminalAppearance: TerminalAppearance,
  inputModel: TerminalInputModelState,
): Pick<
  TerminalGhostSuggestion,
  "left" | "lineHeight" | "maxWidth" | "top"
> | null {
  if (terminal.buffer.active.type === "alternate") {
    return null;
  }

  const rowHeight = resolveTerminalRowHeight(
    container,
    terminalAppearance,
    terminal,
  );
  const cellWidth = resolveTerminalCellWidth(
    container,
    terminal,
    terminalAppearance,
  );
  if (rowHeight <= 0 || cellWidth <= 0) {
    return null;
  }

  const cursorX = resolveTerminalCursorX(terminal, inputModel);
  const cursorY = resolveTerminalCursorY(terminal);
  const frameElement =
    container.parentElement instanceof HTMLElement
      ? container.parentElement
      : null;
  const screenElement = container.querySelector(".xterm-screen");
  const rowsElement = container.querySelector(".xterm-rows");
  const frameRect = frameElement?.getBoundingClientRect();
  const screenRect =
    screenElement instanceof HTMLElement
      ? screenElement.getBoundingClientRect()
      : undefined;
  const rowsRect =
    rowsElement instanceof HTMLElement
      ? rowsElement.getBoundingClientRect()
      : undefined;
  const containerStyle = window.getComputedStyle(container);
  const paddingLeft = Number.parseFloat(containerStyle.paddingLeft) || 0;
  const paddingTop = Number.parseFloat(containerStyle.paddingTop) || 0;
  const originLeft =
    frameRect && rowsRect && rowsRect.width > 0
      ? rowsRect.left - frameRect.left
      : frameRect && screenRect && screenRect.width > 0
        ? screenRect.left - frameRect.left
        : container.offsetLeft +
          (rowsElement instanceof HTMLElement ? rowsElement.offsetLeft : paddingLeft);
  const originTop =
    frameRect && rowsRect && rowsRect.height > 0
      ? rowsRect.top - frameRect.top
      : frameRect && screenRect && screenRect.height > 0
        ? screenRect.top - frameRect.top
        : container.offsetTop +
          (rowsElement instanceof HTMLElement ? rowsElement.offsetTop : paddingTop);
  const left = originLeft + cursorX * cellWidth;
  const top = originTop + cursorY * rowHeight;
  const screenRight =
    frameRect && screenRect && screenRect.width > 0
      ? screenRect.right - frameRect.left
      : undefined;
  const availableWidth =
    typeof screenRight === "number"
      ? screenRight - left
      : (container.clientWidth || terminal.cols * cellWidth) -
        originLeft +
        container.offsetLeft -
        cursorX * cellWidth;

  if (availableWidth <= cellWidth) {
    return null;
  }

  return {
    left,
    lineHeight: rowHeight,
    maxWidth: Math.max(cellWidth, availableWidth),
    top,
  };
}

function resolveTerminalCellWidth(
  container: HTMLDivElement,
  terminal: XtermTerminal,
  terminalAppearance: TerminalAppearance,
) {
  const screenElement = container.querySelector(".xterm-screen");
  if (screenElement instanceof HTMLElement && terminal.cols > 0) {
    const measuredWidth = screenElement.getBoundingClientRect().width;
    if (measuredWidth > 0) {
      return measuredWidth / terminal.cols;
    }
  }

  const rowElement = container.querySelector(".xterm-rows > div");
  if (rowElement instanceof HTMLElement) {
    const measuredWidth = rowElement.getBoundingClientRect().width;
    if (measuredWidth > 0 && terminal.cols > 0) {
      return measuredWidth / terminal.cols;
    }
  }

  return Math.max(4, terminalAppearance.fontSize * 0.62);
}

function resolveTerminalCursorX(
  terminal: XtermTerminal,
  inputModel: TerminalInputModelState,
) {
  const activeBuffer = terminal.buffer.active as { cursorX?: number };
  if (typeof activeBuffer.cursorX === "number" && activeBuffer.cursorX >= 0) {
    return Math.min(activeBuffer.cursorX, Math.max(0, terminal.cols - 1));
  }
  return Math.min(inputModel.cursor, Math.max(0, terminal.cols - 1));
}

function resolveTerminalCursorY(terminal: XtermTerminal) {
  const activeBuffer = terminal.buffer.active as { cursorY?: number };
  if (typeof activeBuffer.cursorY === "number" && activeBuffer.cursorY >= 0) {
    return Math.min(activeBuffer.cursorY, Math.max(0, terminal.rows - 1));
  }
  return 0;
}

export function isRightArrowInput(data: string) {
  return data === "\u001b[C" || data === "\u001bOC";
}

export function resolveTerminalContentBottomLine(terminal: XtermTerminal) {
  const buffer = terminal.buffer.active;
  for (let line = buffer.length - 1; line >= 0; line -= 1) {
    const text = buffer.getLine(line)?.translateToString(true) ?? "";
    if (text.trim().length > 0) {
      return line;
    }
  }
  return undefined;
}

export function resolveTerminalPromptLine(
  terminal: XtermTerminal,
  pendingInput: string,
) {
  const buffer = terminal.buffer.active;
  const activeBuffer = buffer as typeof buffer & {
    baseY?: number;
    cursorY?: number;
  };
  const cursorLine =
    typeof activeBuffer.baseY === "number" &&
    typeof activeBuffer.cursorY === "number"
      ? activeBuffer.baseY + activeBuffer.cursorY
      : resolveTerminalContentBottomLine(terminal);
  if (typeof cursorLine !== "number") {
    return undefined;
  }

  if (pendingInput.length > 0) {
    return cursorLine;
  }

  const text = buffer.getLine(cursorLine)?.translateToString(true) ?? "";
  return isLikelyShellPrompt(text) ? cursorLine : undefined;
}

export function isLikelyShellPrompt(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return /(?:[$#>%]|❯|➜)$/.test(trimmed);
}

export function applyTerminalCommandBlockFolding(
  container: HTMLDivElement | null,
  views: TerminalCommandBlockView[],
) {
  if (!container) {
    return undefined;
  }

  resetTerminalCommandBlockFolding(container);
  const collapsedViews = views.filter(
    (view) => view.collapsed && !view.muted && view.hiddenLineCount > 0,
  );
  if (collapsedViews.length === 0) {
    return () => resetTerminalCommandBlockFolding(container);
  }

  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(".xterm-rows > div"),
  );
  if (rows.length === 0) {
    return () => resetTerminalCommandBlockFolding(container);
  }

  const viewportY = views[0]?.viewportY ?? 0;
  const rowHeight = views[0]?.rowHeight ?? 0;
  if (rowHeight <= 0) {
    return () => resetTerminalCommandBlockFolding(container);
  }

  rows.forEach((row, rowIndex) => {
    const line = viewportY + rowIndex;
    let hiddenLinesBefore = 0;
    let hiddenInsideFold = false;

    for (const view of collapsedViews) {
      if (line > view.visibleStartLine && line <= view.visibleEndLine) {
        hiddenInsideFold = true;
        break;
      }
      if (line > view.visibleEndLine) {
        hiddenLinesBefore += view.hiddenLineCount;
      }
    }

    if (!hiddenInsideFold && hiddenLinesBefore === 0) {
      return;
    }

    row.dataset.commandBlockFolded = "true";
    row.dataset.commandBlockFoldTransform = row.style.transform;
    row.dataset.commandBlockFoldVisibility = row.style.visibility;

    if (hiddenInsideFold) {
      row.style.visibility = "hidden";
      return;
    }

    const offset = hiddenLinesBefore * rowHeight;
    row.style.transform =
      `${row.dataset.commandBlockFoldTransform} translateY(-${offset}px)`.trim();
  });

  return () => resetTerminalCommandBlockFolding(container);
}

function resetTerminalCommandBlockFolding(container: HTMLDivElement) {
  const foldedRows = Array.from(
    container.querySelectorAll<HTMLElement>(
      ".xterm-rows > div[data-command-block-folded='true']",
    ),
  );
  foldedRows.forEach((row) => {
    row.style.transform = row.dataset.commandBlockFoldTransform ?? "";
    row.style.visibility = row.dataset.commandBlockFoldVisibility ?? "";
    delete row.dataset.commandBlockFolded;
    delete row.dataset.commandBlockFoldTransform;
    delete row.dataset.commandBlockFoldVisibility;
  });
}

export function terminalSearchOptions(caseSensitive: boolean): ISearchOptions {
  return {
    caseSensitive,
    decorations: {
      activeMatchBackground: "#38bdf8",
      activeMatchBorder: "#0ea5e9",
      activeMatchColorOverviewRuler: "#0ea5e9",
      matchBackground: "#fde68a",
      matchBorder: "#f59e0b",
      matchOverviewRuler: "#f59e0b",
    },
  };
}

export function collectSubmittedCommands(
  currentBuffer: string,
  data: string,
): { buffer: string; commands: string[] } {
  const update = applyTerminalInputData(
    createTerminalInputModelState({ command: currentBuffer }),
    data,
  );

  return { buffer: update.state.command, commands: update.commands };
}

export function collectCurrentDirOscSequences(
  currentBuffer: string,
  data: string,
): { buffer: string; paths: string[] } {
  let buffer = limitCwdTrackingBuffer(currentBuffer + data);
  const paths: string[] = [];

  while (buffer) {
    const startIndex = buffer.indexOf(CURRENT_DIR_OSC_PREFIX);
    if (startIndex === -1) {
      return {
        buffer: trailingPotentialCurrentDirOscPrefix(buffer),
        paths,
      };
    }

    if (startIndex > 0) {
      buffer = buffer.slice(startIndex);
    }

    const payloadStart = CURRENT_DIR_OSC_PREFIX.length;
    const terminator = findCurrentDirOscTerminator(buffer, payloadStart);
    if (!terminator) {
      return {
        buffer: limitCwdTrackingBuffer(buffer),
        paths,
      };
    }

    const path = sanitizeCurrentDirOscPath(
      buffer.slice(payloadStart, terminator.index),
    );
    if (path) {
      paths.push(path);
    }
    buffer = buffer.slice(terminator.index + terminator.length);
  }

  return { buffer: "", paths };
}

function findCurrentDirOscTerminator(
  buffer: string,
  fromIndex: number,
): { index: number; length: number } | null {
  const belIndex = buffer.indexOf(OSC_BEL_TERMINATOR, fromIndex);
  const stIndex = buffer.indexOf(OSC_ST_TERMINATOR, fromIndex);
  if (belIndex === -1 && stIndex === -1) {
    return null;
  }
  if (stIndex !== -1 && (belIndex === -1 || stIndex < belIndex)) {
    return { index: stIndex, length: OSC_ST_TERMINATOR.length };
  }
  return { index: belIndex, length: OSC_BEL_TERMINATOR.length };
}

function sanitizeCurrentDirOscPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return undefined;
  }
  return trimmed.length > MAX_CWD_TRACKING_BUFFER_LENGTH ? undefined : trimmed;
}

function trailingPotentialCurrentDirOscPrefix(buffer: string): string {
  const maxLength = Math.min(buffer.length, CURRENT_DIR_OSC_PREFIX.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    const tail = buffer.slice(-length);
    if (CURRENT_DIR_OSC_PREFIX.startsWith(tail)) {
      return tail;
    }
  }
  return "";
}

function limitCwdTrackingBuffer(buffer: string): string {
  if (buffer.length <= MAX_CWD_TRACKING_BUFFER_LENGTH) {
    return buffer;
  }
  return buffer.slice(-MAX_CWD_TRACKING_BUFFER_LENGTH);
}

export function stateLabel(state: ConnectionState) {
  if (state === "connected") {
    return "已连接";
  }
  if (state === "closed") {
    return "已结束";
  }
  if (state === "disconnected") {
    return "已断开";
  }
  if (state === "error") {
    return "异常";
  }
  return "连接中";
}

export function buildTerminalCreateRequest(
  request: TerminalCreateRequest,
): TerminalCreateRequest {
  return {
    cols: request.cols,
    rows: request.rows,
    ...(request.shell ? { shell: request.shell } : {}),
    ...(request.args && request.args.length > 0 ? { args: request.args } : {}),
    ...(request.cwd ? { cwd: request.cwd } : {}),
    ...(request.env && Object.keys(request.env).length > 0
      ? { env: request.env }
      : {}),
  };
}

export function formatLogPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pasteIntoTerminal(
  terminal: XtermTerminal | null,
  sessionId: string | null,
) {
  const text = await navigator.clipboard?.readText?.();
  if (!text) {
    return;
  }

  if (typeof terminal?.paste === "function") {
    terminal.paste(text);
    return;
  }

  if (sessionId) {
    await writeTerminal(sessionId, text);
  }
}

export function clampMenuPosition(x: number, y: number): TerminalContextMenuPosition {
  if (typeof window === "undefined") {
    return { x, y };
  }

  const menuWidth = 208;
  const menuHeight = 386;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
  };
}
