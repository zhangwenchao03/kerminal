// @author kongweiguang

import { useRef, useState } from "react";
import { TerminalSuggestionMenu } from "./TerminalSuggestionMenu";
import type { TerminalSuggestionMenuIntent } from "./terminalSuggestionMenuModel";
import type { XtermPaneSuggestionMenuView } from "./XtermPane.ghostSuggestions";
import type { XtermPaneSuggestionMenuRuntimeParams } from "./XtermPane.runtime.types";

/**
 * 隔离候选菜单的 React 状态与渲染，让 XtermPane 只传递薄 runtime 参数。
 */
export function useXtermPaneSuggestionMenu() {
  const suggestionMenuIntentRef =
    useRef<((intent: TerminalSuggestionMenuIntent) => boolean) | null>(null);
  const [suggestionMenu, setSuggestionMenu] =
    useState<XtermPaneSuggestionMenuView | null>(null);

  return {
    overlay: suggestionMenu ? (
      <TerminalSuggestionMenu
        {...suggestionMenu}
        onIntent={(intent) => suggestionMenuIntentRef.current?.(intent)}
      />
    ) : null,
    runtimeParams: {
      setSuggestionMenu,
      suggestionMenuIntentRef,
    } satisfies XtermPaneSuggestionMenuRuntimeParams,
  };
}
