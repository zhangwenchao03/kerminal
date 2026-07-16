import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../../src/features/settings/settingsModel";
import type {
  TerminalTab,
  TerminalTabGroupPreferences,
} from "../../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import {
  WORKSPACE_FILE_TAB_COMMAND_EVENT,
  type WorkspaceFileTabCommandEventDetail,
} from "../../../../../src/features/workspace/workspaceFileTabActions";
import {
  alternateLocalTabs,
  batchPanes,
  batchTabs,
  groupedSshPanes,
  groupedSshTabs,
  manyTerminalTabs,
  workspaceProps,
} from "../../../support/terminal/TerminalWorkspace.testSupport.ts";
import {
  desktopClipboardMocks,
  mockTabListMetrics,
  xtermPaneMockState,
} from "./setup";

export function registerTabAndMenuTests() {
  it("keeps the tab strip horizontal and maps wheel movement sideways when tabs overflow", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-many-1",
          tabs: manyTerminalTabs,
        })}
      />,
    );

    const tabList = screen.getByLabelText("终端标签栏");
    Object.defineProperty(tabList, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(tabList, "scrollWidth", {
      configurable: true,
      value: 960,
    });
    tabList.scrollLeft = 0;
    tabList.scrollTop = 6;

    fireEvent.wheel(tabList, { deltaY: 96 });

    expect(tabList).toHaveClass("overflow-y-hidden");
    expect(tabList.scrollTop).toBe(0);
    expect(tabList.scrollLeft).toBe(96);
  });

  it("keeps wheel movement still when the tab strip has no horizontal overflow", () => {
    render(
      <TerminalWorkspace {...workspaceProps({ tabs: alternateLocalTabs })} />,
    );

    const tabList = screen.getByLabelText("终端标签栏");
    Object.defineProperty(tabList, "clientWidth", {
      configurable: true,
      value: 960,
    });
    Object.defineProperty(tabList, "scrollWidth", {
      configurable: true,
      value: 960,
    });
    tabList.scrollLeft = 0;
    tabList.scrollTop = 6;

    fireEvent.wheel(tabList, { deltaY: 96 });

    expect(tabList.scrollTop).toBe(0);
    expect(tabList.scrollLeft).toBe(0);
  });

  it("hides the all-tabs menu trigger when a short tab strip fits", () => {
    render(
      <TerminalWorkspace {...workspaceProps({ tabs: alternateLocalTabs })} />,
    );

    expect(
      screen.queryByRole("button", { name: "查看所有标签" }),
    ).not.toBeInTheDocument();
  });

  it("hides the all-tabs menu trigger when many tabs still fit", () => {
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 1280,
      scrollWidth: 960,
    });

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-many-1",
            tabs: manyTerminalTabs,
          })}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "查看所有标签" }),
      ).not.toBeInTheDocument();
    } finally {
      restoreTabListMetrics();
    }
  });

  it("opens an all-tabs menu from the right side of the tab bar", async () => {
    const user = userEvent.setup();
    const onSelectTab = vi.fn();
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 260,
      scrollWidth: 620,
    });

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onSelectTab,
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
          })}
        />,
      );

      await user.click(screen.getByRole("button", { name: "查看所有标签" }));

      const menu = screen.getByRole("menu", { name: "所有终端标签" });
      expect(within(menu).getByText("2 组 / 3 个")).toBeInTheDocument();
      const devGroup = within(menu).getByRole("group", {
        name: "dev.internal 标签组",
      });
      expect(within(devGroup).getByText("2 个")).toBeInTheDocument();
      expect(
        devGroup.querySelector(
          '[data-terminal-identity-source="automatic"][data-terminal-identity-accent]',
        ),
      ).not.toBeNull();
      expect(
        within(menu).getByRole("group", { name: "lab.internal 标签组" }),
      ).toBeInTheDocument();

      await user.click(
        within(devGroup).getByRole("menuitem", { name: /dev.internal #2/ }),
      );

      expect(onSelectTab).toHaveBeenCalledWith("tab-dev-b");
      expect(
        screen.queryByRole("menu", { name: "所有终端标签" }),
      ).not.toBeInTheDocument();
    } finally {
      restoreTabListMetrics();
    }
  });

  it("mounts runtime panes for repeated host tabs so each SSH tab auto-connects", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
        })}
      />,
    );

    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      "pane-dev-a",
      "pane-dev-b",
      "pane-lab",
    ]);
  });

  it("mounts split runtime panes inside their own slots", async () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    const slots = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-terminal-pane-runtime-slot]",
      ),
    );

    expect(slots.map((slot) => slot.dataset.terminalPaneRuntimeSlot)).toEqual([
      "pane-batch-local",
      "pane-batch-ssh",
    ]);
    await waitFor(() => {
      expect(
        within(slots[0]).getByLabelText("本地批量 xterm 终端"),
      ).toBeInTheDocument();
      expect(
        within(slots[1]).getByLabelText("SSH 批量 xterm 终端"),
      ).toBeInTheDocument();
    });
  });

  it("lets the all-tabs menu follow the document theme", async () => {
    const user = userEvent.setup();
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 260,
      scrollWidth: 620,
    });
    document.documentElement.classList.add("dark");

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
          })}
        />,
      );

      await user.click(screen.getByRole("button", { name: "查看所有标签" }));

      const menu = screen.getByRole("menu", { name: "所有终端标签" });
      expect(document.documentElement).toHaveClass("dark");
      expect(menu).not.toHaveClass("dark");
      document.documentElement.classList.remove("dark");
      expect(menu).not.toHaveClass("dark");
    } finally {
      restoreTabListMetrics();
    }
  });

  it("groups repeated host tabs and lets the group collapse", async () => {
    const user = userEvent.setup();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "dev.internal #2" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );

    expect(
      screen.getByRole("button", { name: "展开 dev.internal 标签组" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "dev.internal #2" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "lab.internal" }),
    ).toBeInTheDocument();
  });

  it("opens a right-click menu for terminal tabs", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          onCloseTab,
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
        })}
      />,
    );

    const tabButton = screen.getByRole("button", { name: "dev.internal #2" });
    fireEvent.contextMenu(tabButton);
    await user.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));
    expect(
      screen.getByRole("dialog", { name: "确认关闭标签" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTab).toHaveBeenCalledWith("tab-lab");
  });

  it("adds workspace file actions to the tab right-click menu", async () => {
    const user = userEvent.setup();
    const onRevealWorkspaceFileInSftp = vi.fn();
    const fileTab: TerminalTab = {
      access: "editable",
      id: "tab-file-actions",
      kind: "workspaceFile",
      machineId: "host-prod",
      path: "/etc/app.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
      title: "app.conf",
    };
    const commandEvents: WorkspaceFileTabCommandEventDetail[] = [];
    const handleCommand = (event: Event) => {
      commandEvents.push(
        (event as CustomEvent<WorkspaceFileTabCommandEventDetail>).detail,
      );
    };
    window.addEventListener(WORKSPACE_FILE_TAB_COMMAND_EVENT, handleCommand);

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: fileTab.id,
            focusedPaneId: "",
            onRevealWorkspaceFileInSftp,
            panes: [],
            renderCustomTab: () => <div>file surface</div>,
            tabs: [fileTab],
          })}
        />,
      );

      fireEvent.contextMenu(screen.getByRole("button", { name: "app.conf" }));
      await user.click(screen.getByRole("menuitem", { name: "复制完整路径" }));
      expect(
        desktopClipboardMocks.writeDesktopClipboardText,
      ).toHaveBeenCalledWith("/etc/app.conf");

      fireEvent.contextMenu(screen.getByRole("button", { name: "app.conf" }));
      await user.click(
        screen.getByRole("menuitem", { name: "在 SFTP 中显示" }),
      );
      expect(onRevealWorkspaceFileInSftp).toHaveBeenCalledWith(fileTab.id);

      fireEvent.contextMenu(screen.getByRole("button", { name: "app.conf" }));
      await user.click(screen.getByRole("menuitem", { name: "重新加载" }));
      expect(commandEvents).toContainEqual({
        command: "reload",
        tabId: fileTab.id,
      });
    } finally {
      window.removeEventListener(
        WORKSPACE_FILE_TAB_COMMAND_EVENT,
        handleCommand,
      );
    }
  });

  it("closes tabs immediately when close confirmation is disabled", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          onCloseTab,
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
          terminalAppearance: {
            ...defaultAppSettings.terminal,
            confirmCloseTab: false,
          },
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "dev.internal #2" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));

    expect(
      screen.queryByRole("dialog", { name: "确认关闭标签" }),
    ).not.toBeInTheDocument();
    expect(onCloseTab).toHaveBeenCalledWith("tab-lab");
  });

  it("lets the tab right-click menu follow the document theme", () => {
    document.documentElement.classList.add("dark");
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "dev.internal #2" }),
    );

    const menu = screen.getByRole("menu", { name: "终端标签操作菜单" });
    expect(document.documentElement).toHaveClass("dark");
    expect(menu).not.toHaveClass("dark");
    document.documentElement.classList.remove("dark");
    expect(menu).not.toHaveClass("dark");
  });

  it("renames a terminal tab from the right-click menu", async () => {
    const user = userEvent.setup();
    const onRenameTab = vi.fn();

    function ControlledWorkspace() {
      const [tabs, setTabs] = useState(groupedSshTabs);

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onRenameTab: (tabId, title) => {
              onRenameTab(tabId, title);
              setTabs((current) =>
                current.map((tab) =>
                  tab.id === tabId ? { ...tab, title } : tab,
                ),
              );
            },
            panes: groupedSshPanes,
            tabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "dev.internal #2" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "重命名标签" }));
    expect(
      screen.getByRole("dialog", { name: "重命名标签" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("标签名称"));
    await user.type(screen.getByLabelText("标签名称"), "生产日志");
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(onRenameTab).toHaveBeenCalledWith("tab-dev-b", "生产日志");
    expect(
      screen.getByRole("button", { name: "生产日志" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "dev.internal #2" }),
    ).not.toBeInTheDocument();
  });

  it("edits a terminal tab group name and color from the group menu", async () => {
    const user = userEvent.setup();
    const onUpdateTabGroupPreference = vi.fn();

    function ControlledWorkspace() {
      const [tabGroupPreferences, setTabGroupPreferences] =
        useState<TerminalTabGroupPreferences>({});

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onUpdateTabGroupPreference: (groupId, preference) => {
              onUpdateTabGroupPreference(groupId, preference);
              setTabGroupPreferences((current) => ({
                ...current,
                [groupId]: preference,
              }));
            },
            panes: groupedSshPanes,
            tabGroupPreferences,
            tabs: groupedSshTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "编辑分组" }));
    expect(
      screen.getByRole("dialog", { name: "编辑标签组" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("分组名称"));
    await user.type(screen.getByLabelText("分组名称"), "生产组");
    await user.click(screen.getByRole("button", { name: "选择粉色分组颜色" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onUpdateTabGroupPreference).toHaveBeenCalledWith("host-dev", {
      color: "pink",
      title: "生产组",
    });
    expect(
      screen.getByRole("button", { name: "折叠 生产组 标签组" }),
    ).toBeInTheDocument();
  });

}
