import { useState, type ComponentProps, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../settings/settingsModel";
import type { TerminalPane, TerminalTab } from "../workspace/types";
import { TerminalWorkspace } from "./TerminalWorkspace";

const xtermPaneMockState = vi.hoisted(() => ({
  renderCount: 0,
  shouldThrow: false,
}));

vi.mock("./XtermPane", () => ({
  XtermPane: ({
    onOpenLogs,
    onSplitPane,
    title,
  }: {
    onOpenLogs?: () => void;
    onSplitPane?: (direction: "horizontal" | "vertical") => void;
    title: string;
  }) => {
    xtermPaneMockState.renderCount += 1;
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
}));

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

type TerminalWorkspaceProps = ComponentProps<typeof TerminalWorkspace>;

const baseTerminalPane: TerminalPane = {
  id: "pane-local",
  lines: [],
  machineId: "local-powershell",
  mode: "local",
  prompt: "PS>",
  status: "online",
  title: "本地 PowerShell",
};

const baseTerminalTab: TerminalTab = {
  id: "tab-local",
  layout: {
    type: "pane",
    paneId: "pane-local",
  },
  machineId: "local-powershell",
  title: "本地 PowerShell",
};

const sftpTransferTab: TerminalTab = {
  id: "tab-sftp-transfer-1",
  kind: "sftpTransfer",
  leftHostId: "host-left",
  lockedLeftHostId: "host-left",
  machineId: "host-left",
  rightHostId: "host-right",
  title: "host-left 传输",
};

function workspaceProps(
  overrides: Partial<TerminalWorkspaceProps> = {},
): TerminalWorkspaceProps {
  return {
    activeTabId: "tab-local",
    broadcastDraft: "",
    focusedPaneId: "pane-local",
    onBroadcastCommand: vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-local"],
    }),
    onBroadcastDraftChange: vi.fn(),
    onClosePane: vi.fn(),
    onCloseTab: vi.fn(),
    onFocusPane: vi.fn(),
    onRenameTab: vi.fn(),
    onSelectTab: vi.fn(),
    onSplitPane: vi.fn(),
    panes: [baseTerminalPane],
    resolvedTheme: "dark",
    tabs: [baseTerminalTab],
    terminalAppearance: defaultAppSettings.terminal,
    ...overrides,
  };
}

const batchPanes = [
  {
    ...baseTerminalPane,
    id: "pane-batch-local",
    mode: "local" as const,
    title: "本地批量",
  },
  {
    ...baseTerminalPane,
    id: "pane-batch-ssh",
    machineId: "host-batch",
    mode: "ssh" as const,
    remoteHostId: "host-batch",
    title: "SSH 批量",
  },
];

const batchTabs = [
  {
    id: "tab-batch",
    layout: {
      type: "split" as const,
      id: "split-batch",
      direction: "horizontal" as const,
      children: [
        { type: "pane" as const, paneId: "pane-batch-local" },
        { type: "pane" as const, paneId: "pane-batch-ssh" },
      ],
    },
    machineId: "host-batch",
    title: "批量终端",
  },
];

const mixedSplitPanes = [
  {
    ...baseTerminalPane,
    id: "pane-split-local",
    mode: "local" as const,
    title: "分屏本地",
  },
  {
    ...baseTerminalPane,
    id: "pane-split-preview",
    mode: "preview" as const,
    title: "辅助分屏",
  },
];

const mixedSplitTabs = [
  {
    id: "tab-mixed-split",
    layout: {
      type: "split" as const,
      id: "split-mixed",
      direction: "horizontal" as const,
      children: [
        { type: "pane" as const, paneId: "pane-split-local" },
        { type: "pane" as const, paneId: "pane-split-preview" },
      ],
    },
    machineId: "local-powershell",
    title: "混合分屏",
  },
];

