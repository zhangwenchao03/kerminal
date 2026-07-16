import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserFacingNotice } from "../../../../src/components/ui/user-facing-notice";

const clipboard = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => clipboard);

describe("UserFacingNotice", () => {
  it("keeps technical detail collapsed until the user asks for it", () => {
    render(
      <UserFacingNotice
        message={{
          recoveryAction: "请重新连接。",
          severity: "error",
          technicalDetail: "SshAuthBroker internal detail",
          title: "需要重新认证",
        }}
      />,
    );

    expect(screen.getByText("需要重新认证")).toBeVisible();
    expect(screen.getByText("请重新连接。")).toBeVisible();
    const detail = screen.getByText("SshAuthBroker internal detail");
    expect(detail.closest("details")).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("技术详情"));

    expect(detail.closest("details")).toHaveAttribute("open");
  });

  it("copies technical detail through the desktop clipboard adapter", async () => {
    clipboard.writeDesktopClipboardText.mockResolvedValue({ ok: true });
    render(
      <UserFacingNotice
        message={{
          severity: "warning",
          technicalDetail: "diagnostic payload",
          title: "操作未完成",
        }}
      />,
    );

    fireEvent.click(screen.getByText("技术详情"));
    fireEvent.click(screen.getByRole("button", { name: "复制技术详情" }));

    await waitFor(() => {
      expect(clipboard.writeDesktopClipboardText).toHaveBeenCalledWith(
        "diagnostic payload",
      );
    });
    expect(
      screen.getByRole("button", { name: "已复制技术详情" }),
    ).toBeVisible();
  });

  it("keeps recovery controls close to the user-facing summary", () => {
    render(
      <UserFacingNotice
        message={{ severity: "error", title: "读取失败" }}
      >
        <button type="button">重试</button>
      </UserFacingNotice>,
    );

    expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
  });
});
