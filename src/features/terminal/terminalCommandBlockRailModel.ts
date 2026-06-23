import type { TerminalCommandBlockView } from "./terminalCommandBlocks";

export interface CommandBlockMenuPosition {
  x: number;
  y: number;
}

export interface CommandBlockMenuClampOptions {
  inset?: number;
  menuHeight?: number;
  menuWidth?: number;
  viewportHeight?: number;
  viewportWidth?: number;
}

export interface TerminalCommandBlockMarkerModel {
  ariaLabel: string;
  canOpenMenu: boolean;
  canToggle: boolean;
  commandLabel: string;
  icon: "collapsed" | "expanded" | null;
  isCurrent: boolean;
  title: string;
}

export interface TerminalCommandBlockFoldSummaryView {
  ariaLabel: string;
  height: number;
  id: string;
  lineCount: number;
  top: number;
}

const DEFAULT_COMMAND_BLOCK_MENU_WIDTH = 160;
const DEFAULT_COMMAND_BLOCK_MENU_HEIGHT = 76;
const DEFAULT_COMMAND_BLOCK_MENU_INSET = 8;

export function resolveTerminalCommandBlockMarkerModel(
  block: TerminalCommandBlockView,
): TerminalCommandBlockMarkerModel {
  const isCurrent = Boolean(block.current || block.virtual);
  const commandLabel = isCurrent ? "当前命令行" : block.command || "空命令";
  const canToggle = !isCurrent;

  return {
    ariaLabel: isCurrent
      ? `当前命令行色条 ${commandLabel}`
      : `${block.collapsed ? "展开" : "折叠"}命令块 ${commandLabel}`,
    canOpenMenu: !isCurrent,
    canToggle,
    commandLabel,
    icon: isCurrent ? null : block.collapsed ? "collapsed" : "expanded",
    isCurrent,
    title: isCurrent
      ? "当前等待输入的命令行"
      : `${block.collapsed ? "展开" : "折叠"}命令块：${commandLabel}；右键复制`,
  };
}

export function resolveTerminalCommandBlockFoldSummaries(
  blocks: TerminalCommandBlockView[],
): TerminalCommandBlockFoldSummaryView[] {
  return blocks
    .filter((block) => block.collapsed && !block.muted)
    .map((block) => ({
      ariaLabel: `命令块 ${block.command || "空命令"} 折叠摘要 ${block.lineCount} 行`,
      height: block.height,
      id: block.id,
      lineCount: block.lineCount,
      top: block.top,
    }));
}

export function clampCommandBlockMenuPosition(
  x: number,
  y: number,
  options: CommandBlockMenuClampOptions = {},
): CommandBlockMenuPosition {
  const {
    inset = DEFAULT_COMMAND_BLOCK_MENU_INSET,
    menuHeight = DEFAULT_COMMAND_BLOCK_MENU_HEIGHT,
    menuWidth = DEFAULT_COMMAND_BLOCK_MENU_WIDTH,
    viewportHeight,
    viewportWidth,
  } = options;

  if (
    typeof viewportWidth !== "number" ||
    typeof viewportHeight !== "number"
  ) {
    return { x, y };
  }

  return {
    x: Math.max(inset, Math.min(x, viewportWidth - menuWidth - inset)),
    y: Math.max(inset, Math.min(y, viewportHeight - menuHeight - inset)),
  };
}
