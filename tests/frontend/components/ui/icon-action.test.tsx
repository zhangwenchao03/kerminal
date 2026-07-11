import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RefreshCw } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { IconAction } from "../../../../src/components/ui/icon-action";

describe("IconAction", () => {
  it("provides a stable accessible name and tooltip", () => {
    render(
      <IconAction
        icon={RefreshCw}
        label="刷新主机"
        tooltip="重新读取主机状态"
      />,
    );

    const button = screen.getByRole("button", { name: "刷新主机" });
    expect(button).toHaveAttribute("title", "重新读取主机状态");
  });

  it("keeps disabled reasons keyboard reachable without activating", async () => {
    const onClick = vi.fn();
    render(
      <IconAction
        disabled
        disabledReason="请先选择主机"
        icon={RefreshCw}
        label="刷新主机"
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "刷新主机" });
    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("请先选择主机");
    expect(button).toHaveAttribute("title", "请先选择主机");
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("announces loading and prevents duplicate activation", () => {
    render(<IconAction icon={RefreshCw} label="刷新主机" loading />);

    const button = screen.getByRole("button", { name: "刷新主机" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("allows domain controls to keep a stable icon size", () => {
    render(
      <IconAction
        icon={RefreshCw}
        iconClassName="h-3.5 w-3.5"
        label="刷新主机"
      />,
    );

    expect(
      screen.getByRole("button", { name: "刷新主机" }).querySelector("svg"),
    ).toHaveClass("h-3.5", "w-3.5");
  });
});
