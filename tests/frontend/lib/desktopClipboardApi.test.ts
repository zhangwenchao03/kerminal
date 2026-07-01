import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  readText: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => mocks.isTauri(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: () => mocks.readText(),
  writeText: (text: string) => mocks.writeText(text),
}));

describe("desktopClipboardApi", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset();
    mocks.readText.mockReset();
    mocks.writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("reads text through the Tauri clipboard manager plugin", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.readText.mockResolvedValue("echo native\r");
    const { readDesktopClipboardText } = await import("../../../src/lib/desktopClipboardApi");

    await expect(readDesktopClipboardText()).resolves.toBe("echo native\r");

    expect(mocks.readText).toHaveBeenCalledTimes(1);
  });

  it("writes text through the Tauri clipboard manager plugin", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.writeText.mockResolvedValue(undefined);
    const { writeDesktopClipboardText } = await import("../../../src/lib/desktopClipboardApi");

    await expect(writeDesktopClipboardText("copy me")).resolves.toEqual({
      ok: true,
    });

    expect(mocks.writeText).toHaveBeenCalledWith("copy me");
  });

  it("retries transient read failures before returning text", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.readText
      .mockRejectedValueOnce(new Error("clipboard busy"))
      .mockResolvedValue("echo after retry");
    const wait = vi.fn().mockResolvedValue(undefined);
    const { readDesktopClipboardText } = await import("../../../src/lib/desktopClipboardApi");

    await expect(
      readDesktopClipboardText({ retryDelaysMs: [25], wait }),
    ).resolves.toBe("echo after retry");

    expect(mocks.readText).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it("retries transient write failures before reporting success", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.writeText
      .mockRejectedValueOnce(new Error("clipboard busy"))
      .mockRejectedValueOnce(new Error("clipboard busy"))
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const { writeDesktopClipboardText } = await import(
      "../../../src/lib/desktopClipboardApi"
    );

    await expect(
      writeDesktopClipboardText("copy me", {
        retryDelaysMs: [20, 40],
        wait,
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.writeText).toHaveBeenCalledTimes(3);
    expect(mocks.writeText).toHaveBeenLastCalledWith("copy me");
    expect(wait).toHaveBeenNthCalledWith(1, 20);
    expect(wait).toHaveBeenNthCalledWith(2, 40);
  });

  it("uses the browser clipboard outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    const readText = vi.fn().mockResolvedValue("echo browser\r");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText, writeText },
    });
    const { readDesktopClipboardText, writeDesktopClipboardText } =
      await import("../../../src/lib/desktopClipboardApi");

    await expect(readDesktopClipboardText()).resolves.toBe("echo browser\r");
    await expect(writeDesktopClipboardText("browser copy")).resolves.toEqual({
      ok: true,
    });

    expect(readText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("browser copy");
    expect(mocks.readText).not.toHaveBeenCalled();
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("does not throw when reading is unavailable or fails", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.readText.mockRejectedValue(new Error("clipboard denied"));
    const { readDesktopClipboardText } = await import("../../../src/lib/desktopClipboardApi");

    await expect(readDesktopClipboardText()).resolves.toBe("");
  });

  it("reports write transport errors without throwing", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.writeText.mockRejectedValue(new Error("clipboard denied"));
    const { writeDesktopClipboardText } = await import("../../../src/lib/desktopClipboardApi");

    await expect(
      writeDesktopClipboardText("copy me", { retryDelaysMs: [] }),
    ).resolves.toEqual({ ok: false, reason: "transport-error" });
  });

  it("reports unavailable browser clipboard writes", async () => {
    mocks.isTauri.mockReturnValue(false);
    const { writeDesktopClipboardText } = await import("../../../src/lib/desktopClipboardApi");

    await expect(writeDesktopClipboardText("copy me")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
