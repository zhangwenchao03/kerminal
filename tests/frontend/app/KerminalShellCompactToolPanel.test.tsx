import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  KerminalShellNotices,
  ShellCompactToolPanel,
} from "../../../src/app/KerminalShell.view";

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

  it("uses the shared overlay, dialog and material contracts", () => {
    render(
      <ShellCompactToolPanel onClose={vi.fn()}>
        <button aria-pressed="true" type="button">
          当前工具
        </button>
      </ShellCompactToolPanel>,
    );

    expect(screen.getByRole("button", { name: "关闭紧凑工具面板" })).toHaveClass(
      "kerminal-layer-overlay",
    );
    expect(screen.getByRole("dialog", { name: "紧凑工具面板" })).toHaveClass(
      "kerminal-floating-surface",
      "kerminal-layer-dialog",
      "rounded-[var(--radius-panel)]",
    );
  });
});

describe("KerminalShellNotices", () => {
  it("renders a quiet semantic toast and keeps dismissal behavior", async () => {
    const user = userEvent.setup();
    const onConfigNoticeDismiss = vi.fn();

    render(
      <KerminalShellNotices
        configNotice={{
          batchId: "batch-1",
          domains: ["settings"],
          id: "notice-1",
          level: "info",
          text: "设置已在外部更新。",
          ttlMs: 3_000,
        }}
        onConfigNoticeDismiss={onConfigNoticeDismiss}
        onShellNoticeDismiss={vi.fn()}
        shellNoticeVisible={false}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass(
      "kerminal-floating-surface",
      "text-[var(--text-primary)]",
    );
    expect(notice).not.toHaveClass("font-mono");
    expect(notice.parentElement).toHaveClass("kerminal-layer-toast");

    await user.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(onConfigNoticeDismiss).toHaveBeenCalledTimes(1);
  });
});
