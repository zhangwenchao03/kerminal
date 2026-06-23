import { describe, expect, it } from "vitest";
import {
  closeTerminalPaneState,
  closeTerminalTabState,
  focusTerminalPaneState,
  resolveFocusedPaneSplitTarget,
  selectTerminalTabState,
  splitFocusedPaneState,
  type TerminalWorkspaceStateSlice,
} from "./workspaceTerminalState";
import type { TerminalPane, TerminalTab } from "./types";

function terminalPane(overrides: Partial<TerminalPane> = {}): TerminalPane {
  return {
    id: "pane-ssh-1",
    lines: ["boot", "ready"],
    machineId: "host-lab",
    mode: "ssh",
    prompt: "root@lab:~$",
    remoteHostId: "host-lab",
    remoteHostProduction: true,
    status: "online",
    target: { hostId: "host-lab", kind: "ssh" },
    title: "lab server",
    ...overrides,
  };
}

function terminalState(
  overrides: Partial<TerminalWorkspaceStateSlice> = {},
): TerminalWorkspaceStateSlice {
  const pane = terminalPane();
  const tab: TerminalTab = {
    id: "tab-ssh-1",
    layout: { paneId: pane.id, type: "pane" },
    machineId: pane.machineId,
    title: pane.title,
  };

  return {
    activeTabId: tab.id,
    focusedPaneId: pane.id,
    terminalPanes: [pane],
    terminalTabs: [tab],
    ...overrides,
  };
}

describe("workspaceTerminalState split pane", () => {
  it("builds a split patch that focuses the new pane and clears output lines", () => {
    const state = terminalState();

    expect(resolveFocusedPaneSplitTarget(state)).toEqual({
      paneIdPrefix: "pane-ssh",
      sourcePaneId: "pane-ssh-1",
    });

    const patch = splitFocusedPaneState(state, {
      direction: "horizontal",
      paneId: "pane-ssh-2",
      splitId: "split-1",
    });

    expect(patch.focusedPaneId).toBe("pane-ssh-2");
    expect(patch.terminalPanes).toHaveLength(2);
    expect(patch.terminalPanes?.[1]).toMatchObject({
      id: "pane-ssh-2",
      lines: [],
      machineId: "host-lab",
      mode: "ssh",
      remoteHostId: "host-lab",
      remoteHostProduction: true,
      target: { hostId: "host-lab", kind: "ssh" },
      title: "右侧分屏",
    });
    expect(patch.terminalTabs?.[0]).toMatchObject({
      id: "tab-ssh-1",
      layout: {
        children: [
          { paneId: "pane-ssh-1", type: "pane" },
          { paneId: "pane-ssh-2", type: "pane" },
        ],
        direction: "horizontal",
        id: "split-1",
        type: "split",
      },
    });
  });

  it("starts the new split pane in the source pane current working directory", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({
          currentCwd: "/srv/app",
          cwd: "/home/root",
        }),
      ],
    });

    const patch = splitFocusedPaneState(state, {
      direction: "horizontal",
      paneId: "pane-ssh-2",
      splitId: "split-1",
    });

    expect(patch.terminalPanes?.[1]).toMatchObject({
      currentCwd: "/srv/app",
      cwd: "/srv/app",
    });
  });

  it("uses vertical split titles and keeps split prefixes compatible", () => {
    const previewState = terminalState({
      activeTabId: "tab-preview-1",
      focusedPaneId: "pane-preview-1",
      terminalPanes: [
        terminalPane({
          id: "pane-preview-1",
          machineId: "preview-machine",
          mode: "preview",
          remoteHostId: undefined,
          remoteHostProduction: undefined,
          target: undefined,
        }),
      ],
      terminalTabs: [
        {
          id: "tab-preview-1",
          layout: { paneId: "pane-preview-1", type: "pane" },
          machineId: "preview-machine",
          title: "Preview",
        },
      ],
    });

    expect(resolveFocusedPaneSplitTarget(previewState)).toEqual({
      paneIdPrefix: "pane-preview",
      sourcePaneId: "pane-preview-1",
    });
    expect(
      resolveFocusedPaneSplitTarget(
        terminalState({
          activeTabId: "tab-container-1",
          focusedPaneId: "pane-container-1",
          terminalPanes: [
            terminalPane({
              id: "pane-container-1",
              mode: "container",
            }),
          ],
          terminalTabs: [
            {
              id: "tab-container-1",
              layout: { paneId: "pane-container-1", type: "pane" },
              machineId: "container-machine",
              title: "api",
            },
          ],
        }),
      )?.paneIdPrefix,
    ).toBe("pane-local");

    const patch = splitFocusedPaneState(previewState, {
      direction: "vertical",
      paneId: "pane-preview-2",
      splitId: "split-2",
    });

    expect(patch.terminalPanes?.[1]?.title).toBe("下方分屏");
    expect(patch.terminalTabs?.[0]).toMatchObject({
      layout: {
        direction: "vertical",
        id: "split-2",
        type: "split",
      },
    });
  });

  it("returns no patch when the focused pane cannot be split from the active tab", () => {
    const inactivePane = terminalPane({ id: "pane-ssh-2" });
    const sftpTab: TerminalTab = {
      id: "tab-transfer-1",
      kind: "sftpTransfer",
      machineId: "host-lab",
      rightHostId: "host-lab",
      title: "lab transfer",
    };

    const transferState = terminalState({
      activeTabId: sftpTab.id,
      focusedPaneId: "",
      terminalPanes: [],
      terminalTabs: [sftpTab],
    });
    const staleFocusState = terminalState({
      focusedPaneId: inactivePane.id,
      terminalPanes: [terminalPane(), inactivePane],
    });

    expect(resolveFocusedPaneSplitTarget(transferState)).toBeUndefined();
    expect(
      splitFocusedPaneState(transferState, {
        direction: "horizontal",
        paneId: "pane-ssh-2",
        splitId: "split-1",
      }),
    ).toEqual({});
    expect(resolveFocusedPaneSplitTarget(staleFocusState)).toBeUndefined();
    expect(
      splitFocusedPaneState(staleFocusState, {
        direction: "vertical",
        paneId: "pane-ssh-3",
        splitId: "split-2",
      }),
    ).toEqual({});
  });
});

describe("workspaceTerminalState tab and pane focus", () => {
  it("focuses a live pane in the active terminal tab", () => {
    const state = terminalState({
      focusedPaneId: "pane-ssh-1",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    expect(focusTerminalPaneState(state, "pane-ssh-2")).toEqual({
      focusedPaneId: "pane-ssh-2",
    });
  });

  it("ignores focus requests outside the active tab layout", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-1",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(focusTerminalPaneState(state, "pane-ssh-3")).toBe(state);
    expect(focusTerminalPaneState(state, "pane-missing")).toBe(state);
  });

  it("selects a terminal tab without focusing a missing pane", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-2",
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-missing", type: "pane" },
              { paneId: "pane-ssh-3", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-existing",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-2", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(selectTerminalTabState(state, "tab-ssh-1")).toEqual({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-3",
    });
  });

  it("keeps the focused split pane when closing an inactive tab", () => {
    const state = terminalState({
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(closeTerminalTabState(state, "tab-ssh-2")).toMatchObject({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-2",
    });
  });

  it("does not remove panes outside the active terminal tab", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(closeTerminalPaneState(state, "pane-ssh-3")).toEqual({});
  });
});
