import { describe, expect, it } from "vitest";
import type { TmuxSessionSummary, TmuxTargetRef } from "../../../../../src/lib/tmuxApi";
import { buildTmuxAttachCommand } from "../../../../../src/features/tool-panel/tmux/tmuxCommandModel";

const session: TmuxSessionSummary = {
  attached: false,
  clients: 0,
  id: "$1",
  name: "work",
  status: "running",
  targetRef: "ssh:prod",
  windows: 1,
};

describe("tmuxCommandModel", () => {
  it("builds attach commands with socket name and quoted session id", () => {
    const target: TmuxTargetRef = {
      socketName: "main",
      target: { hostId: "prod", kind: "ssh" },
      tmuxPath: "/opt/bin/tmux",
    };

    expect(buildTmuxAttachCommand(target, session)).toBe(
      "/opt/bin/tmux '-L' 'main' 'attach-session' '-t' '$1'",
    );
  });

  it("quotes socket paths and session names for shell-safe attach commands", () => {
    const target: TmuxTargetRef = {
      socketPath: "/tmp/tmux'sock",
      target: { kind: "local" },
    };

    expect(
      buildTmuxAttachCommand(target, {
        ...session,
        id: "",
        name: "work'session",
      }),
    ).toBe(
      "tmux '-S' '/tmp/tmux'\\''sock' 'attach-session' '-t' 'work'\\''session'",
    );
  });
});
