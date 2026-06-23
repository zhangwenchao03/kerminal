import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TerminalSearchPanel } from "./TerminalSearchPanel";

function renderSearchPanel(
  overrides: Partial<Parameters<typeof TerminalSearchPanel>[0]> = {},
) {
  const props: Parameters<typeof TerminalSearchPanel>[0] = {
    caseSensitive: false,
    hasSearched: true,
    inputId: "terminal-search-input",
    onClose: vi.fn(),
    onQueryChange: vi.fn(),
    onSearchNext: vi.fn(),
    onSearchPrevious: vi.fn(),
    onToggleCaseSensitive: vi.fn(),
    query: "error",
    resultCount: 3,
    resultIndex: 1,
    ...overrides,
  };

  return {
    ...render(<TerminalSearchPanel {...props} />),
    props,
  };
}

describe("TerminalSearchPanel", () => {
  it("renders the current result model and disables navigation without a query", () => {
    renderSearchPanel({
      hasSearched: false,
      query: " ",
      resultCount: 0,
      resultIndex: -1,
    });

    expect(screen.getByText("输入关键词")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一个匹配" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一个匹配" })).toBeDisabled();
  });

  it("forwards search actions from buttons, form submit, and keyboard shortcuts", async () => {
    const user = userEvent.setup();
    const { props } = renderSearchPanel();

    expect(screen.getByText("2/3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上一个匹配" }));
    await user.click(screen.getByRole("button", { name: "下一个匹配" }));
    fireEvent.submit(screen.getByRole("form", { name: "终端搜索" }));
    fireEvent.keyDown(screen.getByLabelText("搜索终端缓冲区"), {
      key: "Enter",
      shiftKey: true,
    });
    fireEvent.keyDown(screen.getByLabelText("搜索终端缓冲区"), {
      key: "Escape",
    });

    expect(props.onSearchPrevious).toHaveBeenCalledTimes(2);
    expect(props.onSearchNext).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("marks no-match state and exposes the case-sensitive toggle state", async () => {
    const user = userEvent.setup();
    const { props } = renderSearchPanel({
      caseSensitive: true,
      resultCount: 0,
      resultIndex: -1,
    });

    expect(screen.getByText("无匹配")).toHaveClass("text-rose-500");

    const caseToggle = screen.getByRole("button", { name: "区分大小写" });
    expect(caseToggle).toHaveAttribute("aria-pressed", "true");

    await user.click(caseToggle);

    expect(props.onToggleCaseSensitive).toHaveBeenCalledTimes(1);
  });
});
