/**
 * Machine sidebar context menu domain rendering tests.
 *
 * @author kongweiguang
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MachineSidebar } from "../../../../src/features/machine-sidebar/MachineSidebar";
import {
  containerSidebarGroups,
  localSidebarGroups,
  remoteSidebarGroups,
} from "../../support/machine-sidebar/MachineSidebar.testSupport";
import {
  MACHINE_ASSET_MENU_DOMAIN,
  MACHINE_GROUP_MENU_DOMAIN,
  MACHINE_SIDEBAR_ROOT_MENU_DOMAIN,
  buildMachineSidebarGroupMenuItems,
  buildMachineSidebarMachineMenuItems,
  buildMachineSidebarRootMenuItems,
} from "../../../../src/features/machine-sidebar/machineSidebarMenuModel";

function menuActions() {
  return screen
    .getAllByRole("menuitem")
    .map((item) => item.getAttribute("data-menu-action"));
}

function expectMenuDomain(domain: string) {
  const menu = screen.getByRole("menu", { name: "主机操作菜单" });

  expect(menu).toHaveAttribute("data-menu-domain", domain);
  expect(
    screen
      .getAllByRole("menuitem")
      .every((item) => item.getAttribute("data-menu-domain") === domain),
  ).toBe(true);
}

describe("machineSidebarMenuDomain", () => {
  it("expands host groups by default", () => {
    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(screen.getByRole("button", { name: /开发主机/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeTruthy();
  });

  it("expands host groups that load after the first render", () => {
    const { rerender } = render(
      <MachineSidebar
        groups={[]}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId=""
      />,
    );

    rerender(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(screen.getByRole("button", { name: /开发主机/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeTruthy();
  });

  it("reveals matching hosts while search is active", () => {
    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search="ubuntu"
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(screen.getByRole("button", { name: /开发主机/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeTruthy();
  });

  it("renders root menu with the machine-sidebar-root domain", () => {
    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("complementary", { name: "主机侧边栏" }),
    );

    expectMenuDomain(MACHINE_SIDEBAR_ROOT_MENU_DOMAIN);
    expect(menuActions()).toEqual(
      buildMachineSidebarRootMenuItems().map((item) => item.action),
    );
  });

  it("renders group menu with the machine-group domain", () => {
    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /开发主机/ }));

    expectMenuDomain(MACHINE_GROUP_MENU_DOMAIN);
    expect(menuActions()).toEqual(
      buildMachineSidebarGroupMenuItems({ pinned: false }).map(
        (item) => item.action,
      ),
    );
  });

  it("renders SSH host menu with the machine-asset domain", () => {
    const sshHost = remoteSidebarGroups[1]!.machines[0]!;

    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));

    expectMenuDomain(MACHINE_ASSET_MENU_DOMAIN);
    expect(menuActions()).toEqual(
      buildMachineSidebarMachineMenuItems(sshHost).map((item) => item.action),
    );
  });

  it("keeps container host menus in the machine-asset domain without transfer-tab action", () => {
    const container = containerSidebarGroups[0]!.machines[1]!;

    render(
      <MachineSidebar
        groups={containerSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="docker:ubuntu-dev:c0ffee1234567890"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /api/i }));

    expectMenuDomain(MACHINE_ASSET_MENU_DOMAIN);
    expect(menuActions()).toEqual(
      buildMachineSidebarMachineMenuItems(container).map((item) => item.action),
    );
    expect(menuActions()).not.toContain("openSftpTransferWorkbench");
  });
});
