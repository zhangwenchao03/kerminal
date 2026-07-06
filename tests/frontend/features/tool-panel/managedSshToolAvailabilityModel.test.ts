import { describe, expect, it } from "vitest";
import type {
  ManagedSshRuntimeSnapshot,
  ManagedSshSessionSnapshot,
} from "../../../../src/lib/diagnosticsApi";
import { resolveManagedSshToolAvailability } from "../../../../src/features/tool-panel/managedSshToolAvailabilityModel";
import type {
  Machine,
  TerminalPane,
} from "../../../../src/features/workspace/types";

const sshMachine: Machine = {
  description: "deploy@prod.internal:22",
  host: "prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  port: 22,
  status: "online",
  tags: [],
  username: "deploy",
};

const focusedSshPane: TerminalPane = {
  id: "pane-1",
  lines: [],
  machineId: "prod-api",
  mode: "ssh",
  prompt: "$",
  remoteHostId: "prod-api",
  status: "online",
  title: "prod api",
};

describe("managedSshToolAvailabilityModel", () => {
  it("marks a ready managed session as reusable for SFTP", () => {
    const availability = resolveManagedSshToolAvailability({
      managedSsh: snapshot({
        channelCounts: {
          shell: 1,
          sftp: 1,
        },
      }),
      requiredCapability: "sftp",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: true,
      canUseConnectedSession: true,
      kind: "managed-reusable",
      label: "Managed reusable",
      targetLabel: "deploy@prod.internal:22",
    });
  });

  it("does not treat a matching legacy terminal pane as reusable", () => {
    const availability = resolveManagedSshToolAvailability({
      focusedPane: focusedSshPane,
      managedSsh: emptySnapshot(),
      requiredCapability: "sftp",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: true,
      canUseConnectedSession: false,
      kind: "legacy-terminal-only",
      label: "Legacy terminal only",
    });
  });

  it("requires auth when no managed session exists for an SSH target", () => {
    const availability = resolveManagedSshToolAvailability({
      managedSsh: emptySnapshot(),
      requiredCapability: "exec",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: true,
      canUseConnectedSession: false,
      kind: "auth-required",
      label: "Auth required",
    });
  });

  it.each([
    ["Unknown server key", "SSH 主机密钥尚未信任"],
    [
      "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
      "SSH 主机密钥已变化",
    ],
  ])("surfaces host key problem %s before claiming reuse", (lastError, detail) => {
    const availability = resolveManagedSshToolAvailability({
      managedSsh: snapshot({
        lastError,
      }),
      requiredCapability: "sftp",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: false,
      canUseConnectedSession: false,
      kind: "host-key-required",
      label: "Host key required",
    });
    expect(availability.detail).toContain(detail);
    expect(availability.detail).toContain("下一步");
  });

  it("surfaces bad credentials as an auth action with next step copy", () => {
    const availability = resolveManagedSshToolAvailability({
      managedSsh: snapshot({
        lastError: "Permission denied (publickey,password).",
      }),
      requiredCapability: "exec",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: false,
      canUseConnectedSession: false,
      kind: "auth-required",
      label: "Auth required",
    });
    expect(availability.detail).toContain("SSH 凭据认证失败");
    expect(availability.detail).toContain("下一步");
    expect(availability.detail).not.toContain("连接失败");
  });

  it("marks unsupported capability fallback as unsupported", () => {
    const availability = resolveManagedSshToolAvailability({
      managedSsh: {
        ...snapshot(),
        recentLegacyFallbacks: [
          {
            capability: "sftp",
            count: 1,
            lastAt: "1234",
            reason: "backend unsupported",
            target: "deploy@prod.internal:22",
          },
        ],
      },
      requiredCapability: "sftp",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: false,
      canUseConnectedSession: false,
      kind: "unsupported",
      label: "Unsupported",
    });
    expect(availability.detail).toContain("下一步");
  });

  it("surfaces retryable timeout diagnostics as action required", () => {
    const availability = resolveManagedSshToolAvailability({
      managedSsh: snapshot({
        lastError: "connection timed out",
        state: "failed",
      }),
      requiredCapability: "exec",
      selectedMachine: sshMachine,
    });

    expect(availability).toMatchObject({
      canAttemptConnection: true,
      canUseConnectedSession: false,
      kind: "action-required",
      label: "Action required",
    });
    expect(availability.detail).toContain("SSH 操作超时");
    expect(availability.detail).toContain("下一步");
  });

  it("returns unsupported for non-SSH targets", () => {
    const availability = resolveManagedSshToolAvailability({
      selectedMachine: {
        description: "local",
        id: "local",
        kind: "local",
        name: "Local",
        status: "online",
        tags: [],
      },
    });

    expect(availability).toMatchObject({
      canAttemptConnection: false,
      canUseConnectedSession: false,
      kind: "unsupported",
    });
  });

  it("returns no target when no machine is selected", () => {
    const availability = resolveManagedSshToolAvailability({});

    expect(availability).toMatchObject({
      canAttemptConnection: false,
      canUseConnectedSession: false,
      kind: "no-target",
      label: "No target",
    });
  });
});

function snapshot(
  overrides: Partial<ManagedSshSessionSnapshot> = {},
): ManagedSshRuntimeSnapshot {
  const session: ManagedSshSessionSnapshot = {
    activeChannels: 1,
    channelCounts: {},
    createdAt: "1234",
    key: {
      jumps: [],
      knownHostsProfile: "default",
      proxyProfile: null,
      runtimeFlags: [],
      target: "deploy@prod.internal:22",
    },
    lastError: null,
    lastUsedAt: "1234",
    maxConcurrentExecChannels: 4,
    openedChannels: 1,
    pendingExecRequests: 0,
    refCount: 1,
    sessionId: "session-1",
    state: "ready",
    ...overrides,
  };

  return {
    activeChannels: session.activeChannels,
    activeSessions: 1,
    generatedAt: "1234",
    recentLegacyFallbacks: [],
    sessions: [session],
  };
}

function emptySnapshot(): ManagedSshRuntimeSnapshot {
  return {
    activeChannels: 0,
    activeSessions: 0,
    generatedAt: "1234",
    recentLegacyFallbacks: [],
    sessions: [],
  };
}
