import { describe, expect, it } from "vitest";
import type { TerminalTab } from "../../../../src/features/workspace/types";
import { resolveWorkspaceTabCloseDecision } from "../../../../src/features/workspace/workspaceTabCloseGuardModel";

const terminalTab: TerminalTab = {
  id: "tab-terminal",
  layout: { paneId: "pane-terminal", type: "pane" },
  machineId: "host-prod",
  title: "prod shell",
};

const cleanFileTab: TerminalTab = {
  access: "editable",
  id: "tab-file-clean",
  kind: "workspaceFile",
  machineId: "host-prod",
  path: "/etc/app.conf",
  source: "sftp",
  target: { hostId: "host-prod", kind: "ssh" },
  title: "app.conf",
};

const dirtyFileTab: TerminalTab = {
  ...cleanFileTab,
  id: "tab-file-dirty",
  path: "/etc/dirty.conf",
  title: "dirty.conf",
};

describe("resolveWorkspaceTabCloseDecision", () => {
  it("closes clean workspace file tabs directly", () => {
    expect(
      resolveWorkspaceTabCloseDecision({
        confirmTerminalClose: true,
        tabIds: [cleanFileTab.id],
        tabs: [cleanFileTab],
        workspaceFileDirtyState: {},
      }),
    ).toEqual({ kind: "close", tabIds: [cleanFileTab.id] });
  });

  it("requires dirty file confirmation before closing workspace file tabs", () => {
    expect(
      resolveWorkspaceTabCloseDecision({
        confirmTerminalClose: false,
        tabIds: [dirtyFileTab.id],
        tabs: [dirtyFileTab],
        workspaceFileDirtyState: { [dirtyFileTab.id]: true },
      }),
    ).toEqual({
      dirtyFileTabIds: [dirtyFileTab.id],
      kind: "confirmDirtyFiles",
      tabIds: [dirtyFileTab.id],
    });
  });

  it("continues to terminal close confirmation after dirty files are confirmed", () => {
    expect(
      resolveWorkspaceTabCloseDecision({
        confirmTerminalClose: true,
        confirmedDirtyFiles: true,
        tabIds: [dirtyFileTab.id, terminalTab.id],
        tabs: [dirtyFileTab, terminalTab],
        workspaceFileDirtyState: { [dirtyFileTab.id]: true },
      }),
    ).toEqual({
      kind: "confirmTerminalTabs",
      tabIds: [dirtyFileTab.id, terminalTab.id],
    });
  });

  it("deduplicates requested tab ids", () => {
    expect(
      resolveWorkspaceTabCloseDecision({
        confirmTerminalClose: false,
        tabIds: [cleanFileTab.id, cleanFileTab.id],
        tabs: [cleanFileTab],
        workspaceFileDirtyState: {},
      }),
    ).toEqual({ kind: "close", tabIds: [cleanFileTab.id] });
  });
});
