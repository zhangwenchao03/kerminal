import { isTauri } from "@tauri-apps/api/core";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { writeDesktopClipboardText } from "../../../lib/desktopClipboardApi";
import type {
  SftpDragDropPayload,
  SftpSelectionEvent,
} from "./types";

export function clampContextMenuPosition(x: number, y: number) {
  const padding = 8;
  const menuWidth = 224;
  const menuHeight = 360;
  const maxX = Math.max(padding, window.innerWidth - menuWidth - padding);
  const maxY = Math.max(padding, window.innerHeight - menuHeight - padding);
  return {
    x: Math.min(Math.max(padding, x), maxX),
    y: Math.min(Math.max(padding, y), maxY),
  };
}

export const isRunningInTauriWebview = () => {
  return (
    isTauri() ||
    Boolean(
      (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    )
  );
};

export const unwrapDragDropPayload = (event: unknown): SftpDragDropPayload => {
  const payload = (event as { payload?: unknown }).payload;
  if (isDragDropPayload(payload)) {
    return payload;
  }
  const nestedPayload = (payload as { payload?: unknown } | undefined)?.payload;
  if (isDragDropPayload(nestedPayload)) {
    return nestedPayload;
  }
  return { type: "leave" };
};

export const isDragDropPayload = (value: unknown): value is SftpDragDropPayload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === "enter" || type === "over" || type === "drop" || type === "leave"
  );
};

export const isDragPositionInsideDropZone = (
  payload: SftpDragDropPayload,
  element: HTMLElement | null,
) => {
  if (!element || !("position" in payload)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const { x, y } = payload.position;
  if (isPointInsideRect(x, y, rect)) {
    return true;
  }

  const scale = window.devicePixelRatio || 1;
  return scale !== 1 && isPointInsideRect(x / scale, y / scale, rect);
};

export const isPointInsideRect = (x: number, y: number, rect: DOMRect) => {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

export const isFileManagerShortcut = (event: ReactKeyboardEvent<HTMLElement>) => {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
};

export const isExtendedSelectionEvent = (event: SftpSelectionEvent) => {
  return event.ctrlKey || event.metaKey || event.shiftKey;
};

export const isEditableKeyboardTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
};

export const writeClipboardText = async (value: string) => {
  const result = await writeDesktopClipboardText(value);
  if (!result.ok) {
    throw new Error("当前环境不支持复制到剪贴板。");
  }
};