const previewOnlyPanes = [
  {
    ...baseTerminalPane,
    id: "pane-preview-a",
    mode: "preview" as const,
    title: "只读分屏 A",
  },
  {
    ...baseTerminalPane,
    id: "pane-preview-b",
    mode: "preview" as const,
    title: "只读分屏 B",
  },
];

const previewOnlyTabs = [
  {
    id: "tab-preview-only",
    layout: {
      type: "split" as const,
      id: "split-preview-only",
      direction: "horizontal" as const,
      children: [
        { type: "pane" as const, paneId: "pane-preview-a" },
        { type: "pane" as const, paneId: "pane-preview-b" },
      ],
    },
    machineId: "local-powershell",
    title: "只读分屏",
  },
];

const alternateLocalTabs = [
  baseTerminalTab,
  {
    id: "tab-alt-local",
    layout: {
      type: "pane" as const,
      paneId: "pane-local",
    },
    machineId: "local-powershell",
    title: "备用本地终端",
  },
];

const manyTerminalTabs: TerminalTab[] = Array.from(
  { length: 12 },
  (_, index) => ({
    id: `tab-many-${index + 1}`,
    layout: {
      type: "pane" as const,
      paneId: "pane-local",
    },
    machineId: `host-many-${index + 1}`,
    title: `远程会话 ${index + 1}`,
  }),
);

const groupedSshPanes = [
  {
    ...baseTerminalPane,
    id: "pane-dev-a",
    machineId: "host-dev",
    mode: "ssh" as const,
    remoteHostId: "host-dev",
    title: "dev session A",
  },
  {
    ...baseTerminalPane,
    id: "pane-dev-b",
    machineId: "host-dev",
    mode: "ssh" as const,
    remoteHostId: "host-dev",
    title: "dev session B",
  },
  {
    ...baseTerminalPane,
    id: "pane-lab",
    machineId: "host-lab",
    mode: "ssh" as const,
    remoteHostId: "host-lab",
    title: "lab session",
  },
];

const groupedSshTabs = [
  {
    id: "tab-dev-a",
    layout: {
      type: "pane" as const,
      paneId: "pane-dev-a",
    },
    machineId: "host-dev",
    title: "dev.internal",
  },
  {
    id: "tab-dev-b",
    layout: {
      type: "pane" as const,
      paneId: "pane-dev-b",
    },
    machineId: "host-dev",
    title: "dev.internal #2",
  },
  {
    id: "tab-lab",
    layout: {
      type: "pane" as const,
      paneId: "pane-lab",
    },
    machineId: "host-lab",
    title: "lab.internal",
  },
];

const crashingPane = {
  ...baseTerminalPane,
  id: "pane-crash",
  mode: "local" as const,
  title: "崩溃终端",
};

const crashingTabs = [
  {
    id: "tab-crash",
    layout: {
      type: "pane" as const,
      paneId: "pane-crash",
    },
    machineId: "local-powershell",
    title: "异常分屏",
  },
];

