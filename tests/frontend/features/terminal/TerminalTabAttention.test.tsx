import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalTabAttention } from "../../../../src/features/terminal/TerminalTabAttention";

describe("TerminalTabAttention", () => {
  it.each([
    ["error", "终端错误", "lucide-circle-alert"],
    ["disconnected", "连接已断开", "lucide-wifi-off"],
    ["warning", "连接警告", "lucide-triangle-alert"],
    ["bell", "终端响铃", "lucide-bell"],
    ["followPaused", "有新输出，已暂停跟随", "lucide-arrow-down-to-line"],
    ["unread", "有未读输出", "lucide-circle-dot"],
  ] as const)("renders the %s icon with an accessible label", (
    attention,
    label,
    iconClass,
  ) => {
    const { container } = render(
      <TerminalTabAttention attention={attention} />,
    );

    const status = screen.getByLabelText(label);
    const icon = container.querySelector("svg");
    expect(status).toHaveAttribute("title", label);
    expect(icon).toHaveClass(iconClass);
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a visible count while keeping one concise accessible label", () => {
    render(
      <TerminalTabAttention
        attention="error"
        count={3}
        label="3 个窗格：终端错误"
      />,
    );

    const status = screen.getByRole("status", {
      name: "3 个窗格：终端错误",
    });
    expect(status).toHaveTextContent("3");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("keeps ordinary attention quiet while retaining title and aria", () => {
    render(<TerminalTabAttention attention="warning" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("连接警告")).toHaveAttribute(
      "title",
      "连接警告",
    );
  });

  it.each([
    ["connecting", "正在连接", "lucide-loader-circle"],
    ["reconnecting", "正在重新连接", "lucide-refresh-cw"],
  ] as const)("renders static low-interruption %s progress", (
    progress,
    label,
    iconClass,
  ) => {
    const { container } = render(
      <TerminalTabAttention attention="none" progress={progress} />,
    );

    expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveClass(iconClass);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("does not let progress replace a higher attention", () => {
    render(
      <TerminalTabAttention attention="warning" progress="reconnecting" />,
    );

    expect(screen.getByLabelText("连接警告")).toBeInTheDocument();
    expect(screen.queryByLabelText("正在重新连接")).not.toBeInTheDocument();
  });

  it("renders nothing for none or normal connected presentation", () => {
    const { container, rerender } = render(
      <TerminalTabAttention attention="none" />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <TerminalTabAttention attention="none" progress="none" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
