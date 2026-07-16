import { useEffect, useRef, type RefObject } from "react";

export interface WorkspacePaletteFocusOptions {
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
}

function isRestorableFocusTarget(
  target: Element | null,
): target is HTMLElement {
  return target instanceof HTMLElement && target.isConnected;
}

function focusFirstPaletteControl(input: HTMLInputElement | null) {
  input?.focus({ preventScroll: true });
}

/**
 * 管理 Palette 的焦点所有权和全局监听器。
 *
 * 打开时记录来源焦点并将焦点交给查询框；关闭或卸载时仅在来源节点仍连接
 * 文档时恢复焦点，避免对已销毁 tab/pane 调用 focus。Escape 使用捕获阶段，
 * 可在终端或其它全局快捷键之前消费，同时尊重 IME composition。
 */
export function useWorkspacePaletteFocus({
  inputRef,
  onClose,
  open,
  panelRef,
}: WorkspacePaletteFocusOptions) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const originFocus = document.activeElement;
    focusFirstPaletteControl(inputRef.current);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.isComposing) {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", keepFocusInside, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", keepFocusInside, true);
      if (isRestorableFocusTarget(originFocus)) {
        originFocus.focus({ preventScroll: true });
      }
    };
  }, [inputRef, open, panelRef]);
}
