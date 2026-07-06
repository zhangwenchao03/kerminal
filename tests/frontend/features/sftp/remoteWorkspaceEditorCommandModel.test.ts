import { describe, expect, it } from "vitest";
import {
  buildRemoteWorkspaceEditorCommandGroups,
  isRemoteWorkspaceEditorCommandEnabled,
  resolveRemoteWorkspaceEditorContextMenuPosition,
  type RemoteWorkspaceEditorCommandState,
} from "../../../../src/features/sftp/remoteWorkspaceEditorCommandModel";

const baseState: RemoteWorkspaceEditorCommandState = {
  dirty: true,
  hasConflict: false,
  hasEditor: true,
  hasSelection: true,
  loading: false,
  readOnly: false,
  saving: false,
};

describe("remoteWorkspaceEditorCommandModel", () => {
  it("enables common edit commands for a writable active editor", () => {
    const items = buildRemoteWorkspaceEditorCommandGroups(baseState).flat();

    expect(items.map((item) => item.id)).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "find",
      "replace",
      "reload",
      "save",
    ]);
    expect(isRemoteWorkspaceEditorCommandEnabled("copy", baseState)).toBe(true);
    expect(isRemoteWorkspaceEditorCommandEnabled("paste", baseState)).toBe(true);
    expect(isRemoteWorkspaceEditorCommandEnabled("save", baseState)).toBe(true);
  });

  it("keeps read-only safe commands available and disables writes", () => {
    const readOnlyState = { ...baseState, readOnly: true };

    expect(isRemoteWorkspaceEditorCommandEnabled("copy", readOnlyState)).toBe(
      true,
    );
    expect(isRemoteWorkspaceEditorCommandEnabled("find", readOnlyState)).toBe(
      true,
    );
    expect(isRemoteWorkspaceEditorCommandEnabled("cut", readOnlyState)).toBe(
      false,
    );
    expect(isRemoteWorkspaceEditorCommandEnabled("paste", readOnlyState)).toBe(
      false,
    );
    expect(isRemoteWorkspaceEditorCommandEnabled("save", readOnlyState)).toBe(
      false,
    );
  });

  it("uses overwrite save labeling for conflicted dirty tabs", () => {
    const items = buildRemoteWorkspaceEditorCommandGroups({
      ...baseState,
      dirty: false,
      hasConflict: true,
    }).flat();

    expect(items.find((item) => item.id === "save")).toMatchObject({
      disabled: false,
      label: "覆盖保存",
    });
  });

  it("clamps context menu positions inside the viewport", () => {
    expect(
      resolveRemoteWorkspaceEditorContextMenuPosition({
        viewportHeight: 300,
        viewportWidth: 400,
        x: 390,
        y: 290,
      }),
    ).toEqual({ x: 152, y: 8 });
  });

  it("keeps the requested context menu position when dimensions are unavailable", () => {
    expect(
      resolveRemoteWorkspaceEditorContextMenuPosition({
        menuHeight: 0,
        menuWidth: 0,
        viewportHeight: 0,
        viewportWidth: 0,
        x: 390,
        y: 290,
      }),
    ).toEqual({ x: 390, y: 290 });
  });
});
