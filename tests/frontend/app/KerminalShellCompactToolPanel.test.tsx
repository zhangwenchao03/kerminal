import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShellCompactToolPanel } from "../../../src/app/KerminalShell.view";

describe("ShellCompactToolPanel", () => {
  it("keeps keyboard focus inside the modal drawer", async () => {
    render(
      <>
        <button type="button">抽屉外操作</button>
        <ShellCompactToolPanel onClose={vi.fn()}>
          <button aria-pressed="true" type="button">
            当前工具
          </button>
          <button type="button">最后操作</button>
        </ShellCompactToolPanel>
      </>,
    );

    const outsideButton = screen.getByRole("button", { name: "抽屉外操作" });
    const closeButton = screen.getByRole("button", { name: "关闭工具面板" });
    const currentToolButton = screen.getByRole("button", { name: "当前工具" });
    const lastButton = screen.getByRole("button", { name: "最后操作" });

    await waitFor(() => expect(currentToolButton).toHaveFocus());

    lastButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(lastButton).toHaveFocus();

    outsideButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();
  });
});