describe("TerminalWorkspace", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  beforeEach(() => {
    xtermPaneMockState.renderCount = 0;
    xtermPaneMockState.shouldThrow = false;
  });

  it("renders the active local tab and terminal pane", () => {
    render(<TerminalWorkspace {...workspaceProps()} />);

    expect(
      screen.getByRole("main", { name: "终端工作区" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 PowerShell" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("本地 PowerShell xterm 终端"))
      .toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建终端 tab" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("终端配置")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "左右分屏" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("批量命令")).not.toBeInTheDocument();
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
    render(<TerminalWorkspace {...workspaceProps({ interfaceDensity: "compact" })} />);

    const workspace = screen.getByRole("main", { name: "终端工作区" });
    expect(workspace).toHaveAttribute("data-density", "compact");
    expect(workspace.firstElementChild).toHaveClass("h-10");
  });

  it("isolates terminal pane render errors and opens logs from the fallback", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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
    render(<TerminalWorkspace {...workspaceProps({ tabs: alternateLocalTabs })} />);

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
    await user.click(within(menu).getByRole("menuitem", { name: /远程会话 7/ }));

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
    expect(screen.getByRole("button", { name: "dev.internal #2" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );

    expect(
      screen.getByRole("button", { name: "展开 dev.internal 标签组" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "dev.internal #2" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lab.internal" })).toBeInTheDocument();
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

    fireEvent.contextMenu(screen.getByRole("button", { name: "dev.internal #2" }));
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

    fireEvent.contextMenu(screen.getByRole("button", { name: "dev.internal #2" }));

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
                current.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
              );
            },
            panes: groupedSshPanes,
            tabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "dev.internal #2" }));
    await user.click(screen.getByRole("menuitem", { name: "重命名标签" }));
    expect(screen.getByRole("dialog", { name: "重命名标签" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("标签名称"));
    await user.type(screen.getByLabelText("标签名称"), "生产日志");
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(onRenameTab).toHaveBeenCalledWith("tab-dev-b", "生产日志");
    expect(screen.getByRole("button", { name: "生产日志" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "dev.internal #2" }),
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

  it("updates the broadcast command draft", async () => {
    const user = userEvent.setup();
    const onBroadcastDraftChange = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-mixed-split",
            broadcastDraft,
            focusedPaneId: "pane-split-local",
            onBroadcastDraftChange: (draft) => {
              setBroadcastDraft(draft);
              onBroadcastDraftChange(draft);
            },
            panes: mixedSplitPanes,
            tabs: mixedSplitTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");

    expect(onBroadcastDraftChange).toHaveBeenLastCalledWith("uptime");
  });

  it("sends a safe command to the active local pane without confirmation", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-split-local"],
    });

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-mixed-split",
            broadcastDraft,
            focusedPaneId: "pane-split-local",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: mixedSplitPanes,
            tabs: mixedSplitTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");
    await user.click(screen.getByRole("button", { name: "发送到全部" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "uptime",
      data: "uptime\r",
      targetPaneIds: ["pane-split-local"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("已发送到 1 个分屏");
    expect(screen.getByLabelText("批量命令")).toHaveValue("");
  });

  it("asks for confirmation before sending to multiple or SSH panes", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: ["pane-batch-ssh"],
      sentPaneIds: ["pane-batch-local"],
    });
    const onBroadcastDraftChange = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-batch",
            broadcastDraft,
            focusedPaneId: "pane-batch-local",
            onBroadcastCommand,
            onBroadcastDraftChange: (draft) => {
              setBroadcastDraft(draft);
              onBroadcastDraftChange(draft);
            },
            panes: batchPanes,
            tabs: batchTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.click(screen.getByLabelText("批量命令"));
    expect(screen.getByLabelText("批量命令")).toHaveFocus();
    await user.keyboard("systemctl status nginx");
    expect(onBroadcastDraftChange).toHaveBeenCalled();
    expect(screen.getByLabelText("批量命令")).toHaveValue(
      "systemctl status nginx",
    );
    expect(screen.getByRole("button", { name: "发送到全部" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送到全部" }));

    expect(
      screen.getByRole("dialog", { name: "确认批量发送" }),
    ).toBeInTheDocument();
    expect(screen.getByText("将发送到 2 个分屏")).toBeInTheDocument();
    expect(screen.getByText("包含远程分屏")).toBeInTheDocument();
    expect(onBroadcastCommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认发送" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "systemctl status nginx",
      data: "systemctl status nginx\r",
      targetPaneIds: ["pane-batch-local", "pane-batch-ssh"],
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 个分屏尚未连接",
    );
  });

  it("disables broadcast when the active tab has no real terminal panes", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-preview-only",
            broadcastDraft,
            focusedPaneId: "pane-preview-a",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: previewOnlyPanes,
            tabs: previewOnlyTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");

    expect(screen.getByRole("button", { name: "发送到全部" })).toBeDisabled();
    expect(onBroadcastCommand).not.toHaveBeenCalled();
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
