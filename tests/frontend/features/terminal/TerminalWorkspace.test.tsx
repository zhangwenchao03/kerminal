import { useState, type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import type {
  TerminalPane,
  TerminalTab,
  TerminalTabGroupPreferences,
} from "../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../src/features/terminal/TerminalWorkspace";
import { terminalChromeRuntimeStore } from "../../../../src/features/terminal/terminalChromeRuntimeStore";
import {
  WORKSPACE_FILE_TAB_COMMAND_EVENT,
  type WorkspaceFileTabCommandEventDetail,
} from "../../../../src/features/workspace/workspaceFileTabActions";
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
  terminalMachineGroups,
  workspaceProps,
} from "../../support/terminal/TerminalWorkspace.testSupport.ts";

const xtermPaneMockState = vi.hoisted(() => ({
  mountedPaneIds: [] as string[],
  renderCount: 0,
  shouldThrow: false,
  unmountedPaneIds: [] as string[],
}));

const resizableMockState = vi.hoisted(() => ({
  groups: [] as Array<{
    defaultLayout?: Record<string, number>;
    id?: string;
    onLayoutChanged?: (layout: Record<string, number>) => void;
  }>,
}));

const desktopClipboardMocks = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

function mockTabListMetrics({
  clientWidth,
  scrollWidth,
}: {
  clientWidth: number;
  scrollWidth: number;
}) {
  const clientWidthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "终端标签栏" ? clientWidth : 0;
    });
  const scrollWidthSpy = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "终端标签栏" ? scrollWidth : 0;
    });

  return () => {
    clientWidthSpy.mockRestore();
    scrollWidthSpy.mockRestore();
  };
}

vi.mock("../../../../src/features/terminal/XtermPane", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    XtermPane: ({
      onConnectionStateChange,
      onOpenLogs,
      onSplitPane,
      paneId,
      title,
    }: {
      onConnectionStateChange?: (state: "closed") => void;
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
          <button
            onClick={() => onConnectionStateChange?.("closed")}
            type="button"
          >
            测试关闭状态
          </button>
        </div>
      );
    },
  };
});

vi.mock("../../../../src/components/ui/resizable", () => ({
  ResizableHandle: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div aria-label={ariaLabel} role="separator" />
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanelGroup: ({
    children,
    defaultLayout,
    id,
    onLayoutChanged,
  }: {
    children: ReactNode;
    defaultLayout?: Record<string, number>;
    id?: string;
    onLayoutChanged?: (layout: Record<string, number>) => void;
  }) => (
    resizableMockState.groups.push({ defaultLayout, id, onLayoutChanged }),
    (
      <div
        data-default-layout={JSON.stringify(defaultLayout ?? null)}
        data-panel-group-id={id}
      >
        {children}
      </div>
    )
  ),
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardMocks.writeDesktopClipboardText(...args),
}));

