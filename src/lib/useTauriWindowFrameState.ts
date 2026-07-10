import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useState } from "react";

export type WindowFrameState = "fullscreen" | "maximized" | "normal";

interface WindowFrameFlags {
  fullscreen: boolean;
  maximized: boolean;
}

const INITIAL_FRAME_QUERY_RETRY_DELAYS_MS = [50, 150, 300] as const;

export function resolveWindowFrameState({
  fullscreen,
  maximized,
}: WindowFrameFlags): WindowFrameState {
  if (fullscreen) {
    return "fullscreen";
  }
  return maximized ? "maximized" : "normal";
}

export function useTauriWindowFrameState(): WindowFrameState {
  const [frameState, setFrameState] = useState<WindowFrameState>("normal");
  const [frameStateResolved, setFrameStateResolved] = useState(
    () => !isTauri(),
  );

  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const previousValue = root.getAttribute("data-window-frame-resolved");
    if (frameStateResolved) {
      root.setAttribute("data-window-frame-resolved", "true");
    } else {
      root.setAttribute("data-window-frame-resolved", "false");
    }

    return () => {
      if (previousValue === null) {
        root.removeAttribute("data-window-frame-resolved");
        return;
      }
      root.setAttribute("data-window-frame-resolved", previousValue);
    };
  }, [frameStateResolved]);

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenScale: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    let refreshSequence = 0;
    let hasTrustedFrameState = false;
    let initialRetryIndex = 0;
    let initialRetryTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshFrameState = async () => {
      const sequence = ++refreshSequence;
      try {
        const [fullscreen, maximized] = await Promise.all([
          appWindow.isFullscreen(),
          appWindow.isMaximized(),
        ]);
        if (disposed || sequence !== refreshSequence) {
          return;
        }
        setFrameState(resolveWindowFrameState({ fullscreen, maximized }));
        setFrameStateResolved(true);
        hasTrustedFrameState = true;
        initialRetryIndex = 0;
      } catch {
        if (disposed || sequence !== refreshSequence) {
          return;
        }
        if (
          hasTrustedFrameState ||
          initialRetryIndex >= INITIAL_FRAME_QUERY_RETRY_DELAYS_MS.length
        ) {
          return;
        }

        // 首次读取失败时保持无圆角安全态，并用有限重试等待原生窗口完成恢复。
        const retryDelay = INITIAL_FRAME_QUERY_RETRY_DELAYS_MS[initialRetryIndex];
        initialRetryIndex += 1;
        initialRetryTimer = setTimeout(() => {
          initialRetryTimer = undefined;
          void refreshFrameState();
        }, retryDelay);
      }
    };

    const refresh = () => {
      if (initialRetryTimer !== undefined) {
        clearTimeout(initialRetryTimer);
        initialRetryTimer = undefined;
      }
      void refreshFrameState();
    };

    refresh();

    appWindow
      .onResized(refresh)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenResize = unlisten;
      })
      .catch(() => undefined);
    appWindow
      .onScaleChanged(refresh)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenScale = unlisten;
      })
      .catch(() => undefined);
    appWindow
      .onFocusChanged((event) => {
        if (event.payload) {
          refresh();
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenFocus = unlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (initialRetryTimer !== undefined) {
        clearTimeout(initialRetryTimer);
      }
      unlistenResize?.();
      unlistenScale?.();
      unlistenFocus?.();
    };
  }, []);

  return frameState;
}
