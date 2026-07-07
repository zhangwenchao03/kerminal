import { describe, expect, it } from "vitest";
import { buildTerminalRendererStatusView } from "../../../../../src/features/settings/settings-tool-content/terminal-renderer-status";
import type { TerminalRendererRegistrySnapshot } from "../../../../../src/features/terminal/terminalRendererRegistry";

describe("terminal-renderer-status", () => {
  it("summarizes active GPU renderer state", () => {
    expect(
      buildTerminalRendererStatusView(snapshot({ effectiveGpuPanes: 2 })),
    ).toEqual({
      badgeLabel: "运行正常",
      detail: "2 个 GPU pane，atlas 0",
      tone: "normal",
    });
  });

  it("includes recovery counts and atlas epoch", () => {
    expect(
      buildTerminalRendererStatusView(
        snapshot({ atlasEpoch: 3, recoveryCount: 2 }),
      ),
    ).toEqual({
      badgeLabel: "运行正常",
      detail: "1 个 GPU pane，已恢复 2 次，atlas 3",
      tone: "normal",
    });
  });

  it("surfaces fallback reason as a settings warning", () => {
    expect(
      buildTerminalRendererStatusView(
        snapshot({
          panes: [
            {
              backend: "cpu",
              canvasCount: 0,
              failureCount: 1,
              fallbackReason: "atlas-clear-failed",
              focused: true,
              paneId: "pane-1",
              recoveryCount: 0,
              visible: true,
            },
          ],
        }),
      ),
    ).toEqual({
      badgeLabel: "自动回退",
      detail: "atlas 0，最近回退：atlas-clear-failed",
      tone: "warning",
    });
  });
});

function snapshot(
  overrides: Partial<TerminalRendererRegistrySnapshot> = {},
): TerminalRendererRegistrySnapshot {
  return {
    activeControllers: 1,
    atlasEpoch: 0,
    effectiveGpuPanes: 1,
    hiddenControllers: 0,
    panes: [
      {
        backend: "gpu",
        canvasCount: 1,
        failureCount: 0,
        focused: true,
        paneId: "pane-1",
        recoveryCount: 0,
        visible: true,
      },
    ],
    recoveryCount: 0,
    requestedMode: "auto",
    webglCanvasCount: 1,
    ...overrides,
  };
}