describe("TerminalWorkspace", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    terminalChromeRuntimeStore.reset();
  });

  beforeEach(() => {
    xtermPaneMockState.mountedPaneIds = [];
    xtermPaneMockState.renderCount = 0;
    xtermPaneMockState.shouldThrow = false;
    xtermPaneMockState.unmountedPaneIds = [];
    resizableMockState.groups = [];
    desktopClipboardMocks.writeDesktopClipboardText.mockReset();
    desktopClipboardMocks.writeDesktopClipboardText.mockResolvedValue({
      ok: true,
    });
    terminalChromeRuntimeStore.reset();
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
      screen.getByRole("button", { name: "本地 PowerShell 左右分屏" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 PowerShell 上下分屏" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "关闭当前分屏" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("批量命令")).not.toBeInTheDocument();
  });

  it("derives terminal tab status from its pane status", () => {
    const offlinePane: TerminalPane = {
      ...baseTerminalPane,
      status: "offline",
    };

    render(<TerminalWorkspace {...workspaceProps({ panes: [offlinePane] })} />);

    const tabButton = screen.getByRole("button", { name: "本地 PowerShell" });
    expect(
      tabButton.parentElement?.querySelector("span[aria-hidden='true']"),
    ).toHaveClass("bg-zinc-400");
  });

  it("forwards pane connection state changes from xterm panes", () => {
    const onPaneConnectionStateChange = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({ onPaneConnectionStateChange })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试关闭状态" }));

    expect(onPaneConnectionStateChange).toHaveBeenCalledWith(
      baseTerminalPane.id,
      "closed",
    );
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
    const { container, rerender } = render(
      <TerminalWorkspace {...workspaceProps()} />,
    );

    expect(xtermPaneMockState.mountedPaneIds).toEqual([baseTerminalPane.id]);
    expect(
      container.querySelector('[data-panel-group-id="tab-local"]'),
    ).toBeInTheDocument();

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
    expect(
      container.querySelector('[data-panel-group-id="tab-local"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-panel-group-id="split-local-1"]'),
    ).not.toBeInTheDocument();
    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      baseTerminalPane.id,
      nextPane.id,
    ]);
  });

  it("restores persisted split sizes and reports resize changes", () => {
    const onSplitLayoutSizesChange = vi.fn();
    const rightPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-2",
      title: "右侧分屏",
    };
    const splitTab: TerminalTab = {
      id: baseTerminalTab.id,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          { paneId: rightPane.id, type: "pane" },
        ],
        direction: "horizontal",
        id: "split-local-1",
        sizes: {
          [baseTerminalPane.id]: 31.25,
          [rightPane.id]: 68.75,
        },
        type: "split",
      },
      machineId: baseTerminalTab.machineId,
      title: baseTerminalTab.title,
    };

    render(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: rightPane.id,
          onSplitLayoutSizesChange,
          panes: [baseTerminalPane, rightPane],
          tabs: [splitTab],
        })}
      />,
    );

    const rootGroup = resizableMockState.groups.find(
      (group) => group.id === "tab-local",
    );
    expect(rootGroup?.defaultLayout).toEqual({
      [baseTerminalPane.id]: 31.25,
      [rightPane.id]: 68.75,
    });

    rootGroup?.onLayoutChanged?.({
      [baseTerminalPane.id]: 42,
      [rightPane.id]: 58,
    });

    expect(onSplitLayoutSizesChange).toHaveBeenCalledWith("split-local-1", {
      [baseTerminalPane.id]: 42,
      [rightPane.id]: 58,
    });
  });

  it("renders existing and new terminal panes when a nested split is added", () => {
    const rightPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-2",
      title: "右侧分屏",
    };
    const bottomPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-3",
      title: "下方分屏",
    };
    const splitTab: TerminalTab = {
      id: baseTerminalTab.id,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          { paneId: rightPane.id, type: "pane" },
        ],
        direction: "horizontal",
        id: "split-local-1",
        type: "split",
      },
      machineId: baseTerminalTab.machineId,
      title: baseTerminalTab.title,
    };
    const nestedSplitTab: TerminalTab = {
      ...splitTab,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          {
            children: [
              { paneId: rightPane.id, type: "pane" },
              { paneId: bottomPane.id, type: "pane" },
            ],
            direction: "vertical",
            id: "split-local-2",
            type: "split",
          },
        ],
        direction: "horizontal",
        id: "split-local-1",
        type: "split",
      },
    };
    const { rerender } = render(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: rightPane.id,
          panes: [baseTerminalPane, rightPane],
          tabs: [splitTab],
        })}
      />,
    );

    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      baseTerminalPane.id,
      rightPane.id,
    ]);

    rerender(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: bottomPane.id,
          panes: [baseTerminalPane, rightPane, bottomPane],
          tabs: [nestedSplitTab],
        })}
      />,
    );

    expect(
      screen.getByLabelText("本地 PowerShell xterm 终端"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("右侧分屏 xterm 终端")).toBeInTheDocument();
    expect(screen.getByLabelText("下方分屏 xterm 终端")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "添加连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "本地终端" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 Agent 面板" }),
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
    expect(workspace.firstElementChild).toHaveClass("h-9");
  });

  it("does not reserve right titlebar control space when controls are on macOS left", () => {
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 320,
      scrollWidth: 960,
    });

    try {
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
    } finally {
      restoreTabListMetrics();
    }
  });

  it("reserves left titlebar control space when window chrome overlaps the tab bar", () => {
    render(
      <TerminalWorkspace {...workspaceProps({ leftTitleBarInset: 112 })} />,
    );

    const tabBar = screen.getByLabelText("终端标签栏").parentElement;

    expect(tabBar).toHaveStyle({ paddingLeft: "112px" });
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

  it("confirms before closing a dirty workspace file tab", async () => {
    const user = userEvent.setup();
    const onCloseTab = vi.fn();
    const fileTab: TerminalTab = {
      access: "editable",
      id: "tab-file-dirty",
      kind: "workspaceFile",
      machineId: "host-prod",
      path: "/etc/app.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
      title: "app.conf",
    };

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: fileTab.id,
          focusedPaneId: "",
          onCloseTab,
          panes: [],
          renderCustomTab: () => <div>file surface</div>,
          tabs: [fileTab],
          workspaceFileDirtyState: { [fileTab.id]: true },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "关闭 app.conf tab" }));

    expect(
      screen.getByRole("dialog", { name: "关闭未保存文件" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCloseTab).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "关闭 app.conf tab" }));
    await user.click(screen.getByRole("button", { name: "放弃修改并关闭" }));

    expect(onCloseTab).toHaveBeenCalledWith(fileTab.id);
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
});
