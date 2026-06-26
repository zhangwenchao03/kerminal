import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "./sftpDragDropModel";

const desktopClipboardApiMock = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMock.writeDesktopClipboardText(...args),
}));

describe("sftpDragDropModel clipboard helpers", () => {
  beforeEach(() => {
    desktopClipboardApiMock.writeDesktopClipboardText.mockReset();
    desktopClipboardApiMock.writeDesktopClipboardText.mockResolvedValue({
      ok: true,
    });
  });

  it("writes remote path text through the desktop clipboard facade", async () => {
    await expect(writeClipboardText("/srv/app.log")).resolves.toBeUndefined();

    expect(
      desktopClipboardApiMock.writeDesktopClipboardText,
    ).toHaveBeenCalledWith("/srv/app.log");
  });

  it("keeps the existing throwing contract when text clipboard is unavailable", async () => {
    desktopClipboardApiMock.writeDesktopClipboardText.mockResolvedValueOnce({
      ok: false,
      reason: "unavailable",
    });

    await expect(writeClipboardText("/srv/app.log")).rejects.toThrow(
      "当前环境不支持复制到剪贴板。",
    );
  });
});
