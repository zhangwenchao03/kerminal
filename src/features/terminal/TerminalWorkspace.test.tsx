import { useState, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../settings/settingsModel";
import type {
  TerminalPane,
  TerminalTab,
  TerminalTabGroupPreferences,
} from "../workspace/types";
import { TerminalWorkspace } from "./TerminalWorkspace";
import {
  alternateLocalTabs,
  baseTerminalPane,
  baseTerminalTab,
  batchPanes,
  batchTabs,
  crashingPane,
  crashingTabs,
  groupedSshPanes,
  groupedSshTabs,
  manyTerminalTabs,
  mixedSplitPanes,
  mixedSplitTabs,
  sftpTransferTab,
  workspaceProps,
} from "./TerminalWorkspace.testSupport";

const xtermPaneMockState = vi.hoisted(() => ({
  mountedPaneIds: [] as string[],
  renderCount: 0,
  shouldThrow: false,
  unmountedPaneIds: [] as string[],
}));

vi.mock("./XtermPane", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    XtermPane: ({
      onOpenLogs,
      onSplitPane,
      paneId,
      title,
    }: {
      onOpenLogs?: () => void;
      onSplitPane?: (direction: "horizontal" | "vertical") => void;
      paneId: string;
      title: string;
    }) => {
      xtermPaneMockState.renderCount += 1;
      React.useEffect(() => {
        xtermPaneMockState.mountedPaneIds.push(paneId);
        return () => {
          xtermPaneMockState.unmountedPaneIds.push(paneId);
        };
      }, [paneId]);
      if (xtermPaneMockState.shouldThrow) {
        throw new Error("xterm render exploded");
      }

      return (
        <div aria-label={`${title} xterm 终端`}>
          本地终端测试替身
          <button onClick={onOpenLogs} type="button">
            测试打开日志
          </button>
          <button onClick={() => onSplitPane?.("horizontal")} type="button">
            测试左右分屏
          </button>
        </div>
      );
    },
  };
});

