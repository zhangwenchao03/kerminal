import { describe, expect, it } from "vitest";
import {
  readXtermPanePromptSource,
  registerXtermPanePromptSource,
} from "../../../../src/features/terminal/XtermPane.promptSourceRegistry";

describe("XtermPane prompt source registry", () => {
  it("只按 pane id 读取瞬时 selection 和最新命令块", () => {
    const unregister = registerXtermPanePromptSource("pane-1", {
      read: () => ({
        commandBlockText: "npm test\npassed",
        paneId: "pane-1",
        selectedText: "selected body",
      }),
    });

    expect(readXtermPanePromptSource("pane-1")).toEqual({
      commandBlockText: "npm test\npassed",
      paneId: "pane-1",
      selectedText: "selected body",
    });
    expect(readXtermPanePromptSource("pane-2")).toBeNull();

    unregister();
    expect(readXtermPanePromptSource("pane-1")).toBeNull();
  });

  it("拒绝读取器返回的错配 pane", () => {
    const unregister = registerXtermPanePromptSource("pane-1", {
      read: () => ({ paneId: "pane-other", selectedText: "secret" }),
    });
    expect(readXtermPanePromptSource("pane-1")).toBeNull();
    unregister();
  });
});
