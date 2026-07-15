import { useEffect } from "react";

import {
  SNIPPET_PANEL_OPEN_EVENT,
  type SnippetPanelOpenRequest,
} from "../features/snippets/snippetPanelEvents";
import type { ToolId } from "../features/workspace/types";

interface UseKerminalShellSnippetBridgeOptions {
  activateTool: (toolId: ToolId) => void;
  focusPane: (paneId: string) => void;
}

/** 将终端片段打开事件桥接到主壳导航，并在卸载时释放全局监听。 */
export function useKerminalShellSnippetBridge({
  activateTool,
  focusPane,
}: UseKerminalShellSnippetBridgeOptions) {
  useEffect(() => {
    const handleSnippetPanelOpen = (event: Event) => {
      const request = (event as CustomEvent<SnippetPanelOpenRequest>).detail;
      if (!request?.snippetId) return;
      if (request.paneId) focusPane(request.paneId);
      activateTool("snippets");
    };

    window.addEventListener(SNIPPET_PANEL_OPEN_EVENT, handleSnippetPanelOpen);
    return () =>
      window.removeEventListener(
        SNIPPET_PANEL_OPEN_EVENT,
        handleSnippetPanelOpen,
      );
  }, [activateTool, focusPane]);
}
