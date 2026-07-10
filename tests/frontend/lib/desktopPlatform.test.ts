import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDesktopPlatform,
  type DesktopNavigatorInfo,
  type DesktopPlatformDependencies,
} from "../../../src/lib/desktopPlatform";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauriMocks.isTauri(),
}));

describe("resolveDesktopPlatform", () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReset();
    tauriMocks.isTauri.mockReturnValue(false);
    vi.unstubAllGlobals();
  });

  it("returns browser outside Tauri even when navigator reports macOS", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(resolveDesktopPlatform()).toBe("browser");
  });

  it.each([
    [
      "macos",
      {
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    ],
    [
      "windows",
      {
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    ],
    [
      "linux",
      {
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      },
    ],
  ] as const)(
    "resolves %s from injected Tauri navigator information",
    (expectedPlatform, navigatorInfo) => {
      expect(resolveWithNavigator(navigatorInfo)).toBe(expectedPlatform);
    },
  );

  it("prefers userAgentData platform when legacy fields are empty", () => {
    expect(
      resolveWithNavigator({
        platform: "",
        userAgent: "",
        userAgentData: { platform: "macOS" },
      }),
    ).toBe("macos");
  });

  it("uses the conservative custom-chrome fallback for unknown Tauri platforms", () => {
    expect(resolveWithNavigator(undefined)).toBe("windows");
  });
});

function resolveWithNavigator(
  navigatorInfo: DesktopNavigatorInfo | undefined,
) {
  const dependencies: DesktopPlatformDependencies = {
    getNavigator: () => navigatorInfo,
    isTauri: () => true,
  };
  return resolveDesktopPlatform(dependencies);
}
