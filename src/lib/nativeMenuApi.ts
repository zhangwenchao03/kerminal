import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const NATIVE_MENU_ACTION_EVENT = "kerminal://native-menu-action";

export const nativeMenuActions = [
  "newTerminal",
  "closeTab",
  "closePane",
  "openSettings",
  "splitHorizontal",
  "splitVertical",
  "openLogs",
  "openAgentLauncher",
  "openSystem",
  "openSftp",
  "openPorts",
  "openSnippets",
  "editUndo",
  "editRedo",
  "editCut",
  "editCopy",
  "editPaste",
  "editSelectAll",
] as const;

export type NativeMenuAction = (typeof nativeMenuActions)[number];

interface NativeMenuActionPayload {
  action: NativeMenuAction;
}

const nativeMenuActionSet = new Set<string>(nativeMenuActions);

export async function listenNativeMenuActions(
  handler: (action: NativeMenuAction) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }

  return listen<NativeMenuActionPayload>(
    NATIVE_MENU_ACTION_EVENT,
    (event) => {
      const action = event.payload?.action;
      if (isNativeMenuAction(action)) {
        handler(action);
      }
    },
  );
}

export function isNativeMenuAction(action: unknown): action is NativeMenuAction {
  return typeof action === "string" && nativeMenuActionSet.has(action);
}
