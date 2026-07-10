import { describe, expect, it } from "vitest";
import { resolveWindowChromeModel } from "../../../src/lib/windowChromeModel";

describe("resolveWindowChromeModel", () => {
  it("disables desktop controls and IPC interactions in browser preview", () => {
    expect(
      resolveWindowChromeModel({
        frameState: "normal",
        platform: "browser",
      }),
    ).toEqual({
      controlMode: "none",
      frameRadiusMode: "rounded",
      reserveTrafficLightInset: false,
      showMaximizeControl: false,
      showRestoreIcon: false,
    });
  });

  it.each(["normal", "maximized"] as const)(
    "uses native macOS chrome in %s state",
    (frameState) => {
      expect(
        resolveWindowChromeModel({ frameState, platform: "macos" }),
      ).toEqual({
        controlMode: "native",
        frameRadiusMode: "native",
        reserveTrafficLightInset: true,
        showMaximizeControl: false,
        showRestoreIcon: false,
      });
    },
  );

  it("removes the macOS traffic-light inset in fullscreen", () => {
    expect(
      resolveWindowChromeModel({
        frameState: "fullscreen",
        platform: "macos",
      }),
    ).toMatchObject({
      controlMode: "native",
      frameRadiusMode: "native",
      reserveTrafficLightInset: false,
    });
  });

  it.each(["windows", "linux"] as const)(
    "uses rounded custom chrome for normal %s windows",
    (platform) => {
      expect(
        resolveWindowChromeModel({ frameState: "normal", platform }),
      ).toEqual({
        controlMode: "custom",
        frameRadiusMode: "rounded",
        reserveTrafficLightInset: false,
        showMaximizeControl: true,
        showRestoreIcon: false,
      });
    },
  );

  it.each(["windows", "linux"] as const)(
    "uses square custom chrome and a restore icon for maximized %s windows",
    (platform) => {
      expect(
        resolveWindowChromeModel({ frameState: "maximized", platform }),
      ).toEqual({
        controlMode: "custom",
        frameRadiusMode: "square",
        reserveTrafficLightInset: false,
        showMaximizeControl: true,
        showRestoreIcon: true,
      });
    },
  );

  it.each(["windows", "linux"] as const)(
    "keeps fullscreen %s frames square without custom maximize toggling",
    (platform) => {
      expect(
        resolveWindowChromeModel({ frameState: "fullscreen", platform }),
      ).toEqual({
        controlMode: "custom",
        frameRadiusMode: "square",
        reserveTrafficLightInset: false,
        showMaximizeControl: false,
        showRestoreIcon: false,
      });
    },
  );
});
