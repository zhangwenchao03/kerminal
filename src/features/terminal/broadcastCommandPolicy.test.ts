import { describe, expect, it } from "vitest";
import { analyzeBroadcastCommand, canBroadcastCommand } from "./broadcastCommandPolicy";

describe("broadcastCommandPolicy", () => {
  it("allows a safe command for one local target without confirmation", () => {
    const analysis = analyzeBroadcastCommand(" uptime ", [
      { mode: "local", paneId: "pane-local", title: "本地" },
    ]);

    expect(canBroadcastCommand(analysis)).toBe(true);
    expect(analysis.command).toBe("uptime");
    expect(analysis.data).toBe("uptime\r");
    expect(analysis.requiresConfirmation).toBe(false);
    expect(analysis.risks).toEqual([]);
  });

  it("requires confirmation for batch and remote targets", () => {
    const analysis = analyzeBroadcastCommand("systemctl status nginx", [
      { mode: "local", paneId: "pane-local", title: "本地" },
      { mode: "ssh", paneId: "pane-ssh", title: "远程" },
    ]);

    expect(analysis.requiresConfirmation).toBe(true);
    expect(analysis.risks).toEqual(["batch", "remote"]);
    expect(analysis.reasons).toContain("将发送到 2 个分屏");
    expect(analysis.reasons).toContain("包含远程分屏");
  });

  it("detects destructive commands", () => {
    const analysis = analyzeBroadcastCommand("rm -rf /tmp/demo", [
      { mode: "local", paneId: "pane-local", title: "本地" },
    ]);

    expect(analysis.requiresConfirmation).toBe(true);
    expect(analysis.risks).toEqual(["destructive"]);
    expect(analysis.reasons.join(" ")).toContain("rm");
  });

  it("rejects empty commands and missing targets", () => {
    expect(
      canBroadcastCommand(analyzeBroadcastCommand("   ", [
        { mode: "local", paneId: "pane-local", title: "本地" },
      ])),
    ).toBe(false);
    expect(canBroadcastCommand(analyzeBroadcastCommand("uptime", []))).toBe(false);
  });
});
