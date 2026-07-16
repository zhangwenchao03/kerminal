import type { IMarker } from "@xterm/xterm";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";

const GOLDEN_ANGLE_DEGREES = 137.508;
const MAX_IMAGE_TEXT_LINES = 160;
const MAX_IMAGE_LINE_LENGTH = 120;
const OSC_SEQUENCE_RE = new RegExp(
  String.raw`\x1B\][^\x07]*(?:\x07|\x1B\\)`,
  "g",
);
const ANSI_ESCAPE_RE = new RegExp(
  String.raw`\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`,
  "g",
);
const C0_CONTROL_RE = new RegExp(
  String.raw`[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]`,
  "g",
);
export const COMMAND_BLOCK_OUTPUT_MAX_CHARS = 128_000;
export const COMMAND_BLOCKS_MAX_COUNT = 240;
const INTERACTIVE_TUI_COMMAND_RE =
  /(?:^|[/\\\s])(codex|claude|vim|nvim|vi|nano|less|more|man|top|htop|btop|tmux)(?:\.(?:cmd|exe|ps1))?(?:\s|$)/i;

type TerminalBufferKind = "normal" | "alternate";

export interface TerminalCommandBlock {
  collapsed: boolean;
  color: string;
  command: string;
  createdAt: number;
  endMarker: TerminalCommandBlockMarker | null;
  id: string;
  marker: TerminalCommandBlockMarker;
  output: string;
  submitted: boolean;
}

export type TerminalCommandBlockMarker = Pick<
  IMarker,
  "dispose" | "isDisposed" | "line" | "onDispose"
>;

export interface TerminalCommandBlockLayoutInput {
  activeBufferType: TerminalBufferKind;
  bufferLength: number;
  cols: number;
  contentBottomLine?: number;
  promptLine?: number;
  rowHeight: number;
  rows: number;
  viewportY: number;
}

export interface TerminalCommandBlockView {
  collapsed: boolean;
  color: string;
  command: string;
  endLine: number;
  height: number;
  hiddenLineCount: number;
  id: string;
  lineCount: number;
  muted: boolean;
  originalTop: number;
  rowHeight: number;
  startLine: number;
  top: number;
  viewportY: number;
  visibleEndLine: number;
  visibleStartLine: number;
  current?: boolean;
  virtual?: boolean;
}

export type CommandBlockImageCopyResult = "image" | "text";

export function commandBlockColor(index: number) {
  const hue = ((index * GOLDEN_ANGLE_DEGREES) % 360 + 360) % 360;
  return `hsl(${Math.round(hue)} 78% 58%)`;
}

export function createTerminalCommandBlock(params: {
  command: string;
  id: string;
  index: number;
  marker: TerminalCommandBlockMarker;
  submitted?: boolean;
}): TerminalCommandBlock {
  return {
    collapsed: false,
    color: commandBlockColor(params.index),
    command: params.command,
    createdAt: Date.now(),
    endMarker: null,
    id: params.id,
    marker: params.marker,
    output: "",
    submitted: params.submitted ?? true,
  };
}

