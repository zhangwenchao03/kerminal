// @author kongweiguang

export type TerminalSuggestionMenuPlacement = "above" | "below";

export interface TerminalSuggestionMenuAnchor {
  height: number;
  x: number;
  y: number;
}

export interface TerminalSuggestionMenuSize {
  height: number;
  width: number;
}

export interface TerminalSuggestionPaneSize {
  height: number;
  width: number;
}

export interface TerminalSuggestionMenuPosition {
  left: number;
  maxHeight: number;
  placement: TerminalSuggestionMenuPlacement;
  top: number;
  width: number;
}

export interface ResolveTerminalSuggestionMenuPositionInput {
  anchor: TerminalSuggestionMenuAnchor;
  devicePixelRatio?: number;
  gap?: number;
  menuSize: TerminalSuggestionMenuSize;
  panePadding?: number;
  paneSize: TerminalSuggestionPaneSize;
}

const DEFAULT_GAP = 6;
const DEFAULT_PANE_PADDING = 8;
const MIN_MENU_HEIGHT = 96;
const MIN_MENU_WIDTH = 180;
const PREFERRED_MENU_WIDTH = 420;

/**
 * 定位只使用 pane 局部坐标，并按设备像素取整，避免高 DPI 下边框与文字发虚。
 */
export function resolveTerminalSuggestionMenuPosition({
  anchor,
  devicePixelRatio = 1,
  gap = DEFAULT_GAP,
  menuSize,
  panePadding = DEFAULT_PANE_PADDING,
  paneSize,
}: ResolveTerminalSuggestionMenuPositionInput): TerminalSuggestionMenuPosition {
  const ratio = positive(devicePixelRatio, 1);
  const padding = clamp(panePadding, 0, Math.max(0, paneSize.width / 2));
  const availableWidth = Math.max(0, paneSize.width - padding * 2);
  const width = Math.min(
    availableWidth,
    Math.max(
      Math.min(MIN_MENU_WIDTH, availableWidth),
      Math.min(PREFERRED_MENU_WIDTH, menuSize.width || PREFERRED_MENU_WIDTH),
    ),
  );
  const left = clamp(anchor.x, padding, Math.max(padding, paneSize.width - padding - width));
  const spaceBelow = paneSize.height - padding - (anchor.y + anchor.height) - gap;
  const spaceAbove = anchor.y - padding - gap;
  const placement: TerminalSuggestionMenuPlacement =
    spaceBelow >= Math.min(menuSize.height, MIN_MENU_HEIGHT) ||
    spaceBelow >= spaceAbove
      ? "below"
      : "above";
  const availableHeight = Math.max(
    0,
    placement === "below" ? spaceBelow : spaceAbove,
  );
  const renderedHeight = Math.min(menuSize.height, availableHeight);
  const top =
    placement === "below"
      ? anchor.y + anchor.height + gap
      : anchor.y - gap - renderedHeight;

  return {
    left: alignToDevicePixel(left, ratio),
    maxHeight: alignToDevicePixel(availableHeight, ratio),
    placement,
    top: alignToDevicePixel(clamp(top, padding, paneSize.height - padding), ratio),
    width: alignToDevicePixel(width, ratio),
  };
}

export function alignToDevicePixel(value: number, devicePixelRatio = 1) {
  const ratio = positive(devicePixelRatio, 1);
  return Math.round(value * ratio) / ratio;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
