import { useEffect } from "react";
import { desktopRuntime } from "../lib/desktopRuntimeApi";

import {
  type ConfigChangeEvent,
  type ConfigRefreshCoordinator,
} from "./configRefreshCoordinator";

const CONFIG_CHANGE_EVENT_NAME = "kerminal-config-changed";

interface UseKerminalConfigEventsOptions {
  coordinator: ConfigRefreshCoordinator;
  onListenerError?: (message: string) => void;
}

export function useKerminalConfigEvents({
  coordinator,
  onListenerError,
}: UseKerminalConfigEventsOptions) {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    desktopRuntime
      .listen<ConfigChangeEvent>(CONFIG_CHANGE_EVENT_NAME, (payload) => {
        void coordinator.handleEvent(payload);
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        onListenerError?.(
          error instanceof Error ? error.message : "config watcher unavailable",
        );
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [coordinator, onListenerError]);
}