export function buildTerminalCommandBlockViews(
  blocks: TerminalCommandBlock[],
  layout: TerminalCommandBlockLayoutInput,
): TerminalCommandBlockView[] {
  if (
    layout.activeBufferType === "alternate" ||
    layout.rows <= 0 ||
    layout.rowHeight <= 0 ||
    layout.bufferLength <= 0
  ) {
    return [];
  }

  const visibleTop = layout.viewportY;
  const visibleBottom = layout.viewportY + layout.rows - 1;
  const sortedBlocks = [...blocks]
    .filter((block) => markerIsLive(block.marker))
    .sort(
      (left, right) =>
        left.marker.line - right.marker.line || left.createdAt - right.createdAt,
    );
  if (hasRunningInteractiveTuiCommand(sortedBlocks)) {
    return [];
  }
  const hasPromptBlock =
    typeof layout.promptLine === "number" &&
    sortedBlocks.some(
      (block) =>
        markerIsLive(block.marker) &&
        !block.endMarker &&
        block.marker.line === layout.promptLine,
    );
  const latestBlock = sortedBlocks[sortedBlocks.length - 1];
  const trailingPromptLine =
    typeof layout.promptLine === "number" &&
    !hasPromptBlock
      ? layout.promptLine
      : undefined;
  const blocksForLayout = sortedBlocks;
  const layoutBlocks: Array<{
    block?: TerminalCommandBlock;
    collapsed: boolean;
    color: string;
    command: string;
    endLine?: number;
    id: string;
    startLine: number;
    current?: boolean;
    virtual?: boolean;
  }> = blocksForLayout.map((block) => {
    const markerLine = block.marker.line;
    const endMarkerLine = markerEndLine(block);
    return {
      block,
      collapsed: block.collapsed,
      color: block.color,
      command: block.command,
      current: !block.submitted && !block.endMarker,
      endLine: endMarkerLine,
      id: block.id,
      startLine: markerLine,
    };
  });
  if (typeof trailingPromptLine === "number") {
    layoutBlocks.push({
      collapsed: false,
      color: commandBlockColor(blocksForLayout.length),
      command: "",
      current: true,
      id: latestBlock ? `${latestBlock.id}-current-prompt` : "current-prompt",
      startLine: trailingPromptLine,
      virtual: true,
    });
  }

  const views: TerminalCommandBlockView[] = [];
  let foldedHiddenLinesBefore = 0;

  for (const [index, layoutBlock] of layoutBlocks.entries()) {
    const { block, startLine } = layoutBlock;
    const nextStartLine = layoutBlocks[index + 1]?.startLine;
    const isLastBlock = typeof nextStartLine !== "number";
    const estimatedEndLine =
      startLine +
      (block ? estimateTerminalCommandBlockLineCount(block, layout.cols) : 1) -
      1;
    const contentEndLine =
      typeof layoutBlock.endLine === "number"
        ? layoutBlock.endLine
        : block &&
            isLastBlock &&
            typeof layout.contentBottomLine === "number" &&
            layout.contentBottomLine >= startLine
          ? layout.contentBottomLine
          : estimatedEndLine;
    const endLine = Math.max(
      startLine,
      Math.min(
        layout.bufferLength - 1,
        typeof nextStartLine === "number" ? nextStartLine - 1 : contentEndLine,
      ),
    );

    if (endLine < visibleTop || startLine > visibleBottom) {
      continue;
    }

    const visibleStartLine = Math.max(startLine, visibleTop);
    const visibleEndLine = Math.min(endLine, visibleBottom);
    const visibleLineCount = Math.max(1, visibleEndLine - visibleStartLine + 1);
    const originalTop = (visibleStartLine - visibleTop) * layout.rowHeight;
    const top = originalTop - foldedHiddenLinesBefore * layout.rowHeight;
    const expandedHeight = Math.max(
      layout.rowHeight,
      visibleLineCount * layout.rowHeight,
    );
    const collapsedHeight = layout.rowHeight;
    const hiddenLineCount = layoutBlock.collapsed
      ? Math.max(0, visibleLineCount - 1)
      : 0;

    views.push({
      collapsed: layoutBlock.collapsed,
      color: layoutBlock.color,
      command: layoutBlock.command,
      endLine,
      height: layoutBlock.collapsed ? collapsedHeight : expandedHeight,
      hiddenLineCount,
      id: layoutBlock.id,
      lineCount: endLine - startLine + 1,
      muted: false,
      originalTop,
      rowHeight: layout.rowHeight,
      startLine,
      top,
      viewportY: layout.viewportY,
      visibleEndLine,
      visibleStartLine,
      current: layoutBlock.current,
      virtual: layoutBlock.virtual,
    });

    foldedHiddenLinesBefore += hiddenLineCount;
  }

  return views.filter((view) => view.top + view.height > 0);
}

function hasRunningInteractiveTuiCommand(
  blocks: TerminalCommandBlock[],
): boolean {
  let hasSeenInteractiveTuiCommand = false;
  for (const block of blocks) {
    if (
      block.submitted &&
      INTERACTIVE_TUI_COMMAND_RE.test(block.command.trim())
    ) {
      if (!block.endMarker) {
        return true;
      }
      hasSeenInteractiveTuiCommand = true;
      continue;
    }
    if (hasSeenInteractiveTuiCommand && !block.submitted && !block.endMarker) {
      return true;
    }
  }
  return false;
}

export function appendCommandBlockOutput(
  blocks: TerminalCommandBlock[],
  data: string,
) {
  if (!data || blocks.length === 0) {
    return;
  }
  const block = blocks[blocks.length - 1];
  if (block.endMarker) {
    return;
  }
  if (!block.submitted) {
    return;
  }
  if (block.command === "") {
    return;
  }
  block.output = appendCommandBlockOutputTail(block.output, data);
}

export function terminalCommandBlockPlainText(block: TerminalCommandBlock) {
  return cleanTerminalText(`$ ${block.command}\n${block.output}`).trimEnd();
}

export async function copyTerminalCommandBlockAsImage(
  block: TerminalCommandBlock,
  theme: "dark" | "light",
): Promise<CommandBlockImageCopyResult> {
  const text = terminalCommandBlockPlainText(block);
  const clipboard = navigator.clipboard;
  if (
    !clipboard ||
    typeof clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    const result = await writeDesktopClipboardText(text);
    if (!result.ok) {
      throw new Error("当前环境不支持复制到剪贴板。");
    }
    return "text";
  }

  const blob = await renderCommandBlockImageBlob(block, theme);
  await clipboard.write([new ClipboardItem({ "image/png": blob })]);
  return "image";
}

export function commandBlockViewsEqual(
  left: TerminalCommandBlockView[],
  right: TerminalCommandBlockView[],
) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    return (
      other &&
      item.id === other.id &&
      item.collapsed === other.collapsed &&
      item.command === other.command &&
      item.color === other.color &&
      item.endLine === other.endLine &&
      item.height === other.height &&
      item.hiddenLineCount === other.hiddenLineCount &&
      item.lineCount === other.lineCount &&
      item.muted === other.muted &&
      item.originalTop === other.originalTop &&
      item.rowHeight === other.rowHeight &&
      item.startLine === other.startLine &&
      item.top === other.top &&
      item.viewportY === other.viewportY &&
      item.visibleEndLine === other.visibleEndLine &&
      item.visibleStartLine === other.visibleStartLine &&
      item.current === other.current &&
      item.virtual === other.virtual
    );
  });
}

