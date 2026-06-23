/**
 * SFTP context menu model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../lib/sftpApi";
import { MACHINE_SIDEBAR_MENU_ACTIONS } from "../../machine-sidebar/machineSidebarMenuModel";
import {
  SFTP_FILE_PANEL_MENU_ACTIONS,
  SFTP_FILE_PANEL_MENU_DOMAIN,
  buildSftpContextMenuGroups,
  type SftpContextMenuItemModel,
} from "./sftpContextMenuModel";

function entry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const name = overrides.name ?? "app.log";
  return {
    kind: "file",
    name,
    path: `/srv/${name}`,
    raw: name,
    ...overrides,
  };
}

function actions(groups: SftpContextMenuItemModel[][]) {
  return groups.map((group) => group.map((item) => item.action));
}

function itemByAction(
  groups: SftpContextMenuItemModel[][],
  action: SftpContextMenuItemModel["action"],
) {
  return groups.flat().find((item) => item.action === action);
}

describe("sftpContextMenuModel", () => {
  it("builds current-directory actions and advanced upload choices", () => {
    const groups = buildSftpContextMenuGroups({
      entry: null,
      showHiddenFiles: true,
      supportsAdvancedActions: true,
    });

    expect(actions(groups)).toEqual([
      [
        "uploadFile",
        "uploadDirectory",
        "pasteClipboard",
        "uploadFileArchive",
        "uploadDirectoryArchive",
        "newDirectory",
      ],
      ["refresh", "toggleHidden", "copyPath"],
    ]);
    expect(itemByAction(groups, "toggleHidden")).toMatchObject({
      domain: SFTP_FILE_PANEL_MENU_DOMAIN,
      icon: "eyeOff",
      label: "隐藏隐藏文件",
    });
  });

  it("marks every item as file-panel scoped and keeps host actions out", () => {
    const groups = buildSftpContextMenuGroups({
      entry: entry({ kind: "directory", name: "conf", path: "/srv/conf" }),
      hasTransferTarget: true,
      showHiddenFiles: true,
      supportsAdvancedActions: true,
      transferTargetSide: "right",
    });
    const hostAssetActions = new Set<string>(MACHINE_SIDEBAR_MENU_ACTIONS);

    expect(groups.flat().every((item) => item.domain === SFTP_FILE_PANEL_MENU_DOMAIN)).toBe(
      true,
    );
    expect(
      SFTP_FILE_PANEL_MENU_ACTIONS.filter((action) =>
        hostAssetActions.has(action),
      ),
    ).toEqual([]);
  });

  it("omits advanced current-directory actions when the target does not support them", () => {
    const groups = buildSftpContextMenuGroups({
      entry: null,
      showHiddenFiles: false,
      supportsAdvancedActions: false,
    });

    expect(actions(groups)).toEqual([
      ["uploadFile", "uploadDirectory", "newDirectory"],
      ["refresh", "toggleHidden", "copyPath"],
    ]);
    expect(itemByAction(groups, "toggleHidden")).toMatchObject({
      icon: "eye",
      label: "显示隐藏文件",
    });
  });

  it("builds directory actions with paste, archive, copy, and delete affordances", () => {
    const groups = buildSftpContextMenuGroups({
      entry: entry({ kind: "directory", name: "conf", path: "/srv/conf" }),
      showHiddenFiles: true,
      supportsAdvancedActions: true,
    });

    expect(actions(groups)).toEqual([
      [
        "open",
        "workspace",
        "download",
        "downloadArchive",
        "downloadClipboard",
        "uploadFileInto",
        "uploadDirectoryInto",
        "pasteClipboard",
      ],
      ["copyItem", "copyPath", "rename", "chmod"],
      ["delete"],
    ]);
    expect(itemByAction(groups, "delete")).toMatchObject({
      danger: true,
      label: "删除目录",
    });
  });

  it("keeps basic directory actions without advanced SFTP operations", () => {
    const groups = buildSftpContextMenuGroups({
      entry: entry({ kind: "directory", name: "conf", path: "/srv/conf" }),
      showHiddenFiles: true,
      supportsAdvancedActions: false,
    });

    expect(actions(groups)).toEqual([
      ["open", "workspace", "download", "uploadFileInto", "uploadDirectoryInto"],
      ["copyPath", "rename", "chmod"],
      ["delete"],
    ]);
  });

  it("adds a transfer-target action only for transfer workbench menus", () => {
    const groups = buildSftpContextMenuGroups({
      entry: entry({ kind: "directory", name: "conf", path: "/srv/conf" }),
      hasTransferTarget: true,
      showHiddenFiles: true,
      supportsAdvancedActions: false,
      transferTargetSide: "left",
    });

    expect(actions(groups)[0][0]).toBe("transferToTarget");
    expect(itemByAction(groups, "transferToTarget")).toMatchObject({
      disabled: false,
      icon: "transfer",
      label: "传输到左侧",
    });

    const unsupportedGroups = buildSftpContextMenuGroups({
      entry: entry({ kind: "other", name: "socket", path: "/srv/socket" }),
      hasTransferTarget: true,
      showHiddenFiles: true,
      supportsAdvancedActions: true,
      transferTargetSide: "right",
    });
    expect(itemByAction(unsupportedGroups, "transferToTarget")).toMatchObject({
      disabled: true,
      label: "传输到右侧",
    });
  });

  it("allows symlink downloads but keeps editor preview disabled", () => {
    const groups = buildSftpContextMenuGroups({
      entry: entry({ kind: "symlink", name: "latest", path: "/srv/latest" }),
      showHiddenFiles: true,
      supportsAdvancedActions: true,
    });

    expect(itemByAction(groups, "preview")).toMatchObject({
      disabled: true,
      label: "打开编辑器",
    });
    expect(itemByAction(groups, "download")).toMatchObject({
      disabled: false,
      label: "下载",
    });
    expect(itemByAction(groups, "copyItem")).toMatchObject({
      disabled: false,
    });
  });

  it("disables transfer actions for unsupported entry kinds", () => {
    const groups = buildSftpContextMenuGroups({
      entry: entry({ kind: "other", name: "socket", path: "/srv/socket" }),
      showHiddenFiles: true,
      supportsAdvancedActions: true,
    });

    expect(itemByAction(groups, "preview")).toMatchObject({ disabled: true });
    expect(itemByAction(groups, "download")).toMatchObject({ disabled: true });
    expect(itemByAction(groups, "downloadArchive")).toMatchObject({
      disabled: true,
    });
    expect(itemByAction(groups, "downloadClipboard")).toMatchObject({
      disabled: true,
    });
    expect(itemByAction(groups, "copyItem")).toMatchObject({ disabled: true });
    expect(itemByAction(groups, "delete")).toMatchObject({
      danger: true,
      label: "删除",
    });
  });
});
