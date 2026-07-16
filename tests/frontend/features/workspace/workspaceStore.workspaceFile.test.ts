import { beforeEach, describe, expect, it } from "vitest";
import {
  useWorkspaceStore,
} from "../../../../src/features/workspace/workspaceStore";
import { resetWorkspaceStore } from "../../support/workspace/workspaceStore.testSupport";

describe("workspaceStore workspace file tabs", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("opens and focuses a workspace file tab", () => {
    useWorkspaceStore.getState().openWorkspaceFileTab({
      access: "readonly",
      path: "/etc/app.yaml",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
    });

    const state = useWorkspaceStore.getState();
    const lastTab = state.terminalTabs[state.terminalTabs.length - 1];
    expect(state.activeTabId).toMatch(/^tab-workspace-file-/);
    expect(state.focusedPaneId).toBe("");
    expect(state.selectedMachineId).toBe("host-prod");
    expect(lastTab).toMatchObject({
      access: "readonly",
      kind: "workspaceFile",
      machineId: "host-prod",
      path: "/etc/app.yaml",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
      title: "app.yaml",
    });
  });

  it("deduplicates workspace file tabs by target, access, source, and path", () => {
    const store = useWorkspaceStore.getState();
    store.openWorkspaceFileTab({
      access: "readonly",
      path: "/etc//app.yaml",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
    });
    const firstTabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().openWorkspaceFileTab({
      access: "readonly",
      path: " /etc/app.yaml ",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
    });

    const state = useWorkspaceStore.getState();
    const fileTabs = state.terminalTabs.filter(
      (tab) => tab.kind === "workspaceFile",
    );
    expect(fileTabs).toHaveLength(1);
    expect(state.activeTabId).toBe(firstTabId);
  });

  it("tracks workspace file dirty state separately from tab metadata", () => {
    useWorkspaceStore.getState().openWorkspaceFileTab({
      access: "editable",
      path: "/etc/app.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
    });
    const tabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().setWorkspaceFileTabDirty(tabId, true);

    expect(useWorkspaceStore.getState().workspaceFileDirtyState).toEqual({
      [tabId]: true,
    });

    useWorkspaceStore.getState().setWorkspaceFileTabDirty(tabId, false);

    expect(useWorkspaceStore.getState().workspaceFileDirtyState).toEqual({});
  });

  it("clears workspace file dirty state when the tab closes", () => {
    useWorkspaceStore.getState().openWorkspaceFileTab({
      access: "editable",
      path: "/etc/app.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
    });
    const tabId = useWorkspaceStore.getState().activeTabId;
    useWorkspaceStore.getState().setWorkspaceFileTabDirty(tabId, true);

    useWorkspaceStore.getState().closeTerminalTab(tabId);

    expect(useWorkspaceStore.getState().workspaceFileDirtyState).toEqual({});
    expect(
      useWorkspaceStore.getState().terminalTabs.some((tab) => tab.id === tabId),
    ).toBe(false);
  });

  it("creates a SFTP reveal request for workspace file tabs", () => {
    useWorkspaceStore.getState().openWorkspaceFileTab({
      access: "editable",
      path: "/etc/nginx/nginx.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
    });
    const tabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().revealWorkspaceFileInSftp(tabId);

    const state = useWorkspaceStore.getState();
    expect(state.activeTabId).toBe(tabId);
    expect(state.activeTool).toBeNull();
    expect(state.focusedPaneId).toBe("");
    expect(state.selectedMachineId).toBe("host-prod");
    expect(state.workspaceFileRevealRequest).toMatchObject({
      directoryPath: "/etc/nginx",
      filePath: "/etc/nginx/nginx.conf",
      target: { hostId: "host-prod", kind: "ssh" },
    });
    expect(state.workspaceFileRevealRequest?.id).toEqual(expect.any(Number));
  });
});
