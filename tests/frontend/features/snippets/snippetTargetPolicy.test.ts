import { describe, expect, it } from "vitest";
import {
  createSnippetTargetSnapshot,
  evaluateSnippetPolicy,
  isSnippetTargetSnapshotCurrent,
  normalizeSnippetShell,
} from "../../../../src/features/snippets/snippetTargetPolicy";
import type { PaneSessionRecord } from "../../../../src/features/terminal/terminalSessionRegistry";

const requirements = {
  capabilities: ["systemd"],
  contextBindings: [],
  platforms: ["linux" as const],
  scopes: ["ssh" as const],
  shells: ["posix" as const],
};

type SnapshotOverrides = Partial<{
  capabilities: readonly string[];
  connectionGeneration: number;
  platform: "linux" | "macos" | "windows" | "unknown";
  production: boolean;
  record: PaneSessionRecord;
}>;

function snapshot(overrides: SnapshotOverrides = {}) {
  return createSnippetTargetSnapshot({
    capabilities: ["systemd"],
    connectionGeneration: 4,
    displayName: "prod-web-1",
    paneId: "pane-a",
    platform: "linux",
    production: false,
    record: {
      connectionGeneration: 4,
      remoteHostId: "host-a",
      sessionId: "session-a",
      shell: "/bin/bash",
      target: "ssh",
    },
    capturedAt: 100,
    ...overrides,
  });
}

describe("snippetTargetPolicy", () => {
  it("creates a stable snapshot from existing context without probing", () => {
    expect(snapshot()).toEqual({
      capabilities: ["systemd"],
      capturedAt: 100,
      connectionGeneration: 4,
      displayName: "prod-web-1",
      hostId: "host-a",
      paneId: "pane-a",
      platform: "linux",
      production: false,
      sessionId: "session-a",
      shell: "posix",
      targetId: "host-a",
      targetKind: "ssh",
    });
  });

  it("rejects stale generation, session and target bindings", () => {
    const original = snapshot();
    expect(isSnippetTargetSnapshotCurrent(original, snapshot())).toBe(true);
    expect(isSnippetTargetSnapshotCurrent(original, snapshot({ connectionGeneration: 5 }))).toBe(false);
    expect(
      isSnippetTargetSnapshotCurrent(
        original,
        snapshot({ record: { connectionGeneration: 5, remoteHostId: "host-b", sessionId: "session-b", target: "ssh" } }),
      ),
    ).toBe(false);
  });

  it("allows compatible inspect commands and upgrades production confirmation", () => {
    expect(
      evaluateSnippetPolicy({ requirements, risk: "inspect", snapshot: snapshot() }),
    ).toMatchObject({
      canInsert: true,
      canRun: true,
      compatibility: "compatible",
      effectiveRisk: "inspect",
      requiresConfirmation: false,
    });
    expect(
      evaluateSnippetPolicy({ requirements, risk: "inspect", snapshot: snapshot({ production: true }) }),
    ).toMatchObject({ requiresConfirmation: true });
  });

  it("keeps unknown platform or capability insert-only", () => {
    const decision = evaluateSnippetPolicy({
      requirements,
      risk: "inspect",
      snapshot: snapshot({ capabilities: [], platform: "unknown", record: { connectionGeneration: 4, remoteHostId: "host-a", sessionId: "session-a", target: "ssh" } }),
    });
    expect(decision).toMatchObject({
      canInsert: true,
      canRun: false,
      compatibility: "unknown",
    });
    expect(decision.reasons).toContain("目标平台未知");
  });

  it("blocks incompatible targets and requires strong confirmation for destructive execution", () => {
    expect(
      evaluateSnippetPolicy({ requirements, risk: "inspect", snapshot: snapshot({ platform: "windows" }) }),
    ).toMatchObject({ canInsert: false, canRun: false, compatibility: "incompatible" });
    expect(
      evaluateSnippetPolicy({ requirements, risk: "destructive", snapshot: snapshot() }),
    ).toMatchObject({
      canInsert: true,
      canRun: true,
      requiresConfirmation: true,
      requiresStrongConfirmation: true,
    });
  });

  it("upgrades legacy raw inspect commands to change", () => {
    expect(
      evaluateSnippetPolicy({ hasLegacyRaw: true, requirements, risk: "inspect", snapshot: snapshot() }),
    ).toMatchObject({ effectiveRisk: "change", requiresConfirmation: true });
  });

  it("enforces host bindings and keeps unprovable group bindings insert-only", () => {
    expect(
      evaluateSnippetPolicy({
        requirements: {
          ...requirements,
          contextBindings: [{ kind: "host", targetId: "host-b" }],
        },
        risk: "inspect",
        snapshot: snapshot(),
      }),
    ).toMatchObject({ canInsert: false, canRun: false, compatibility: "incompatible" });
    expect(
      evaluateSnippetPolicy({
        requirements: {
          ...requirements,
          contextBindings: [{ kind: "hostGroup", targetId: "prod" }],
        },
        risk: "inspect",
        snapshot: snapshot(),
      }),
    ).toMatchObject({ canInsert: true, canRun: false, compatibility: "unknown" });
  });

  it("normalizes known shells conservatively", () => {
    expect(normalizeSnippetShell("C:/Program Files/PowerShell/7/pwsh.exe")).toBe("powershell");
    expect(normalizeSnippetShell("/usr/bin/zsh")).toBe("posix");
    expect(normalizeSnippetShell("custom-shell")).toBe("unknown");
  });
});
