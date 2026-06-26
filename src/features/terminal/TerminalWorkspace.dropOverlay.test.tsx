import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { batchPanes, batchTabs, workspaceProps } from "./__tests__/support/TerminalWorkspace.testSupport";

vi.mock("../../components/ui/resizable", () => ({
  ResizableHandle: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div aria-label={ariaLabel} role="separator" />
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./XtermPane", () => ({
  XtermPane: ({ title }: { title: string }) => (
    <div aria-label={`${title} xterm 终端`} />
  ),
}));

describe("TerminalWorkspace split drop overlay", () => {
  it("shows the active terminal split drop zone without shifting content", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          panes: batchPanes,
          splitDropIndicator: {
            machineName: "生产 SSH",
            zone: "right",
          },
          tabs: batchTabs,
        })}
      />,
    );

    expect(
      screen.getByRole("status", { name: "主机分屏拖放目标：右侧" }),
    ).toHaveTextContent("分屏到右侧 · 生产 SSH");
    expect(screen.getByLabelText("SSH 批量 xterm 终端")).toBeInTheDocument();
  });

  it("submits pane move drops from the titlebar drag handle", async () => {
    const onMovePane = vi.fn();
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          onMovePane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-terminal-pane-card]"),
    );
    vi.spyOn(cards[0], "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(cards[1], "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 300,
      left: 400,
      right: 800,
      top: 0,
      width: 400,
      x: 400,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "拖动 本地批量 分屏调整位置",
      }),
      { clientX: 20, clientY: 20, pointerId: 7 },
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "拖动 本地批量 分屏调整位置",
        }),
      ).toBeInTheDocument(),
    );
    fireEvent.pointerMove(window, { clientX: 620, clientY: 150, pointerId: 7 });

    expect(await screen.findByText("交换位置 · SSH 批量")).toBeInTheDocument();

    fireEvent.pointerUp(window, { clientX: 620, clientY: 150, pointerId: 7 });

    expect(onMovePane).toHaveBeenCalledWith(
      "pane-batch-local",
      "pane-batch-ssh",
      "center",
    );
  });
});
