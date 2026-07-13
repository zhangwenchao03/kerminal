import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { mocks } from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../src/features/terminal/XtermPane";
import { SNIPPET_PANEL_OPEN_EVENT } from "../../../../src/features/snippets/snippetPanelEvents";

describe("XtermPane command suggestion menu", () => {
  it("opens with Ctrl+Space, navigates, and accepts the selected candidate", async () => {
    mocks.api.listTerminalSuggestions.mockResolvedValue([
      {
        acceptBoundaries: [],
        allowedPresentations: ["menu"],
        description: "查看简短状态",
        displayText: "git status --short",
        id: "history-status",
        provider: "history",
        replacementRange: { end: 3, start: 0 },
        replacementText: "git status --short",
        score: 0.9,
        sensitivity: "normal",
        sourceId: "history-status",
        suffix: " status --short",
      },
      {
        acceptBoundaries: [],
        allowedPresentations: ["menu"],
        description: "查看最近提交",
        displayText: "git log --oneline",
        id: "history-log",
        provider: "history",
        replacementRange: { end: 3, start: 0 },
        replacementText: "git log --oneline",
        score: 0.8,
        sensitivity: "normal",
        sourceId: "history-log",
        suffix: " log --oneline",
      },
    ]);

    render(
      <XtermPane
        cwd="C:/dev/rust/kerminal"
        focused
        paneId="pane-menu"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await screen.findByText("已连接");
    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("g");
      terminal.onDataCallback?.("i");
      terminal.onDataCallback?.("t");
    });

    mocks.api.listTerminalSuggestions.mockClear();
    act(() => {
      terminal.triggerCustomKeyEvent({ ctrlKey: true, key: " " });
    });

    await waitFor(() => {
      expect(mocks.api.listTerminalSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: "git",
          limit: 8,
          mode: "menu",
        }),
      );
    });
    const menu = await screen.findByRole("listbox", {
      name: "终端命令候选",
    });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /git status --short/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    act(() => {
      terminal.triggerCustomKeyEvent({ key: "ArrowDown" });
    });
    expect(screen.getByRole("option", { name: /git log --oneline/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    mocks.api.writeTerminal.mockClear();
    act(() => {
      terminal.triggerCustomKeyEvent({ key: "Enter" });
    });
    expect(mocks.api.writeTerminal).toHaveBeenCalledWith(
      "session-1",
      " log --oneline",
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("listbox", { name: "终端命令候选" }),
      ).not.toBeInTheDocument();
    });
  });

  it("lets Tab pass through unless the setting explicitly enables the menu", async () => {
    const terminalAppearance = {
      ...defaultAppSettings.terminal,
      inlineSuggestion: {
        ...defaultAppSettings.terminal.inlineSuggestion,
        tabOpensMenu: false,
      },
    };
    render(
      <XtermPane
        focused
        paneId="pane-tab-policy"
        resolvedTheme="light"
        terminalAppearance={terminalAppearance}
        title="本地终端"
      />,
    );

    await screen.findByText("已连接");
    const terminal = mocks.terminalInstances[0];
    const result = terminal.triggerCustomKeyEvent({ key: "Tab" });

    expect(result.result).toBe(true);
    expect(mocks.api.listTerminalSuggestions).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: "menu" }),
    );
  });

  it("opens parameterized snippets from Enter and click without writing to the PTY", async () => {
    mocks.api.listTerminalSuggestions.mockResolvedValue([
      {
        acceptBoundaries: [],
        activation: "openSnippetPanel",
        allowedPresentations: ["menu"],
        candidateKind: "snippet",
        description: "填写 URL 后再决定填入或运行",
        displayText: "HTTP 响应头",
        id: "snippet-http-head",
        provider: "snippet",
        replacementRange: { end: 4, start: 0 },
        replacementText: "curl --head {{url}}",
        score: 0.9,
        sensitivity: "normal",
        sourceId: "snippet.builtin.core.http_head",
        suffix: "",
      },
    ]);
    const opened = vi.fn();
    window.addEventListener(SNIPPET_PANEL_OPEN_EVENT, opened);
    render(
      <XtermPane
        focused
        paneId="pane-snippet-menu"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地终端"
      />,
    );

    await screen.findByText("已连接");
    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("h");
      terminal.onDataCallback?.("t");
      terminal.onDataCallback?.("t");
      terminal.onDataCallback?.("p");
    });

    mocks.api.listTerminalSuggestions.mockClear();
    act(() => terminal.triggerCustomKeyEvent({ ctrlKey: true, key: " " }));
    await waitFor(() => {
      expect(mocks.api.listTerminalSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({ input: "http", mode: "menu" }),
      );
    });
    await screen.findByRole("option", { name: /HTTP 响应头/ });

    mocks.api.writeTerminal.mockClear();
    act(() => terminal.triggerCustomKeyEvent({ key: "Enter" }));
    expect(mocks.api.writeTerminal).not.toHaveBeenCalled();
    expect(opened).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          paneId: "pane-snippet-menu",
          snippetId: "snippet.builtin.core.http_head",
        }),
      }),
    );

    act(() => terminal.triggerCustomKeyEvent({ ctrlKey: true, key: " " }));
    fireEvent.click(await screen.findByRole("option", { name: /HTTP 响应头/ }));
    expect(mocks.api.writeTerminal).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledTimes(2);
    window.removeEventListener(SNIPPET_PANEL_OPEN_EVENT, opened);
  });
});
