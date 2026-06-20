import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTerminalPaneSession,
  registerTerminalPaneSession,
  resetTerminalPaneSessionsForTests,
  updateTerminalPaneSessionCwd,
  unregisterTerminalPaneSession,
  writeBroadcastCommand,
  writePaneCommand,
  writeSnippetCommand,
  writeWorkflowCommand,
} from "./terminalSessionRegistry";

const writeTerminalMock = vi.hoisted(() => vi.fn());
const recordCommandHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/terminalApi", () => ({
  writeTerminal: (...args: unknown[]) => writeTerminalMock(...args),
}));

vi.mock("../../lib/commandHistoryApi", () => ({
  recordCommandHistory: (...args: unknown[]) =>
    recordCommandHistoryMock(...args),
}));

describe("terminalSessionRegistry", () => {
  beforeEach(() => {
    resetTerminalPaneSessionsForTests();
    writeTerminalMock.mockReset();
    recordCommandHistoryMock.mockReset();
  });

  it("registers, writes and unregisters pane sessions", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      profileId: "profile-a",
      shell: "pwsh.exe",
      target: "local",
    });
    registerTerminalPaneSession("pane-b", "session-b", {
      remoteHostId: "host-b",
      target: "ssh",
    });

    const result = await writeBroadcastCommand({
      command: "uptime",
      data: "uptime\r",
      targetPaneIds: ["pane-a", "pane-missing", "pane-b"],
    });

    expect(writeTerminalMock).toHaveBeenNthCalledWith(1, "session-a", "uptime\r");
    expect(writeTerminalMock).toHaveBeenNthCalledWith(2, "session-b", "uptime\r");
    expect(result.sentPaneIds).toEqual(["pane-a", "pane-b"]);
    expect(result.missingPaneIds).toEqual(["pane-missing"]);
    expect(recordCommandHistoryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "uptime",
        paneId: "pane-a",
        profileId: "profile-a",
        sessionId: "session-a",
        source: "broadcast",
        target: "local",
      }),
    );
    expect(recordCommandHistoryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: "uptime",
        paneId: "pane-b",
        remoteHostId: "host-b",
        sessionId: "session-b",
        source: "broadcast",
        target: "ssh",
      }),
    );

    unregisterTerminalPaneSession("pane-a", "session-a");
    expect(getTerminalPaneSession("pane-a")).toBeUndefined();
  });

  it("does not unregister a newer session with a stale session id", () => {
    registerTerminalPaneSession("pane-a", "session-old");
    registerTerminalPaneSession("pane-a", "session-new");

    unregisterTerminalPaneSession("pane-a", "session-old");

    expect(getTerminalPaneSession("pane-a")).toBe("session-new");
  });

  it("updates a registered pane session cwd for later command history", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "/srv/app",
      remoteHostId: "host-a",
      target: "ssh",
    });

    updateTerminalPaneSessionCwd("pane-a", "/srv/app/releases");
    await writePaneCommand({
      command: "ls",
      paneId: "pane-a",
      source: "tool",
    });

    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "ls",
        cwd: "/srv/app/releases",
        remoteHostId: "host-a",
        target: "ssh",
      }),
    );
  });

  it("writes a snippet command to one pane and records snippet history", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "C:/dev/rust/kerminal",
      profileId: "profile-a",
      shell: "pwsh.exe",
      target: "local",
    });

    const result = await writeSnippetCommand({
      command: " git status --short ",
      paneId: "pane-a",
      tabId: "tab-a",
    });

    expect(result).toEqual({
      paneId: "pane-a",
      sent: true,
      sessionId: "session-a",
      target: "local",
    });
    expect(writeTerminalMock).toHaveBeenCalledWith(
      "session-a",
      "git status --short\r",
    );
    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "git status --short",
        cwd: "C:/dev/rust/kerminal",
        paneId: "pane-a",
        profileId: "profile-a",
        sessionId: "session-a",
        shell: "pwsh.exe",
        source: "snippet",
        tabId: "tab-a",
        target: "local",
      }),
    );
  });

  it("writes workflow commands through the generic pane writer", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "C:/dev/rust/kerminal",
      profileId: "profile-a",
      shell: "pwsh.exe",
      target: "local",
    });

    const result = await writeWorkflowCommand({
      command: " npm run check ",
      paneId: "pane-a",
      tabId: "tab-a",
    });

    expect(result).toEqual({
      paneId: "pane-a",
      sent: true,
      sessionId: "session-a",
      target: "local",
    });
    expect(writeTerminalMock).toHaveBeenCalledWith(
      "session-a",
      "npm run check\r",
    );
    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "npm run check",
        paneId: "pane-a",
        source: "workflow",
        tabId: "tab-a",
        target: "local",
      }),
    );
  });

  it("allows internal tools to use the generic pane writer", async () => {
    registerTerminalPaneSession("pane-a", "session-a");

    await writePaneCommand({
      command: "clear",
      paneId: "pane-a",
      source: "tool",
    });

    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "clear",
        source: "tool",
      }),
    );
  });

  it("reports missing snippet target sessions without writing", async () => {
    const result = await writeSnippetCommand({
      command: "uptime",
      paneId: "pane-missing",
    });

    expect(result).toEqual({
      paneId: "pane-missing",
      reason: "missing-session",
      sent: false,
    });
    expect(writeTerminalMock).not.toHaveBeenCalled();
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });
});
