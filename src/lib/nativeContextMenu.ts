import { isTauri } from "@tauri-apps/api/core";

interface NativeContextMenuOptions {
  enabled?: boolean;
  target?: EventTarget;
}

export function shouldDisableNativeContextMenu() {
  return import.meta.env.PROD && isTauri();
}

export function disableNativeContextMenu({
  enabled = shouldDisableNativeContextMenu(),
  target = window,
}: NativeContextMenuOptions = {}) {
  if (!enabled) {
    return () => undefined;
  }

  const preventNativeContextMenu = (event: Event) => {
    event.preventDefault();
  };

  target.addEventListener("contextmenu", preventNativeContextMenu, {
    capture: true,
  });

  return () => {
    target.removeEventListener("contextmenu", preventNativeContextMenu, {
      capture: true,
    });
  };
}
