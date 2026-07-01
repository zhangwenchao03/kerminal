import { describe, expect, it } from "vitest";
import { resolveAgentTerminalViewportStatus } from "../../../../../src/features/tool-panel/agent-launcher/agentTerminalViewportModel";

describe("agentTerminalViewportModel", () => {
  it("waits for a measured terminal before warning", () => {
    expect(resolveAgentTerminalViewportStatus(null)).toEqual({
      currentLabel: null,
      minLabel: "80x24",
      tooSmall: false,
    });
  });

  it("warns below the minimum viewport", () => {
    expect(resolveAgentTerminalViewportStatus({ cols: 79, rows: 24 })).toEqual({
      currentLabel: "79x24",
      minLabel: "80x24",
      tooSmall: true,
    });
    expect(resolveAgentTerminalViewportStatus({ cols: 80, rows: 23 })).toEqual({
      currentLabel: "80x23",
      minLabel: "80x24",
      tooSmall: true,
    });
  });

  it("accepts 80x24 and larger terminal viewports", () => {
    expect(resolveAgentTerminalViewportStatus({ cols: 80, rows: 24 })).toEqual({
      currentLabel: "80x24",
      minLabel: "80x24",
      tooSmall: false,
    });
    expect(resolveAgentTerminalViewportStatus({ cols: 100, rows: 30 })).toEqual({
      currentLabel: "100x30",
      minLabel: "80x24",
      tooSmall: false,
    });
  });
});
