import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentSendPreviewInput,
  retainPreviewForSession,
} from "../../../../../src/features/tool-panel/agent-launcher/agentSendPreviewModel";
import { registerXtermPanePromptSource } from "../../../../../src/features/terminal/XtermPane.promptSourceRegistry";

const unregisters: Array<() => void> = [];
afterEach(() => {
  unregisters.splice(0).forEach((unregister) => unregister());
});

const activeTab = { id: "tab-1", title: "Terminal", type: "terminal" } as const;
const focusedPane = {
  cwd: "/work",
  id: "pane-1",
  machineId: "local",
  mode: "shell",
  outputHistory: "context output",
  shell: "bash",
  status: "connected",
  title: "Shell",
};
const session = {
  agentSessionId: "ags-1",
  commandLabel: "codex",
  cwd: "/agent",
  target: { paneId: "pane-1", tabId: "tab-1" },
  title: "Codex",
};

describe("Agent send preview model", () => {
  it("点击时分别构建 selection、command block 和 context", () => {
    unregisters.push(
      registerXtermPanePromptSource("pane-1", {
        read: () => ({
          commandBlockText: "npm test\npassed",
          paneId: "pane-1",
          selectedText: "selected body",
        }),
      }),
    );

    expect(
      buildAgentSendPreviewInput({
        activeTab: activeTab as never,
        focusedPane: focusedPane as never,
        session,
        source: "selection",
      })?.text,
    ).toContain("selected body");
    expect(
      buildAgentSendPreviewInput({
        activeTab: activeTab as never,
        focusedPane: focusedPane as never,
        session,
        source: "commandBlock",
      })?.text,
    ).toContain("npm test");
    expect(
      buildAgentSendPreviewInput({
        activeTab: activeTab as never,
        focusedPane: focusedPane as never,
        session,
        source: "context",
      })?.text,
    ).toContain("context output");
  });

  it("target session 与当前 tab/pane 错配时不构建正文", () => {
    expect(
      buildAgentSendPreviewInput({
        activeTab: { ...activeTab, id: "tab-other" } as never,
        focusedPane: focusedPane as never,
        session,
        source: "context",
      }),
    ).toBeNull();
  });

  it("切换 session 后不保留旧 preview", () => {
    expect(
      retainPreviewForSession(
        {
          byteLength: 6,
          createdAt: "2026-07-11T00:00:00.000Z",
          expiresAt: "2026-07-11T00:01:00.000Z",
          id: "preview-1",
          kind: "selection",
          redacted: false,
          sessionId: "ags-1",
          text: "secret",
          truncated: false,
        },
        "ags-2",
      ),
    ).toBeNull();
  });
});
