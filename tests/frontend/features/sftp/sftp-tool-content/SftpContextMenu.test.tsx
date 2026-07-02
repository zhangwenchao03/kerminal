/**
 * SFTP context menu rendering tests.
 *
 * @author kongweiguang
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import { SftpContextMenu } from "../../../../../src/features/sftp/sftp-tool-content/SftpContextMenu";
import { SFTP_FILE_PANEL_MENU_DOMAIN } from "../../../../../src/features/sftp/sftp-tool-content/sftpContextMenuModel";

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

function menuActions() {
  return screen
    .getAllByRole("menuitem")
    .map((item) => item.getAttribute("data-menu-action"));
}

function expectFilePanelDomain(menuName: RegExp | string) {
  const menu = screen.getByRole("menu", { name: menuName });

  expect(menu).toHaveAttribute("data-menu-domain", SFTP_FILE_PANEL_MENU_DOMAIN);
  expect(
    screen
      .getAllByRole("menuitem")
      .every(
        (item) =>
          item.getAttribute("data-menu-domain") === SFTP_FILE_PANEL_MENU_DOMAIN,
      ),
  ).toBe(true);
}

describe("SftpContextMenu", () => {
  it("renders current-directory actions in the SFTP file-panel domain", () => {
    render(
      <SftpContextMenu
        currentPath="/srv"
        entry={null}
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 12, y: 24 }}
        showHiddenFiles
        supportsAdvancedActions
      />,
    );

    expectFilePanelDomain("SFTP 目录右键菜单");
    expect(menuActions()).toEqual([
      "workspace",
      "uploadFile",
      "uploadDirectory",
      "pasteClipboard",
      "newDirectory",
      "refresh",
      "toggleHidden",
      "copyPath",
    ]);
  });

  it("renders entry transfer actions in the SFTP file-panel domain", () => {
    render(
      <SftpContextMenu
        currentPath="/srv"
        entry={entry({ kind: "directory", name: "conf", path: "/srv/conf" })}
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 12, y: 24 }}
        showHiddenFiles
        supportsAdvancedActions={false}
        transferTargetSide="left"
      />,
    );

    expectFilePanelDomain(/conf/);
    expect(menuActions()).toContain("transferToTarget");
    expect(menuActions()).not.toContain("editMachine");
    expect(menuActions()).not.toContain("deleteMachine");
  });
});
