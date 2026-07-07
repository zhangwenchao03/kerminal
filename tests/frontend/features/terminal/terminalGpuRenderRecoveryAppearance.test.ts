import { describe, expect, it } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { resolveTerminalAppearanceRecoveryTrigger } from "../../../../src/features/terminal/terminalGpuRenderRecoveryAppearance";

const BASE = defaultAppSettings.terminal;

describe("terminalGpuRenderRecoveryAppearance", () => {
  it("invalidates the atlas when font metrics change", () => {
    expect(
      resolveTerminalAppearanceRecoveryTrigger(BASE, {
        ...BASE,
        fontSize: BASE.fontSize + 1,
      }),
    ).toBe("font-changed");
  });

  it("refreshes when only the color scheme changes", () => {
    expect(
      resolveTerminalAppearanceRecoveryTrigger(BASE, {
        ...BASE,
        darkColorScheme: "github",
      }),
    ).toBe("theme-changed");
  });

  it("reports renderer attach and dispose transitions", () => {
    expect(
      resolveTerminalAppearanceRecoveryTrigger(
        { ...BASE, rendererType: "cpu" },
        { ...BASE, rendererType: "gpu" },
      ),
    ).toBe("renderer-attached");
    expect(
      resolveTerminalAppearanceRecoveryTrigger(
        { ...BASE, rendererType: "gpu" },
        { ...BASE, rendererType: "cpu" },
      ),
    ).toBe("renderer-disposed");
  });
});
