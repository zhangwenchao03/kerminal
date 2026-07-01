import { describe, expect, it } from "vitest";
import { resolveShellLayout } from "../../../src/app/KerminalShell.helpers.tsx";

describe("resolveShellLayout", () => {
  it("fully removes the left sidebar column when collapsed", () => {
    const layout = resolveShellLayout({
      activeToolOpen: false,
      leftPanelCollapsed: true,
      leftPanelWidth: 280,
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(true);
    expect(layout.leftPanelColumnWidth).toBe(0);
    expect(layout.gridTemplateColumns).toBe(
      "0px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("keeps the left sidebar column on wide expanded layouts", () => {
    const layout = resolveShellLayout({
      activeToolOpen: true,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(false);
    expect(layout.leftPanelColumnWidth).toBe(280);
    expect(layout.gridTemplateColumns).toBe(
      "280px 8px minmax(0, 1fr) 8px 320px",
    );
  });
});
