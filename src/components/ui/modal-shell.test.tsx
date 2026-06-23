import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModalShell } from "./modal-shell";

describe("ModalShell", () => {
  it("applies fixed preset dimensions to default dialogs", () => {
    render(
      <ModalShell onClose={vi.fn()} open size="small" title="固定尺寸">
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "固定尺寸" });

    expect(dialog).toHaveClass("h-[min(24rem,calc(100vh-48px))]");
    expect(dialog).toHaveClass("max-w-lg");
  });

  it("keeps the fixed height when callers customize only the width", () => {
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

    expect(dialog).toHaveClass("h-[min(44rem,calc(100vh-48px))]");
    expect(dialog).toHaveClass("max-w-4xl");
  });

  it("does not override explicit panel heights", () => {
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
    expect(dialog).not.toHaveClass("h-[min(44rem,calc(100vh-48px))]");
  });
});
