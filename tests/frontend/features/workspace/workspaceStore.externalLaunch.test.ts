import { beforeEach, describe, expect, it } from "vitest";
import type { ExternalSshLaunchResolvedRequest } from "../../../../src/features/external-launch/externalSshLaunchModel";
import {
  resetWorkspaceStore,
  useWorkspaceStore,
} from "../../../../src/features/workspace/workspaceStore";

describe("workspaceStore external SSH launch", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("opens a temporary external SSH machine and terminal tab", () => {
    useWorkspaceStore.getState().openExternalSshLaunch(
      createResolvedLaunch({
        remoteCommand: "tail -f /var/log/app.log",
      }),
    );

    const state = useWorkspaceStore.getState();
    const machine = state.machineGroups
      .flatMap((group) => group.machines)
      .find((candidate) => candidate.id === "external:launch-1");
    const pane = state.terminalPanes[0];

    expect(machine).toMatchObject({
      authType: "password",
      description: "deploy@example.internal:2202 · PuTTY",
      host: "example.internal",
      kind: "ssh",
      name: "deploy@example.internal",
      port: 2202,
      target: { hostId: "external:launch-1", kind: "ssh" },
      username: "deploy",
    });
    expect(pane).toMatchObject({
      machineId: "external:launch-1",
      mode: "ssh",
      remoteCommand: "tail -f /var/log/app.log",
      remoteHostId: "external:launch-1",
      target: { hostId: "external:launch-1", kind: "ssh" },
      title: "deploy@example.internal",
    });
    expect(state.terminalTabs[0]).toMatchObject({
      machineId: "external:launch-1",
      title: "deploy@example.internal",
    });
    expect(state.selectedMachineId).toBe("external:launch-1");
  });

  it("switches to the SFTP tool when the launch asks for SFTP", () => {
    useWorkspaceStore.getState().openExternalSshLaunch(
      createResolvedLaunch({
        displayName: "Jump host file view",
        openSftp: true,
      }),
    );

    const state = useWorkspaceStore.getState();
    expect(state.activeTool).toBe("sftp");
    expect(state.terminalPanes[0]?.title).toBe("Jump host file view");
  });
});

function createResolvedLaunch(
  overrides: {
    displayName?: string;
    openSftp?: boolean;
    remoteCommand?: string;
  } = {},
): ExternalSshLaunchResolvedRequest {
  return {
    auth: {
      agent: false,
      hasKeyPassphrase: false,
      hasPassword: true,
      passwordFilePresent: false,
    },
    diagnostics: {
      argvRedacted: ["putty.exe", "-ssh", "deploy@example.internal"],
      parser: "putty",
      rawHash: "abc123",
      warnings: [],
    },
    id: "launch-1",
    options: {
      displayName: overrides.displayName,
      openSftp: overrides.openSftp ?? false,
      remoteCommand: overrides.remoteCommand,
    },
    receivedAt: "1760000000",
    source: {
      entrypoint: "single-instance",
      tool: "putty",
    },
    target: {
      host: "example.internal",
      port: 2202,
      route: [],
      username: "deploy",
    },
  };
}
