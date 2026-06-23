import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../settings/settingsModel";
import type { TerminalPane } from "../workspace/types";
import { baseTerminalPane } from "./TerminalWorkspace.testSupport";
import { TerminalPaneCard } from "./TerminalPaneCard";

const xtermPaneMock = vi.hoisted(() => ({
  renderCount: 0,
}));

vi.mock("./XtermPane", () => ({
  XtermPane: ({
    onCurrentCwdChange,
    onOutputHistoryChange,
    onSplitPane,
    title,
  }: {
    onCurrentCwdChange?: (cwd: string) => void;
    onOutputHistoryChange?: (outputHistory: string | undefined) => void;
    onSplitPane?: (direction: "horizontal" | "vertical") => void;
    title: string;
  }) => {
    xtermPaneMock.renderCount += 1;

    return (
      <div aria-label={`${title} xterm 终端`}>
        <button onClick={() => onCurrentCwdChange?.("C:\\repo")} type="button">
          上报 cwd
        </button>
        <button
          onClick={() => onOutputHistoryChange?.("history")}
          type="button"
        >
          上报输出
        </button>
        <button onClick={() => onSplitPane?.("vertical")} type="button">
          垂直分屏
        </button>
      </div>
    );
  },
}));

function renderPaneCard(
  pane: TerminalPane,
  overrides: Partial<Parameters<typeof TerminalPaneCard>[0]> = {},
) {
  return render(
    <TerminalPaneCard
      focused={false}
      onClosePane={vi.fn()}
      onFocusPane={vi.fn()}
      pane={pane}
      resolvedTheme="dark"
      terminalAppearance={defaultAppSettings.terminal}
      {...overrides}
    />,
  );
}

describe("TerminalPaneCard", () => {
  beforeEach(() => {
    xtermPaneMock.renderCount = 0;
  });

  it("renders runtime panes through XtermPane and forwards pane-scoped callbacks", async () => {
    const user = userEvent.setup();
    const onCurrentCwdChange = vi.fn();
    const onOutputHistoryChange = vi.fn();
    const onSplitPane = vi.fn();
    const sshPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-ssh",
      latencyMs: 42,
      mode: "ssh",
      remoteHostId: "host-prod",
      title: "prod-api",
    };

    renderPaneCard(sshPane, {
      onCurrentCwdChange,
      onOutputHistoryChange,
      onSplitPane,
    });

    expect(screen.getByLabelText("prod-api xterm 终端")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上报 cwd" }));
    await user.click(screen.getByRole("button", { name: "上报输出" }));
    await user.click(screen.getByRole("button", { name: "垂直分屏" }));

    expect(onCurrentCwdChange).toHaveBeenCalledWith("pane-ssh", "C:\\repo");
    expect(onOutputHistoryChange).toHaveBeenCalledWith("pane-ssh", "history");
    expect(onSplitPane).toHaveBeenCalledWith("vertical");
  });

  it("renders preview panes without mounting the xterm runtime", () => {
    renderPaneCard({
      ...baseTerminalPane,
      id: "pane-preview",
      lines: ["第一行", "第二行"],
      mode: "preview",
      prompt: "ERR>",
      title: "诊断输出",
    });

    expect(screen.getByLabelText("诊断输出 终端分屏")).toBeInTheDocument();
    expect(screen.getByText("第一行")).toBeInTheDocument();
    expect(screen.getByText("第二行")).toBeInTheDocument();
    expect(screen.getByText("ERR>")).toBeInTheDocument();
    expect(screen.queryByLabelText("诊断输出 xterm 终端")).not.toBeInTheDocument();
    expect(xtermPaneMock.renderCount).toBe(0);
  });

  it("focuses the pane from the card shell but keeps close clicks isolated", async () => {
    const user = userEvent.setup();
    const onClosePane = vi.fn();
    const onFocusPane = vi.fn();

    renderPaneCard(baseTerminalPane, { onClosePane, onFocusPane });

    await user.click(screen.getByLabelText("本地 PowerShell 终端分屏"));
    expect(onFocusPane).toHaveBeenCalledWith("pane-local");

    onFocusPane.mockClear();
    await user.click(
      screen.getByRole("button", { name: "关闭 本地 PowerShell 分屏" }),
    );

    expect(onClosePane).toHaveBeenCalledWith("pane-local");
    expect(onFocusPane).not.toHaveBeenCalled();
  });
});