function markerIsLive(marker: TerminalCommandBlockMarker) {
  return !marker.isDisposed && marker.line >= 0;
}

function markerEndLine(block: TerminalCommandBlock) {
  const endMarker = block.endMarker;
  if (!endMarker || !markerIsLive(endMarker)) {
    return undefined;
  }
  return Math.max(block.marker.line, endMarker.line);
}

function estimateTerminalCommandBlockLineCount(
  block: TerminalCommandBlock,
  cols: number,
) {
  return Math.max(
    1,
    estimateTerminalTextRows(`$ ${block.command}`, cols) +
      estimateTerminalTextRows(block.output, cols),
  );
}

function trimCommandBlockOutputTail(output: string) {
  if (output.length <= COMMAND_BLOCK_OUTPUT_MAX_CHARS) {
    return output;
  }

  let startIndex = output.length - COMMAND_BLOCK_OUTPUT_MAX_CHARS;
  const firstCodeUnit = output.charCodeAt(startIndex);
  const previousCodeUnit = output.charCodeAt(startIndex - 1);
  if (
    firstCodeUnit >= 0xdc00 &&
    firstCodeUnit <= 0xdfff &&
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff
  ) {
    startIndex += 1;
  }
  return output.slice(startIndex);
}

function appendCommandBlockOutputTail(output: string, data: string) {
  const tailWindowLength = COMMAND_BLOCK_OUTPUT_MAX_CHARS + 1;
  const currentTailBudget = Math.max(0, tailWindowLength - data.length);
  const candidate =
    currentTailBudget === 0
      ? data.slice(-tailWindowLength)
      : output.slice(-currentTailBudget) + data;
  return trimCommandBlockOutputTail(candidate);
}

function estimateTerminalTextRows(text: string, cols: number) {
  if (!text) {
    return 0;
  }

  const width = Math.max(1, Math.floor(cols));
  const lines = cleanTerminalText(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.reduce((total, line) => {
    const length = Array.from(line || " ").length;
    return total + Math.max(1, Math.ceil(length / width));
  }, 0);
}

function cleanTerminalText(text: string) {
  return text
    .replace(OSC_SEQUENCE_RE, "")
    .replace(ANSI_ESCAPE_RE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n\t]+$/gm, "")
    .replace(C0_CONTROL_RE, "");
}

async function renderCommandBlockImageBlob(
  block: TerminalCommandBlock,
  theme: "dark" | "light",
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable");
  }

  const lines = wrapImageLines(terminalCommandBlockPlainText(block));
  const scale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const padding = 20;
  const railWidth = 6;
  const lineHeight = 20;
  const font = '13px "JetBrains Mono", "SF Mono", "Cascadia Code", Consolas, monospace';
  context.font = font;

  const textWidth = Math.min(
    1040,
    Math.max(
      360,
      ...lines.map((line) => Math.ceil(context.measureText(line || " ").width)),
    ),
  );
  const width = padding * 2 + railWidth + 14 + textWidth;
  const height = padding * 2 + Math.max(1, lines.length) * lineHeight;
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(scale, scale);

  const isDark = theme === "dark";
  context.fillStyle = isDark ? "#111113" : "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = block.color;
  roundRect(context, padding, padding, railWidth, height - padding * 2, 999);
  context.fill();

  context.font = font;
  context.fillStyle = isDark ? "#f4f4f5" : "#18181b";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillText(line || " ", padding + railWidth + 14, padding + index * lineHeight);
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
        return;
      }
      reject(new Error("Failed to render command block image"));
    }, "image/png");
  });
  return blob;
}

function wrapImageLines(text: string) {
  const sourceLines = text.split("\n").slice(0, MAX_IMAGE_TEXT_LINES);
  const wrapped: string[] = [];
  for (const line of sourceLines) {
    if (line.length <= MAX_IMAGE_LINE_LENGTH) {
      wrapped.push(line);
      continue;
    }
    for (let index = 0; index < line.length; index += MAX_IMAGE_LINE_LENGTH) {
      wrapped.push(line.slice(index, index + MAX_IMAGE_LINE_LENGTH));
      if (wrapped.length >= MAX_IMAGE_TEXT_LINES) {
        return wrapped;
      }
    }
  }
  return wrapped.length > 0 ? wrapped : [""];
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const cappedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + cappedRadius, y);
  context.lineTo(x + width - cappedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + cappedRadius);
  context.lineTo(x + width, y + height - cappedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - cappedRadius, y + height);
  context.lineTo(x + cappedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - cappedRadius);
  context.lineTo(x, y + cappedRadius);
  context.quadraticCurveTo(x, y, x + cappedRadius, y);
  context.closePath();
}
