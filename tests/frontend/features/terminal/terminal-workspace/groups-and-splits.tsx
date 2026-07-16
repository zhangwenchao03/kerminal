import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type {
  TerminalTabGroupPreferences,
} from "../../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import { terminalChromeRuntimeStore } from "../../../../../src/features/terminal/terminalChromeRuntimeStore";
import {
  batchPanes,
  batchTabs,
  groupedSshPanes,
  groupedSshTabs,
  mixedSplitPanes,
  mixedSplitTabs,
  terminalMachineGroups,
  workspaceProps,
} from "../../../support/terminal/TerminalWorkspace.testSupport.ts";
import {
  mockTabListMetrics,
} from "./setup";

export function registerGroupAndSplitTests() {
  it("shows pane attention in the all-tabs overview without online status dots", async () => {
    const user = userEvent.setup();
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
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
          })}
        />,
      );
      act(() => {
        terminalChromeRuntimeStore.register("pane-dev-b", { visible: false });
        terminalChromeRuntimeStore.update("pane-dev-b", { type: "output" });
      });

      await user.click(screen.getByRole("button", { name: "查看所有标签" }));
      const menu = screen.getByRole("menu", { name: "所有终端标签" });
      const unreadTab = within(menu).getByRole("menuitem", {
        name: /dev.internal #2/,
      });

      expect(within(unreadTab).getByLabelText("有未读输出")).toBeInTheDocument();
      expect(unreadTab.querySelector(".bg-emerald-400")).toBeNull();
    } finally {
      restoreTabListMetrics();
    }
  });

  it("shows a singleton identity accent only after an explicit color is saved", async () => {
    const user = userEvent.setup();
    const onUpdateTabGroupPreference = vi.fn();

    function ControlledWorkspace() {
      const [tabGroupPreferences, setTabGroupPreferences] =
        useState<TerminalTabGroupPreferences>({});

      return (
        <TerminalWorkspace
          {...workspaceProps({
            onUpdateTabGroupPreference: (groupId, preference) => {
              onUpdateTabGroupPreference(groupId, preference);
              setTabGroupPreferences((current) => ({
                ...current,
                [groupId]: preference,
              }));
            },
            tabGroupPreferences,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    const tabButton = screen.getByRole("button", { name: "本地 PowerShell" });
    expect(
      tabButton.parentElement?.querySelector("[data-terminal-identity-accent]"),
    ).toBeNull();

    fireEvent.contextMenu(tabButton);
    await user.click(screen.getByRole("menuitem", { name: "设置标识颜色" }));
    expect(
      screen.getByRole("dialog", { name: "设置标签标识" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择粉色分组颜色" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onUpdateTabGroupPreference).toHaveBeenLastCalledWith(
      "local-powershell",
      { color: "pink" },
    );
    expect(
      tabButton.parentElement?.querySelector(
        '[data-terminal-identity-accent="pink"][data-terminal-identity-source="explicit"]',
      ),
    ).not.toBeNull();

    fireEvent.contextMenu(tabButton);
    await user.click(screen.getByRole("menuitem", { name: "设置标识颜色" }));
    await user.click(
      screen.getByRole("button", { name: "选择自动标识颜色" }),
    );
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onUpdateTabGroupPreference).toHaveBeenLastCalledWith(
      "local-powershell",
      {},
    );
    expect(
      tabButton.parentElement?.querySelector("[data-terminal-identity-accent]"),
    ).toBeNull();
  });

  it("subscribes tab chrome to pane activity snapshots", async () => {
    render(<TerminalWorkspace {...workspaceProps()} />);

    expect(screen.queryByLabelText("有未读输出")).not.toBeInTheDocument();

    act(() => {
      terminalChromeRuntimeStore.register("pane-local", { visible: false });
      terminalChromeRuntimeStore.update("pane-local", { type: "output" });
    });

    expect(await screen.findByLabelText("有未读输出")).toBeInTheDocument();
  });

  it("aggregates attention on collapsed groups without duplicating it while expanded", async () => {
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

    act(() => {
      terminalChromeRuntimeStore.register("pane-dev-a", { visible: false });
      terminalChromeRuntimeStore.register("pane-dev-b", { visible: false });
      terminalChromeRuntimeStore.update("pane-dev-a", { type: "output" });
      terminalChromeRuntimeStore.update("pane-dev-b", { type: "output" });
    });

    expect(await screen.findAllByLabelText("有未读输出")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );

    expect(
      screen.getByLabelText("2 个标签页：有未读输出"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("有未读输出")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "展开 dev.internal 标签组" }),
    );
    expect(screen.getAllByLabelText("有未读输出")).toHaveLength(2);
    expect(
      screen.queryByLabelText("2 个标签页：有未读输出"),
    ).not.toBeInTheDocument();
  });

  it("opens a right-click menu for terminal tab groups", async () => {
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

    const groupButton = screen.getByRole("button", {
      name: "折叠 dev.internal 标签组",
    });
    fireEvent.contextMenu(groupButton);
    await user.click(screen.getByRole("menuitem", { name: "关闭其他分组" }));
    expect(
      screen.getByRole("dialog", { name: "确认关闭标签" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTab).toHaveBeenCalledWith("tab-lab");
  });

  it("requests horizontal and vertical splits", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          onSplitPane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    const focusedPane = within(screen.getByLabelText("本地批量 终端分屏"));

    await user.click(
      focusedPane.getByRole("button", { name: "本地批量 左右分屏" }),
    );
    await user.click(
      focusedPane.getByRole("button", { name: "本地批量 上下分屏" }),
    );

    expect(onSplitPane).toHaveBeenNthCalledWith(1, "horizontal", {
      sourcePaneId: "pane-batch-local",
    });
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "vertical", {
      sourcePaneId: "pane-batch-local",
    });
  });

  it("can split the active tab to a selected host from the split button menu", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          onSplitPane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地批量 左右分屏" }),
    );
    const splitTargetMenu = screen.getByRole("menu", {
      name: "左右分屏目标选择",
    });

    expect(
      within(splitTargetMenu).getByRole("menuitem", { name: /生产 SSH/ }),
    ).toBeInTheDocument();
    expect(
      within(splitTargetMenu).queryByRole("menuitem", { name: /办公桌面/ }),
    ).not.toBeInTheDocument();

    await user.click(
      within(splitTargetMenu).getByRole("menuitem", { name: /生产 SSH/ }),
    );

    expect(onSplitPane).toHaveBeenCalledWith("horizontal", {
      sourcePaneId: "pane-batch-local",
      targetMachineId: "host-prod",
    });
    expect(
      screen.queryByRole("menu", { name: "左右分屏目标选择" }),
    ).not.toBeInTheDocument();
  });

  it("opens the split target menu on secondary-button press", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.mouseDown(
      screen.getByRole("button", { name: "本地批量 左右分屏" }),
      { button: 2 },
    );

    expect(
      screen.getByRole("menu", { name: "左右分屏目标选择" }),
    ).toBeInTheDocument();
  });

  it("portals the split target menu outside the pane card", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地批量 左右分屏" }),
    );

    const splitTargetMenu = screen.getByRole("menu", {
      name: "左右分屏目标选择",
    });
    expect(splitTargetMenu.parentElement).toBe(document.body);
    expect(
      splitTargetMenu.closest("[data-terminal-pane-card]"),
    ).not.toBeInTheDocument();
  });

  it("filters split host choices from the split target menu", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          onSplitPane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地批量 上下分屏" }),
    );
    const splitTargetMenu = screen.getByRole("menu", {
      name: "上下分屏目标选择",
    });
    await user.type(
      within(splitTargetMenu).getByLabelText("搜索分屏主机"),
      "serial",
    );

    await user.click(
      within(splitTargetMenu).getByRole("menuitem", { name: /串口控制台/ }),
    );

    expect(onSplitPane).toHaveBeenCalledWith("vertical", {
      sourcePaneId: "pane-batch-local",
      targetMachineId: "serial-console",
    });
  });

  it("passes context menu workspace actions to terminal panes", async () => {
    const user = userEvent.setup();
    const onOpenLogs = vi.fn();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          onOpenLogs,
          onSplitPane,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "测试打开日志" }));
    await user.click(screen.getByRole("button", { name: "测试左右分屏" }));

    expect(onOpenLogs).toHaveBeenCalled();
    expect(onSplitPane).toHaveBeenCalledWith("horizontal", {
      sourcePaneId: "pane-local",
    });
  });

  it("requests closing the focused pane", async () => {
    const user = userEvent.setup();
    const onClosePane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          onClosePane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "关闭 本地批量 分屏" }),
    );

    expect(onClosePane).toHaveBeenCalledWith("pane-batch-local");
  });

  it("renders split panes and focuses a pane when the user selects it", async () => {
    const user = userEvent.setup();
    const onFocusPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-mixed-split",
          focusedPaneId: "pane-split-local",
          onFocusPane,
          panes: mixedSplitPanes,
          tabs: mixedSplitTabs,
        })}
      />,
    );

    expect(screen.getByLabelText(/辅助分屏 终端分屏/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/辅助分屏 终端分屏/i));

    expect(onFocusPane).toHaveBeenCalledWith("pane-split-preview");
  });
}