vi.mock("../../components/ui/resizable", () => ({
  ResizableHandle: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div aria-label={ariaLabel} role="separator" />
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("TerminalWorkspace", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  beforeEach(() => {
    xtermPaneMockState.mountedPaneIds = [];
    xtermPaneMockState.renderCount = 0;
    xtermPaneMockState.shouldThrow = false;
    xtermPaneMockState.unmountedPaneIds = [];
  });

  it("renders the active local tab and terminal pane", () => {
    render(<TerminalWorkspace {...workspaceProps()} />);

    expect(
      screen.getByRole("main", { name: "终端工作区" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 PowerShell" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("本地 PowerShell xterm 终端"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建终端 tab" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("终端配置")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "左右分屏" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("批量命令")).not.toBeInTheDocument();
  });

  it("keeps the existing terminal pane mounted when a split is added", () => {
    const nextPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-2",
      title: "右侧分屏",
    };
    const splitTab: TerminalTab = {
      id: baseTerminalTab.id,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          { paneId: nextPane.id, type: "pane" },
        ],
        direction: "horizontal",
        id: "split-local-1",
        type: "split",
      },
      machineId: baseTerminalTab.machineId,
      title: baseTerminalTab.title,
    };
    const { rerender } = render(<TerminalWorkspace {...workspaceProps()} />);

    expect(xtermPaneMockState.mountedPaneIds).toEqual([baseTerminalPane.id]);

    rerender(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: nextPane.id,
          panes: [baseTerminalPane, nextPane],
          tabs: [splitTab],
        })}
      />,
    );

    expect(xtermPaneMockState.unmountedPaneIds).not.toContain(
      baseTerminalPane.id,
    );
    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      baseTerminalPane.id,
      nextPane.id,
    ]);
  });

  it("keeps the no-tab empty state as a quiet brand placeholder", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "",
          focusedPaneId: "",
          panes: [],
          tabs: [],
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Kerminal" })).toBeInTheDocument();
    expect(
      screen.getByText("光标还没闪，AI 已经开始脑补命令了。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "添加连接" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "本地终端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 AI 面板" }),
    ).not.toBeInTheDocument();
  });

  it("renders custom SFTP transfer tab content without terminal split controls", () => {
    const renderCustomTab = vi.fn((tab: TerminalTab, active: boolean) =>
      tab.kind === "sftpTransfer" ? (
        <div data-active={String(active)}>传输工作台替身</div>
      ) : null,
    );

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-sftp-transfer-1",
          focusedPaneId: "",
          panes: [baseTerminalPane],
          renderCustomTab,
          tabs: [baseTerminalTab, sftpTransferTab],
        })}
      />,
    );

    expect(screen.getByText("传输工作台替身")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(renderCustomTab).toHaveBeenCalledWith(sftpTransferTab, true);
    expect(
      screen.queryByRole("button", { name: "左右分屏" }),
    ).not.toBeInTheDocument();
  });

  it("applies compact workspace density to terminal chrome", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({ interfaceDensity: "compact" })}
      />,
    );

    const workspace = screen.getByRole("main", { name: "终端工作区" });
    expect(workspace).toHaveAttribute("data-density", "compact");
    expect(workspace.firstElementChild).toHaveClass("h-10");
  });

  it("does not reserve right titlebar control space when controls are on macOS left", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-many-1",
          reserveRightTitleBarControls: false,
          tabs: manyTerminalTabs,
        })}
      />,
    );

    const tabBar = screen.getByLabelText("终端标签栏").parentElement;
    const overviewButton = screen.getByRole("button", {
      name: "查看所有标签",
    });

    expect(tabBar).toHaveClass("pr-2");
    expect(tabBar).not.toHaveClass("pr-40");
    expect(overviewButton).toHaveClass("right-3");
    expect(overviewButton).not.toHaveClass("right-28");
  });

  it("isolates terminal pane render errors and opens logs from the fallback", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onOpenLogs = vi.fn();
    xtermPaneMockState.shouldThrow = true;

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-crash",
            focusedPaneId: "pane-crash",
            onOpenLogs,
            panes: [crashingPane],
            tabs: crashingTabs,
          })}
        />,
      );

      expect(screen.getByLabelText("崩溃终端 终端分屏异常")).toHaveClass(
        "min-h-0",
      );
      expect(screen.getByText("终端分屏渲染异常")).toBeInTheDocument();
      expect(screen.getByText("xterm render exploded")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "打开日志" }));

      expect(onOpenLogs).toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "新建终端 tab" }),
      ).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("remounts a failed terminal pane after the render problem is cleared", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    xtermPaneMockState.shouldThrow = true;

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-crash",
            focusedPaneId: "pane-crash",
            panes: [crashingPane],
            tabs: crashingTabs,
          })}
        />,
      );

      expect(screen.getByText("终端分屏渲染异常")).toBeInTheDocument();
      xtermPaneMockState.shouldThrow = false;
      await user.click(screen.getByRole("button", { name: "重新挂载" }));

      expect(screen.getByLabelText("崩溃终端 xterm 终端")).toBeInTheDocument();
      expect(screen.queryByText("终端分屏渲染异常")).not.toBeInTheDocument();
      expect(xtermPaneMockState.renderCount).toBeGreaterThan(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("requests tab selection when the user switches tabs", async () => {
    const user = userEvent.setup();
    const onSelectTab = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({ onSelectTab, tabs: alternateLocalTabs })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "备用本地终端" }));

    expect(onSelectTab).toHaveBeenCalledWith("tab-alt-local");
  });

  it("allows closing the only tab from the tab close button", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();

    render(<TerminalWorkspace {...workspaceProps({ onCloseTab })} />);

    await user.click(
      screen.getByRole("button", { name: "关闭 本地 PowerShell tab" }),
    );
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTab).toHaveBeenCalledWith("tab-local");
  });

  it("allows closing the only tab from the right-click menu", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();

    render(<TerminalWorkspace {...workspaceProps({ onCloseTab })} />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地 PowerShell" }),
    );
    const closeMenuItem = screen.getByRole("menuitem", { name: "关闭标签" });

    expect(closeMenuItem).toBeEnabled();
    await user.click(closeMenuItem);
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTab).toHaveBeenCalledWith("tab-local");
  });

  it("shows tab numbers when enabled in terminal appearance", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          tabs: alternateLocalTabs,
          terminalAppearance: {
            ...defaultAppSettings.terminal,
            showTabNumbers: true,
          },
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "1 · 本地 PowerShell" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "2 · 备用本地终端" }),
    ).toBeInTheDocument();
  });

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

  it("opens an all-tabs menu from the right side of the tab bar", async () => {
    const user = userEvent.setup();
    const onSelectTab = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-many-1",
          onSelectTab,
          tabs: manyTerminalTabs,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "查看所有标签" }));

    const menu = screen.getByRole("menu", { name: "所有终端标签" });
    expect(within(menu).getByText("12 个")).toBeInTheDocument();
    await user.click(
      within(menu).getByRole("menuitem", { name: /远程会话 7/ }),
    );

    expect(onSelectTab).toHaveBeenCalledWith("tab-many-7");
    expect(
      screen.queryByRole("menu", { name: "所有终端标签" }),
    ).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "左右分屏" }));
    await user.click(screen.getByRole("button", { name: "上下分屏" }));

    expect(onSplitPane).toHaveBeenNthCalledWith(1, "horizontal");
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "vertical");
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
    expect(onSplitPane).toHaveBeenCalledWith("horizontal");
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

    await user.click(screen.getByRole("button", { name: "关闭当前分屏" }));

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
});
