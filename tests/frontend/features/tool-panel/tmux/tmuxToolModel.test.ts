import { describe, expect, it } from "vitest";
import type { Machine, TerminalPane, TerminalTab } from "../../../../../src/features/workspace/types";
import {
  defaultTmuxSessionName,
  findTmuxAttachPane,
  resolveTmuxTarget,
  sortTmuxSessions,
  upsertTmuxSession,
} from "../../../../../src/features/tool-panel/tmux/tmuxToolModel";

const sshMachine: Machine = {
  description: "deploy@prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  status: "online",
  tags: ["ssh"],
};

const localMachine: Machine = {
  description: "本地",
  id: "local-main",
  kind: "local",
  name: "PowerShell",
  status: "online",
  tags: ["local"],
};

const activeTab: TerminalTab = {
  id: "tab-prod",
  layout: { type: "pane", paneId: "pane-prod" },
  machineId: "prod-api",
  title: "prod api",
};

describe("tmuxToolModel", () => {
  it("resolves target by focused pane, active tab machine, then selected machine", () => {
    const focusedPane: TerminalPane = {
      id: "pane-local",
      lines: [],
      machineId: "local-main",
      mode: "local",
      prompt: "PS>",
      status: "online",
      target: { kind: "local" },
      title: "local",
    };

    expect(
      resolveTmuxTarget({
        activeMachine: sshMachine,
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toMatchObject({
      source: "focusedPane",
      status: "ready",
      target: { target: { kind: "local" } },
    });

    expect(
      resolveTmuxTarget({
        activeMachine: sshMachine,
        activeTab,
        selectedMachine: localMachine,
      }),
    ).toMatchObject({
      source: "activeTab",
      status: "ready",
      target: { target: { hostId: "prod-api", kind: "ssh" } },
    });

    expect(
      resolveTmuxTarget({ selectedMachine: localMachine }),
    ).toMatchObject({
      source: "selectedMachine",
      status: "ready",
      target: { target: { kind: "local" } },
    });
  });

  it("sorts current and attached sessions before recent sessions", () => {
    const sessions = [
      {
        activityAt: 30,
        attached: false,
        clients: 0,
        id: "$2",
        name: "recent",
        status: "running" as const,
        targetRef: "ssh:prod-api",
        windows: 1,
      },
      {
        activityAt: 10,
        attached: true,
        clients: 1,
        id: "$1",
        name: "attached",
        status: "running" as const,
        targetRef: "ssh:prod-api",
        windows: 1,
      },
      {
        activityAt: 1,
        attached: false,
        clients: 0,
        id: "$0",
        name: "current",
        status: "running" as const,
        targetRef: "ssh:prod-api",
        windows: 1,
      },
    ];

    expect(
      sortTmuxSessions(sessions, {
        attachedAt: "1",
        sessionId: "$0",
        sessionName: "current",
        targetRef: "ssh:prod-api",
      }).map((session) => session.name),
    ).toEqual(["current", "attached", "recent"]);
  });

  it("upserts a recovered create result without duplicating the session", () => {
    const existing = {
      activityAt: 1,
      attached: false,
      clients: 0,
      id: "124_70_71_166-root-retry",
      name: "124_70_71_166-root-retry",
      status: "running" as const,
      targetRef: "ssh:prod-api",
      windows: 1,
    };
    const refreshed = {
      ...existing,
      id: "$9",
      windows: 2,
    };

    expect(upsertTmuxSession([existing], refreshed)).toEqual([refreshed]);
    expect(
      upsertTmuxSession([existing], {
        ...refreshed,
        id: "$10",
        name: "another-session",
      }),
    ).toHaveLength(2);
    expect(
      upsertTmuxSession([existing], {
        ...refreshed,
        id: existing.id,
        targetRef: "ssh:staging-api",
      }),
    ).toHaveLength(2);
  });

  it("builds stable default names and finds existing attach panes", () => {
    expect(
      defaultTmuxSessionName({
        cwd: "/srv/my api",
        now: new Date(2026, 5, 25, 3, 4, 5),
      }),
    ).toBe("my-api-20260625-030405");
    expect(
      defaultTmuxSessionName({
        now: new Date(2026, 6, 13, 19, 22, 15),
        targetLabel: "124.70.71.166 (root)",
      }),
    ).toBe("124_70_71_166-root-20260713-192215");

    const pane = {
      id: "pane-tmux",
      lines: [],
      machineId: "prod-api",
      mode: "ssh" as const,
      prompt: "$",
      status: "online" as const,
      title: "tmux: api",
      tmuxBinding: {
        attachedAt: "1",
        sessionId: "$0",
        sessionName: "api",
        targetRef: "ssh:prod-api",
      },
    };

    expect(
      findTmuxAttachPane([pane], {
        attached: false,
        clients: 0,
        id: "$0",
        name: "api",
        status: "running",
        targetRef: "ssh:prod-api",
        windows: 1,
      }),
    ).toBe(pane);
  });
});
