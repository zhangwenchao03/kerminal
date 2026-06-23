import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceSessionSnapshot,
  useWorkspaceSessionPersistence,
} from "./useWorkspaceSessionPersistence";
import {
  resetWorkspaceStore,
  useWorkspaceStore,
} from "../features/workspace/workspaceStore";
import { WORKSPACE_SESSION_STORAGE_KEY } from "../features/workspace/workspaceSessionStorage";
import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../features/workspace/types";

function machine(overrides: Partial<Machine> & Pick<Machine, "id" | "kind">) {
  return {
    description: overrides.id,
    name: overrides.id,
    status: "offline",
    tags: [],
    ...overrides,
  } satisfies Machine;
}

function WorkspaceSessionPersistenceHost() {
  useWorkspaceSessionPersistence();
  return null;
}

describe("buildWorkspaceSessionSnapshot", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWorkspaceStore();
  });

  it("builds a serializable workspace session from current shell state", () => {
    const localMachine = machine({
      id: "local-pwsh",
      kind: "local",
      profileId: "profile-pwsh",
    });
    const remoteMachine = machine({
      id: "host-prod",
      kind: "ssh",
      remoteGroupId: "remote-group",
    });
    const containerMachine = machine({
      id: "container-api",
      kind: "dockerContainer",
      parentMachineId: "host-prod",
    });
    const machineGroups: MachineGroup[] = [
      {
        id: "local",
        machines: [localMachine],
        title: "Local",
      },
      {
        id: "remote-group",
        machines: [remoteMachine, containerMachine],
        title: "Remote",
      },
    ];
    const terminalPanes: TerminalPane[] = [
      {
        id: "pane-1",
        lines: [],
        machineId: "local-pwsh",
        mode: "local",
        prompt: ">",
        status: "online",
        title: "PowerShell",
      },
    ];
    const terminalTabs: TerminalTab[] = [
      {
        id: "tab-1",
        layout: { paneId: "pane-1", type: "pane" },
        machineId: "local-pwsh",
        title: "PowerShell",
      },
    ];

    const snapshot = buildWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      machineGroups,
      removedSidebarMachineIds: ["local-hidden"],
      selectedMachineId: "local-pwsh",
      terminalPanes,
      terminalTabGroupPreferences: {
        "local-pwsh": {
          color: "blue",
          title: "本地组",
        },
      },
      terminalTabs,
    });

    expect(snapshot).toMatchObject({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      removedSidebarMachineIds: ["local-hidden"],
      selectedMachineId: "local-pwsh",
      terminalTabGroupPreferences: {
        "local-pwsh": {
          color: "blue",
          title: "本地组",
        },
      },
      terminalPanes,
      terminalTabs,
    });
    expect(snapshot.sidebarMachines).toEqual([
      { ...localMachine, remoteGroupId: "local" },
      { ...containerMachine, remoteGroupId: "remote-group" },
    ]);
  });

  it("flushes the latest pane output history from the workspace store", () => {
    render(createElement(WorkspaceSessionPersistenceHost));

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }
    expect(paneId).toBe("pane-local-1");

    act(() => {
      useWorkspaceStore
        .getState()
        .updateTerminalTabGroupPreference("machine-local-1", {
          color: "pink",
          title: "工作组",
        });
      useWorkspaceStore
        .getState()
        .updatePaneOutputHistory(paneId, "latest terminal output");
    });
    fireEvent(window, new Event("pagehide"));

    const savedSession = JSON.parse(
      window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY) ?? "{}",
    );
    expect(savedSession.terminalPanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paneId,
          outputHistory: "latest terminal output",
        }),
      ]),
    );
    expect(savedSession.terminalTabGroupPreferences).toEqual({
      "machine-local-1": {
        color: "pink",
        title: "工作组",
      },
    });
  });
});
