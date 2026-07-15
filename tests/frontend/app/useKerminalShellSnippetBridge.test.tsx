import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SNIPPET_PANEL_OPEN_EVENT } from "../../../src/features/snippets/snippetPanelEvents";
import { useKerminalShellSnippetBridge } from "../../../src/app/useKerminalShellSnippetBridge";

describe("useKerminalShellSnippetBridge", () => {
  it("聚焦请求 pane 并打开片段工具", () => {
    const activateTool = vi.fn();
    const focusPane = vi.fn();
    renderHook(() =>
      useKerminalShellSnippetBridge({ activateTool, focusPane }),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SNIPPET_PANEL_OPEN_EVENT, {
          detail: { paneId: "pane-1", snippetId: "snippet-1" },
        }),
      );
    });

    expect(focusPane).toHaveBeenCalledWith("pane-1");
    expect(activateTool).toHaveBeenCalledWith("snippets");
  });

  it("忽略无效请求并在卸载后释放监听", () => {
    const activateTool = vi.fn();
    const focusPane = vi.fn();
    const { unmount } = renderHook(() =>
      useKerminalShellSnippetBridge({ activateTool, focusPane }),
    );

    act(() => window.dispatchEvent(new CustomEvent(SNIPPET_PANEL_OPEN_EVENT)));
    unmount();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SNIPPET_PANEL_OPEN_EVENT, {
          detail: { snippetId: "snippet-1" },
        }),
      );
    });

    expect(focusPane).not.toHaveBeenCalled();
    expect(activateTool).not.toHaveBeenCalled();
  });
});
