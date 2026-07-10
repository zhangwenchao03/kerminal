import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalShell } from "../../../../src/components/ui/modal-shell";

const windowChromeMocks = vi.hoisted(() => ({
  frameState: "normal" as "fullscreen" | "maximized" | "normal",
  platform: "windows" as "browser" | "linux" | "macos" | "windows",
}));

vi.mock("../../../../src/lib/desktopPlatform", () => ({
  resolveDesktopPlatform: () => windowChromeMocks.platform,
}));

vi.mock("../../../../src/lib/useTauriWindowFrameState", () => ({
  useTauriWindowFrameState: () => windowChromeMocks.frameState,
}));

describe("ModalShell", () => {
  beforeEach(() => {
    windowChromeMocks.frameState = "normal";
    windowChromeMocks.platform = "windows";
  });

  it("applies adaptive preset constraints to default dialogs", () => {
    render(
      <ModalShell onClose={vi.fn()} open size="small" title="自适应尺寸">
        <span>内容</span>
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "自适应尺寸" });

    expect(dialog).toHaveClass("max-h-[min(24rem,calc(100vh-48px))]");
    expect(dialog).not.toHaveClass("h-[min(24rem,calc(100vh-48px))]");
    expect(dialog).toHaveClass("max-w-lg");
    expect(screen.getByText("内容").parentElement).toHaveClass("flex-auto");
  });

  it("keeps the preset max height when callers customize only the width", () => {
    render(
      <ModalShell
        maxWidthClassName="max-w-4xl"
        onClose={vi.fn()}
        open
        size="large"
        title="自定义宽度"
      >
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "自定义宽度" });

    expect(dialog).toHaveClass("max-h-[min(44rem,calc(100vh-48px))]");
    expect(dialog).toHaveClass("max-w-4xl");
  });

  it("does not override explicit panel height constraints", () => {
    render(
      <ModalShell
        onClose={vi.fn()}
        open
        panelClassName="h-[min(820px,calc(100vh-48px))]"
        size="large"
        title="显式高度"
      >
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "显式高度" });

    expect(dialog).toHaveClass("h-[min(820px,calc(100vh-48px))]");
    expect(dialog).not.toHaveClass("max-h-[min(44rem,calc(100vh-48px))]");
  });

  it("keeps a Tauri-managed top drag strip outside dialog content", () => {
    render(
      <ModalShell
        layout="fullscreen"
        onClose={vi.fn()}
        open
        title="全屏工作台"
      >
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "全屏工作台" });
    const dragStrip = document.querySelector("[data-window-drag-strip]");

    expect(dragStrip).toBeInTheDocument();
    expect(dialog.contains(dragStrip)).toBe(false);
    expect(dragStrip?.parentElement).toHaveClass("pt-3");
    expect(dragStrip).toHaveAttribute("data-tauri-drag-region");

    fireEvent.doubleClick(dragStrip!);
  });
});
