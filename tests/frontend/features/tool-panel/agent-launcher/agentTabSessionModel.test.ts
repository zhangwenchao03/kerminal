import { describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "../../../../../src/lib/agentLauncherApi";
import {
  agentSessionRecordIds,
  agentSessionRecordTabId,
  agentSessionTabId,
  findRunningSessionForTabAgent,
  restorableSessionsForTab,
  tabRemovedCleanupPlan,
  visibleAgentSessionForTab,
  type AgentSidebarSessionState,
  type AgentSidebarTabSession,
} from "../../../../../src/features/tool-panel/agent-launcher/agentTabSessionModel";

function sidebarSession(
  overrides: Partial<AgentSidebarTabSession> = {},
): AgentSidebarTabSession {
  return {
    agentId: "codex",
    agentSessionId: "ags-tab-a-codex",
    permissionMode: "default",
    status: "running",
    tabId: "tab-a",
    target: { paneId: "pane-a", tabId: "tab-a" },
    ...overrides,
  };
}

function state(
  sessions: AgentSidebarTabSession[],
  activeSessionIdByTabId: Record<string, string | undefined>,
): AgentSidebarSessionState {
  return {
    activeSessionIdByTabId,
    sessionsById: Object.fromEntries(
      sessions.map((session) => [session.agentSessionId, session]),
    ),
    viewByTabId: {},
  };
}

function record(
  agentSessionId: string,
  tabId: string | undefined,
  status: AgentSessionRecord["session"]["status"] = "active",
): AgentSessionRecord {
  return {
    session: {
      agentId: "codex",
      agentSessionId,
      launch: {
        args: [],
        cwd: `C:/Users/me/.kerminal/agents/sessions/${agentSessionId}`,
        shell: "codex",
      },
      status,
      target: tabId ? { paneId: `pane-${tabId}`, tabId } : undefined,
      title: "Codex",
    },
  };
}

describe("agentTabSessionModel", () => {
  it("resolves the tab scope from the persisted target before the registry field", () => {
    expect(
      agentSessionTabId(
        sidebarSession({
          tabId: "registry-tab",
          target: { tabId: "target-tab" },
        }),
      ),
    ).toBe("target-tab");
    expect(agentSessionTabId(sidebarSession({ target: undefined }))).toBe(
      "tab-a",
    );
  });

  it("returns only the visible session for the active tab mapping", () => {
    const sessionA = sidebarSession();
    const sessionB = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([sessionA, sessionB], {
      "tab-a": sessionA.agentSessionId,
      "tab-b": sessionB.agentSessionId,
    });

    expect(visibleAgentSessionForTab(model, "tab-a")).toBe(sessionA);
    expect(visibleAgentSessionForTab(model, "tab-b")).toBe(sessionB);
    expect(visibleAgentSessionForTab(model, "tab-c")).toBeUndefined();
  });

  it("does not show a session when the mapping points across tab boundaries", () => {
    const sessionB = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([sessionB], {
      "tab-a": sessionB.agentSessionId,
    });

    expect(visibleAgentSessionForTab(model, "tab-a")).toBeUndefined();
  });

  it("finds reusable running sessions only inside the same tab and launch mode", () => {
    const tabACodex = sidebarSession();
    const tabBCodex = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const tabAClaude = sidebarSession({
      agentId: "claude",
      agentSessionId: "ags-tab-a-claude",
    });
    const model = state([tabACodex, tabBCodex, tabAClaude], {});

    expect(
      findRunningSessionForTabAgent(model, "tab-a", "codex", "default"),
    ).toBe(tabACodex);
    expect(
      findRunningSessionForTabAgent(model, "tab-b", "codex", "default"),
    ).toBe(tabBCodex);
    expect(
      findRunningSessionForTabAgent(model, "tab-a", "claude", "default"),
    ).toBe(tabAClaude);
    expect(
      findRunningSessionForTabAgent(model, "tab-a", "codex", "skipPermissions"),
    ).toBeUndefined();
  });

  it("matches custom commands without crossing tabs", () => {
    const tabACustom = sidebarSession({
      agentId: "custom",
      agentSessionId: "ags-tab-a-custom",
      customCommand: " qwen --fast ",
    });
    const tabBCustom = sidebarSession({
      agentId: "custom",
      agentSessionId: "ags-tab-b-custom",
      customCommand: "qwen --fast",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([tabACustom, tabBCustom], {});

    expect(
      findRunningSessionForTabAgent(
        model,
        "tab-a",
        "custom",
        "default",
        "qwen --fast",
      ),
    ).toBe(tabACustom);
    expect(
      findRunningSessionForTabAgent(
        model,
        "tab-a",
        "custom",
        "default",
        "qwen --slow",
      ),
    ).toBeUndefined();
  });

  it("plans cleanup for sessions whose tabs were removed", () => {
    const tabA = sidebarSession();
    const tabB = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([tabA, tabB], {});

    expect(tabRemovedCleanupPlan(["tab-a", "tab-b"], ["tab-b"], model)).toEqual({
      agentSessionIds: ["ags-tab-a-codex"],
      removedTabIds: ["tab-a"],
    });
  });

  it("restores only active records for the requested tab", () => {
    const tabAActive = record("ags-a-active", "tab-a", "active");
    const tabAArchived = record("ags-a-archived", "tab-a", "archived");
    const tabBActive = record("ags-b-active", "tab-b", "active");
    const legacyActive = record("ags-legacy", undefined, "active");

    const restorable = restorableSessionsForTab(
      [tabAActive, tabAArchived, tabBActive, legacyActive],
      "tab-a",
    );

    expect(agentSessionRecordIds(restorable)).toEqual(["ags-a-active"]);
    expect(agentSessionRecordTabId(tabAActive)).toBe("tab-a");
    expect(agentSessionRecordTabId(legacyActive)).toBeUndefined();
  });
});
