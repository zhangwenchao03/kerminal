import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalNewOutputButton } from "../../../../src/features/terminal/TerminalNewOutputButton";

describe("TerminalNewOutputButton", () => {
  it("exposes a keyboard-accessible jump-to-latest command", () => {
    const onClick = vi.fn();
    render(<TerminalNewOutputButton onClick={onClick} />);

    const button = screen.getByRole("button", {
      name: "滚动到最新输出",
    });
    expect(button).toHaveTextContent("新输出");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
