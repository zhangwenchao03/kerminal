import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export type WindowFrameState = "fullscreen" | "maximized" | "normal";

interface WindowFrameFlags {
  fullscreen: boolean;
  maximized: boolean;
}

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

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenScale: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    const refreshFrameState = async () => {
      try {
        const [fullscreen, maximized] = await Promise.all([
          appWindow.isFullscreen(),
          appWindow.isMaximized(),
        ]);
        if (!disposed) {
          setFrameState(resolveWindowFrameState({ fullscreen, maximized }));
        }
      } catch {
        if (!disposed) {
          setFrameState("normal");
        }
      }
    };

    const refresh = () => {
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
      unlistenResize?.();
      unlistenScale?.();
      unlistenFocus?.();
    };
  }, []);

  return frameState;
}
