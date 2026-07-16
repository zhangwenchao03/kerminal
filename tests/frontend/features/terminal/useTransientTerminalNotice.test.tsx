import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTransientTerminalNotice } from "../../../../src/features/terminal/useTransientTerminalNotice";

function NoticeHarness() {
  const [notice, setNotice] = useTransientTerminalNotice(1_000);

  return (
    <>
      <button type="button" onClick={() => setNotice("命令块已展开")}>
        显示提示
      </button>
      {notice ? <div role="status">{notice}</div> : null}
    </>
  );
}

describe("useTransientTerminalNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("自动隐藏提示，并在连续触发相同文案时重新计时", () => {
    vi.useFakeTimers();
    render(<NoticeHarness />);

    fireEvent.click(screen.getByRole("button", { name: "显示提示" }));
    expect(screen.getByRole("status")).toHaveTextContent("命令块已展开");

    act(() => {
      vi.advanceTimersByTime(750);
    });
    fireEvent.click(screen.getByRole("button", { name: "显示提示" }));
    act(() => {
      vi.advanceTimersByTime(750);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
