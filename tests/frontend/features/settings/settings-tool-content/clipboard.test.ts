import { beforeEach, describe, expect, it, vi } from "vitest";

const writeDesktopClipboardTextMock = vi.fn();

vi.mock("../../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (text: string) =>
    writeDesktopClipboardTextMock(text),
}));

describe("settings clipboard helper", () => {
  beforeEach(() => {
    writeDesktopClipboardTextMock.mockReset();
  });

  it("writes text through the desktop clipboard facade", async () => {
    writeDesktopClipboardTextMock.mockResolvedValue({ ok: true });
    const { writeTextToClipboard } = await import("../../../../../src/features/settings/settings-tool-content/clipboard");

    await expect(writeTextToClipboard("mcp json")).resolves.toBeUndefined();

    expect(writeDesktopClipboardTextMock).toHaveBeenCalledWith("mcp json");
  });

  it("keeps the existing throwing contract when clipboard writes fail", async () => {
    writeDesktopClipboardTextMock.mockResolvedValue({
      ok: false,
      reason: "transport-error",
    });
    const { writeTextToClipboard } = await import("../../../../../src/features/settings/settings-tool-content/clipboard");

    await expect(writeTextToClipboard("mcp json")).rejects.toThrow(
      "Clipboard write failed: transport-error",
    );
  });
});
