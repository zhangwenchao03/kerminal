import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopNotificationTransport } from "../../../src/lib/desktopNotificationApi";

const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => isTauriMock(),
}));

function createTransport(): DesktopNotificationTransport {
  return {
    isPermissionGranted: vi.fn().mockResolvedValue(true),
    requestPermission: vi.fn().mockResolvedValue("granted"),
    sendNotification: vi.fn(),
  };
}

describe("desktopNotificationApi", () => {
  beforeEach(() => {
    isTauriMock.mockReset();
  });

  it("is a no-op in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const { sendDesktopNotification } = await import("../../../src/lib/desktopNotificationApi");

    const result = await sendDesktopNotification({
      event: { kind: "updater.available", version: "0.2.0" },
      settings: { enabled: true },
      visibility: "hidden",
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("not-tauri");
  });

  it("sends through an injected transport when policy allows it", async () => {
    const transport = createTransport();
    const lastSentAtByKey: Record<string, number | undefined> = {};
    const { sendDesktopNotification } = await import("../../../src/lib/desktopNotificationApi");

    const result = await sendDesktopNotification({
      event: { kind: "updater.available", version: "0.2.0" },
      lastSentAtByKey,
      nowMs: 1234,
      settings: { enabled: true },
      transport,
      visibility: "hidden",
    });

    expect(result.sent).toBe(true);
    expect(result.reason).toBe("will-send");
    expect(transport.sendNotification).toHaveBeenCalledWith({
      body: "Version 0.2.0 is available.",
      title: "Kerminal update available",
    });
    expect(lastSentAtByKey["updater.available:0.2.0"]).toBe(1234);
  });

  it("requests permission for an important background event before sending", async () => {
    const transport = createTransport();
    vi.mocked(transport.isPermissionGranted).mockResolvedValue(false);
    vi.mocked(transport.requestPermission).mockResolvedValue("granted");
    const { sendDesktopNotification } = await import("../../../src/lib/desktopNotificationApi");

    const result = await sendDesktopNotification({
      event: { failedCount: 2, kind: "sftp.transfer.failed" },
      settings: { enabled: true },
      transport,
      visibility: "background",
    });

    expect(result.sent).toBe(true);
    expect(result.requestedPermission).toBe(true);
    expect(transport.requestPermission).toHaveBeenCalledTimes(1);
    expect(transport.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("does not send when permission request is denied", async () => {
    const transport = createTransport();
    vi.mocked(transport.isPermissionGranted).mockResolvedValue(false);
    vi.mocked(transport.requestPermission).mockResolvedValue("denied");
    const { sendDesktopNotification } = await import("../../../src/lib/desktopNotificationApi");

    const result = await sendDesktopNotification({
      event: { failedCount: 2, kind: "sftp.transfer.failed" },
      settings: { enabled: true },
      transport,
      visibility: "background",
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("permission-denied");
    expect(transport.sendNotification).not.toHaveBeenCalled();
  });

  it("turns transport failures into non-throwing results", async () => {
    const transport = createTransport();
    vi.mocked(transport.sendNotification).mockImplementation(() => {
      throw new Error("notification failed");
    });
    const { sendDesktopNotification } = await import("../../../src/lib/desktopNotificationApi");

    const result = await sendDesktopNotification({
      event: { kind: "updater.available", version: "0.2.0" },
      settings: { enabled: true },
      transport,
      visibility: "hidden",
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("transport-error");
  });

  it("maps browser visibility to desktop notification visibility", async () => {
    const { currentDesktopNotificationVisibility } = await import(
      "../../../src/lib/desktopNotificationApi"
    );

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    expect(currentDesktopNotificationVisibility()).toBe("hidden");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    expect(currentDesktopNotificationVisibility()).toBe("foreground");
  });
});
