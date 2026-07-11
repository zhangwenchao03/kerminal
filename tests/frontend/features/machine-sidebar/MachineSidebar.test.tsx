import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineSidebar } from "../../../../src/features/machine-sidebar/MachineSidebar";
import {
  containerSidebarGroups,
  localSidebarGroups,
  mockElementFromPoint,
  rdpSidebarGroups,
  remoteSidebarGroups,
  terminalTransportSidebarGroups,
} from "../../support/machine-sidebar/MachineSidebar.testSupport";

describe("MachineSidebar", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("renders grouped machines and highlights the selected machine", () => {
    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    expect(
      screen.getByRole("complementary", { name: "主机侧边栏" }),
    ).toBeInTheDocument();
    expect(screen.getByText("默认分组")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /PowerShell/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("虚拟机")).not.toBeInTheDocument();
  });

  it("renders the container browser as a left sidebar resource view", async () => {
    const user = userEvent.setup();
    const onListDockerContainers = vi.fn().mockResolvedValue([]);
    const onContainerHostChange = vi.fn();

    render(
      <MachineSidebar
        activeView="containers"
        groups={remoteSidebarGroups}
        onContainerHostChange={onContainerHostChange}
        onListDockerContainers={onListDockerContainers}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(screen.getByRole("button", { name: "容器" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const hostSearch = screen.getByRole("combobox", { name: "搜索容器主机" });
    expect(hostSearch).toHaveValue("ubuntu-dev");
    expect(screen.queryByRole("listbox", { name: "容器主机列表" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("搜索主机")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开 SFTP 传输工作台" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "刷新容器列表" }));
    await waitFor(() => {
      expect(onListDockerContainers).toHaveBeenCalledTimes(2);
    });

    await user.click(hostSearch);
    expect(
      screen.getByRole("option", { name: /ubuntu-dev/ }),
    ).toHaveAttribute("aria-selected", "true");

    await user.type(hostSearch, "missing");
    expect(screen.getByText("没有匹配的主机。")).toBeInTheDocument();

    await user.clear(hostSearch);
    await user.type(hostSearch, "ubuntu");
    expect(
      screen.getByRole("option", { name: /ubuntu-dev/ }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(onListDockerContainers).toHaveBeenCalledWith({
        hostId: "ubuntu-dev",
        includeStopped: true,
        runtime: "docker",
      });
    });
  });

  it("switches the container browser to the currently selected SSH host", async () => {
    const user = userEvent.setup();
    const onActiveViewChange = vi.fn();
    const onContainerHostChange = vi.fn();

    render(
      <MachineSidebar
        activeView="hosts"
        containerHostId="ubuntu-dev"
        groups={[
          ...remoteSidebarGroups,
          {
            id: "external",
            machines: [
              {
                authType: "password" as const,
                description: "root@172.21.195.223:22",
                host: "172.21.195.223",
                id: "external:launch-1",
                kind: "ssh" as const,
                name: "bastion target",
                port: 22,
                status: "online" as const,
                tags: ["external", "ssh"],
                target: { hostId: "external:launch-1", kind: "ssh" as const },
                username: "root",
              },
            ],
            title: "External",
          },
        ]}
        onActiveViewChange={onActiveViewChange}
        onContainerHostChange={onContainerHostChange}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="external:launch-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "容器" }));

    expect(onContainerHostChange).toHaveBeenCalledWith("external:launch-1");
    expect(onActiveViewChange).toHaveBeenCalledWith("containers");
  });

  it("shows local machines as unopened until a terminal session is open", () => {
    const { rerender } = render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    expect(screen.getByTitle("未打开会话")).toBeInTheDocument();

    rerender(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        openMachineIds={["local-powershell"]}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    expect(screen.getByTitle("已打开会话")).toBeInTheDocument();
  });

  it("collapses and expands all groups from the header action", async () => {
    const user = userEvent.setup();

    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(screen.getByRole("button", { name: /PowerShell/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "折叠所有分组" }));

    expect(
      screen.queryByRole("button", { name: /PowerShell/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ubuntu-dev/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开所有分组" }));

    expect(screen.getByRole("button", { name: /PowerShell/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeInTheDocument();
  });

  it("marks the expanded sidebar header as a native drag region", () => {
    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    expect(
      screen.getByLabelText("左栏视图").closest("[data-tauri-drag-region]"),
    ).toHaveAttribute("data-tauri-drag-region");
    expect(
      screen.getByLabelText("搜索主机").closest("label"),
    ).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("filters machines through the search input", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();

    function ControlledSidebar() {
      const [search, setSearch] = useState("");

      return (
        <MachineSidebar
          groups={localSidebarGroups}
          onSearchChange={(query) => {
            setSearch(query);
            onSearchChange(query);
          }}
          onSelectMachine={vi.fn()}
          search={search}
          selectedMachineId="local-powershell"
        />
      );
    }

    render(<ControlledSidebar />);

    await user.type(screen.getByLabelText("搜索主机"), "Power");

    expect(onSearchChange).toHaveBeenLastCalledWith("Power");
  });

  it("calls selection handler when a machine is chosen", async () => {
    const user = userEvent.setup();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    await user.click(screen.getByRole("button", { name: /PowerShell/i }));

    expect(onSelectMachine).toHaveBeenCalledWith("local-powershell");
  });

  it("dispatches every local machine double click to open a terminal", async () => {
    const user = userEvent.setup();
    const onOpenLocalTerminal = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onOpenLocalTerminal={onOpenLocalTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId=""
      />,
    );

    const localMachine = screen.getByRole("button", { name: /PowerShell/i });
    await user.dblClick(localMachine);
    await user.dblClick(localMachine);

    expect(onSelectMachine).toHaveBeenCalledWith("local-powershell");
    expect(onOpenLocalTerminal).toHaveBeenCalledTimes(2);
    expect(onOpenLocalTerminal).toHaveBeenNthCalledWith(1, "local-powershell");
    expect(onOpenLocalTerminal).toHaveBeenNthCalledWith(2, "local-powershell");
  });

  it("opens settings from the lower-left control", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onOpenSettings={onOpenSettings}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
        settingsSelected
      />,
    );

    const settingsButton = screen.getByRole("button", { name: "打开设置" });
    expect(settingsButton).toHaveAttribute("aria-pressed", "true");

    await user.click(settingsButton);

    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("opens the unified connection dialog from the lower-left add action", async () => {
    const user = userEvent.setup();
    const onAddConnection = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onAddConnection={onAddConnection}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    await user.click(screen.getByRole("button", { name: "添加连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({ mode: "ssh" });
    expect(
      screen.queryByRole("menu", { name: "添加终端或主机" }),
    ).not.toBeInTheDocument();
  });

  it("collapses all machines behind one host entry and opens them in a flyout", async () => {
    const user = userEvent.setup();

    render(
      <MachineSidebar
        collapsed
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(
      screen.getByRole("button", { name: "打开主机列表" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /PowerShell/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ubuntu-dev/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开主机列表" }));

    expect(screen.getByRole("dialog", { name: "主机列表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PowerShell/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText("搜索主机列表"), "ubuntu");

    expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /PowerShell/i })).toBeNull();
  });

  it("opens the SFTP transfer workbench from expanded and collapsed sidebar actions", async () => {
    const user = userEvent.setup();
    const onOpenTransferWorkbench = vi.fn();
    const { rerender } = render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onOpenTransferWorkbench={onOpenTransferWorkbench}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "打开 SFTP 传输工作台" }),
    );

    expect(onOpenTransferWorkbench).toHaveBeenCalledTimes(1);

    rerender(
      <MachineSidebar
        collapsed
        groups={remoteSidebarGroups}
        onOpenTransferWorkbench={onOpenTransferWorkbench}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "打开 SFTP 传输工作台" }),
    );

    expect(onOpenTransferWorkbench).toHaveBeenCalledTimes(2);
  });

  it("keeps settings out of the root context menu", () => {
    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onOpenSettings={vi.fn()}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("complementary", { name: "主机侧边栏" }),
    );

    expect(
      screen.queryByRole("menuitem", { name: "打开设置" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the right-click menu close to the pointer near the viewport bottom", () => {
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 300,
      writable: true,
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute("role") === "menu") {
        return {
          bottom: 76,
          height: 76,
          left: 0,
          right: 224,
          top: 0,
          width: 224,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }

      return originalGetBoundingClientRect.call(this);
    };

    try {
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
        {
          clientX: 100,
          clientY: 260,
        },
      );

      const menu = screen.getByRole("menu", { name: "主机操作菜单" });

      expect(menu.style.left).toBe("100px");
      expect(menu.style.top).toBe("216px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect =
        originalGetBoundingClientRect;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
        writable: true,
      });
    }
  });

  it("lets portal context menu styling follow the document theme", () => {
    document.documentElement.classList.add("dark");
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

    const menu = screen.getByRole("menu", { name: "主机操作菜单" });
    expect(document.documentElement).toHaveClass("dark");
    expect(menu).not.toHaveClass("dark");
    document.documentElement.classList.remove("dark");
    expect(menu).not.toHaveClass("dark");
  });

  it("opens group actions from the right-click menu", async () => {
    const user = userEvent.setup();
    const onAddMachine = vi.fn();
    const onDeleteGroup = vi.fn();
    const onEditGroup = vi.fn();
    const onPinGroup = vi.fn();

    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onAddMachine={onAddMachine}
        onDeleteGroup={onDeleteGroup}
        onEditGroup={onEditGroup}
        onPinGroup={onPinGroup}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /开发主机/ }));
    await user.click(screen.getByRole("menuitem", { name: "重命名分组" }));

    expect(onEditGroup).toHaveBeenCalledWith("group-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /开发主机/ }));
    await user.click(
      screen.getByRole("menuitem", { name: "添加连接到此分组" }),
    );

    expect(onAddMachine).toHaveBeenCalledWith("group-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /开发主机/ }));
    await user.click(screen.getByRole("menuitem", { name: "置顶分组" }));

    expect(onPinGroup).toHaveBeenCalledWith("group-dev", true);

    fireEvent.contextMenu(screen.getByRole("button", { name: /开发主机/ }));
    await user.click(screen.getByRole("menuitem", { name: "删除分组" }));

    expect(onDeleteGroup).toHaveBeenCalledWith("group-dev");
  });

  it("marks pinned groups and offers unpin from the right-click menu", async () => {
    const user = userEvent.setup();
    const onPinGroup = vi.fn();

    render(
      <MachineSidebar
        groups={[
          localSidebarGroups[0],
          { ...remoteSidebarGroups[1], pinned: true, sortOrder: -10 },
        ]}
        onPinGroup={onPinGroup}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    expect(screen.getByText("置顶")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: /开发主机/ }));
    await user.click(screen.getByRole("menuitem", { name: "取消置顶" }));

    expect(onPinGroup).toHaveBeenCalledWith("group-dev", false);
  });

  it("allows the default group to use the same right-click actions", async () => {
    const user = userEvent.setup();
    const onAddMachine = vi.fn();
    const onDeleteGroup = vi.fn();
    const onEditGroup = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onAddMachine={onAddMachine}
        onDeleteGroup={onDeleteGroup}
        onEditGroup={onEditGroup}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /默认分组/ }));
    await user.click(screen.getByRole("menuitem", { name: "重命名分组" }));

    expect(onEditGroup).toHaveBeenCalledWith("__ungrouped__");

    fireEvent.contextMenu(screen.getByRole("button", { name: /默认分组/ }));
    await user.click(
      screen.getByRole("menuitem", { name: "添加连接到此分组" }),
    );

    expect(onAddMachine).toHaveBeenCalledWith("__ungrouped__");

    fireEvent.contextMenu(screen.getByRole("button", { name: /默认分组/ }));
    await user.click(screen.getByRole("menuitem", { name: "删除分组" }));

    expect(onDeleteGroup).toHaveBeenCalledWith("__ungrouped__");
  });

  it("opens machine actions from the right-click menu", async () => {
    const user = userEvent.setup();
    const onDeleteMachine = vi.fn();
    const onDuplicateMachine = vi.fn();
    const onEditMachine = vi.fn();
    const onOpenHostContainers = vi.fn();
    const onOpenSftp = vi.fn();
    const onOpenSshTerminal = vi.fn();
    const onOpenSftpTransferWorkbench = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onDeleteMachine={onDeleteMachine}
        onDuplicateMachine={onDuplicateMachine}
        onEditMachine={onEditMachine}
        onOpenHostContainers={onOpenHostContainers}
        onOpenSftp={onOpenSftp}
        onOpenSshTerminal={onOpenSshTerminal}
        onOpenSftpTransferWorkbench={onOpenSftpTransferWorkbench}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "编辑连接配置" }));

    expect(onSelectMachine).toHaveBeenCalledWith("ubuntu-dev");
    expect(onEditMachine).toHaveBeenCalledWith("ubuntu-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    expect(onDuplicateMachine).toHaveBeenCalledWith("ubuntu-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "打开 SSH 终端" }));

    expect(onOpenSshTerminal).toHaveBeenCalledWith("ubuntu-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "容器" }));

    expect(onOpenHostContainers).toHaveBeenCalledWith("ubuntu-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "打开 SFTP" }));

    expect(onOpenSftp).toHaveBeenCalledWith("ubuntu-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "新建传输 Tab" }));

    expect(onOpenSftpTransferWorkbench).toHaveBeenCalledWith("ubuntu-dev");

    fireEvent.contextMenu(screen.getByRole("button", { name: /ubuntu-dev/i }));
    await user.click(screen.getByRole("menuitem", { name: "删除连接" }));

    expect(onDeleteMachine).toHaveBeenCalledWith("ubuntu-dev");
  });

  it("matches machines by group title and keeps tags in the row tooltip", () => {
    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search="开发"
        selectedMachineId="ubuntu-dev"
      />,
    );

    const hostButton = screen.getByRole("button", { name: /ubuntu-dev/i });
    expect(hostButton).toBeInTheDocument();
    expect(hostButton.getAttribute("title")).toContain("ssh");
    expect(hostButton.getAttribute("title")).toContain("dev");
    expect(screen.queryByText("ssh")).not.toBeInTheDocument();
  });

  it("opens an SSH session when a saved host is double-clicked", () => {
    const onOpenSshTerminal = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onOpenSshTerminal={onOpenSshTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: /ubuntu-dev/i }));

    expect(onSelectMachine).toHaveBeenCalledWith("ubuntu-dev");
    expect(onOpenSshTerminal).toHaveBeenCalledWith("ubuntu-dev");
  });

  it("opens Telnet and Serial terminal sessions when transport hosts are double-clicked", () => {
    const onOpenTelnetTerminal = vi.fn();
    const onOpenSerialTerminal = vi.fn();
    const onOpenSshTerminal = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={terminalTransportSidebarGroups}
        onOpenSerialTerminal={onOpenSerialTerminal}
        onOpenSshTerminal={onOpenSshTerminal}
        onOpenTelnetTerminal={onOpenTelnetTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="telnet-lab"
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: /lab telnet/i }));
    fireEvent.doubleClick(screen.getByRole("button", { name: /console serial/i }));

    expect(onSelectMachine).toHaveBeenCalledWith("telnet-lab");
    expect(onSelectMachine).toHaveBeenCalledWith("serial-console");
    expect(onOpenTelnetTerminal).toHaveBeenCalledWith("telnet-lab");
    expect(onOpenSerialTerminal).toHaveBeenCalledWith("serial-console");
    expect(onOpenSshTerminal).not.toHaveBeenCalled();
  });

  it("moves a dragged machine to another group", () => {
    const onMoveMachine = vi.fn();

    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onMoveMachine={onMoveMachine}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    const targetSection = screen.getByText("默认分组").closest("section")!;
    const restoreElementFromPoint = mockElementFromPoint(targetSection);

    try {
      fireEvent.pointerDown(screen.getByRole("button", { name: /ubuntu-dev/i }), {
        button: 0,
        clientX: 12,
        clientY: 12,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 16,
        clientY: 28,
        pointerId: 1,
      });
      const preview = screen.getByRole("status", { name: "正在拖动主机" });
      expect(preview).toHaveTextContent("ubuntu-dev");
      expect(preview).toHaveTextContent("松开移动到 默认分组");
      expect(screen.getByText("松开移入")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ubuntu-dev/i })).toHaveAttribute(
        "aria-grabbed",
        "true",
      );
      fireEvent.pointerUp(window, {
        clientX: 16,
        clientY: 28,
        pointerId: 1,
      });

      expect(onMoveMachine).toHaveBeenCalledWith("ubuntu-dev", "__ungrouped__");
      expect(
        screen.queryByRole("status", { name: "正在拖动主机" }),
      ).not.toBeInTheDocument();
    } finally {
      restoreElementFromPoint();
    }
  });

  it("opens an RDP connection when a saved RDP host is double-clicked", () => {
    const onOpenRdpConnection = vi.fn();
    const onOpenSshTerminal = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={rdpSidebarGroups}
        onOpenRdpConnection={onOpenRdpConnection}
        onOpenSshTerminal={onOpenSshTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="rdp-office"
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: /office-rdp/i }));

    expect(onSelectMachine).toHaveBeenCalledWith("rdp-office");
    expect(onOpenRdpConnection).toHaveBeenCalledWith("rdp-office");
    expect(onOpenSshTerminal).not.toHaveBeenCalled();
  });

  it("shows RDP opening feedback and disables the repeated context-menu action", () => {
    const onOpenRdpConnection = vi.fn();

    render(
      <MachineSidebar
        groups={rdpSidebarGroups}
        onOpenRdpConnection={onOpenRdpConnection}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        rdpOpeningMachineIds={["rdp-office"]}
        search=""
        selectedMachineId="rdp-office"
      />,
    );

    const hostButton = screen.getByRole("button", { name: /office-rdp/i });
    expect(hostButton).toHaveAttribute("aria-busy", "true");
    expect(hostButton).toHaveTextContent("正在打开远程桌面...");

    fireEvent.doubleClick(hostButton);
    expect(onOpenRdpConnection).not.toHaveBeenCalled();

    fireEvent.contextMenu(hostButton);
    expect(
      screen.getByRole("menuitem", { name: "正在打开 RDP..." }),
    ).toBeDisabled();
  });

  it("shows RDP opening feedback in the collapsed host list", async () => {
    const user = userEvent.setup();

    render(
      <MachineSidebar
        collapsed
        groups={rdpSidebarGroups}
        onOpenRdpConnection={vi.fn()}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        rdpOpeningMachineIds={["rdp-office"]}
        search=""
        selectedMachineId="rdp-office"
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开主机列表" }));

    const hostButton = screen.getByRole("button", { name: /office-rdp/i });
    expect(hostButton).toHaveAttribute("aria-busy", "true");
    expect(hostButton).toHaveTextContent("正在打开远程桌面...");
  });

  it("opens RDP machine actions from the right-click menu", async () => {
    const user = userEvent.setup();
    const onDeleteMachine = vi.fn();
    const onDuplicateMachine = vi.fn();
    const onEditMachine = vi.fn();
    const onOpenRdpConnection = vi.fn();

    render(
      <MachineSidebar
        groups={rdpSidebarGroups}
        onDeleteMachine={onDeleteMachine}
        onDuplicateMachine={onDuplicateMachine}
        onEditMachine={onEditMachine}
        onOpenRdpConnection={onOpenRdpConnection}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="rdp-office"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /office-rdp/i }));
    await user.click(screen.getByRole("menuitem", { name: "打开 RDP 连接" }));

    expect(onOpenRdpConnection).toHaveBeenCalledWith("rdp-office");

    fireEvent.contextMenu(screen.getByRole("button", { name: /office-rdp/i }));
    await user.click(screen.getByRole("menuitem", { name: "编辑连接配置" }));

    expect(onEditMachine).toHaveBeenCalledWith("rdp-office");

    fireEvent.contextMenu(screen.getByRole("button", { name: /office-rdp/i }));
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    expect(onDuplicateMachine).toHaveBeenCalledWith("rdp-office");

    fireEvent.contextMenu(screen.getByRole("button", { name: /office-rdp/i }));
    await user.click(screen.getByRole("menuitem", { name: "删除连接" }));

    expect(onDeleteMachine).toHaveBeenCalledWith("rdp-office");
  });

  it("opens an existing local machine when it is double-clicked", () => {
    const onOpenLocalTerminal = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onOpenLocalTerminal={onOpenLocalTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: /PowerShell/i }));

    expect(onSelectMachine).toHaveBeenCalledWith("local-powershell");
    expect(onOpenLocalTerminal).toHaveBeenCalledWith("local-powershell");
  });

  it("opens a Docker container when it is clicked", async () => {
    const user = userEvent.setup();
    const onOpenContainerTerminal = vi.fn();
    const onSelectMachine = vi.fn();

    render(
      <MachineSidebar
        groups={containerSidebarGroups}
        onOpenContainerTerminal={onOpenContainerTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={onSelectMachine}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    await user.click(screen.getByRole("button", { name: /api/i }));

    expect(onSelectMachine).toHaveBeenCalledWith(
      "docker:ubuntu-dev:c0ffee1234567890",
    );
    expect(onOpenContainerTerminal).toHaveBeenCalledWith(
      "docker:ubuntu-dev:c0ffee1234567890",
    );
  });

  it("does not offer duplicate for discovered Docker container cards", () => {
    render(
      <MachineSidebar
        groups={containerSidebarGroups}
        onDuplicateMachine={vi.fn()}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="docker:ubuntu-dev:c0ffee1234567890"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /api/i }));

    expect(
      screen.queryByRole("menuitem", { name: "复制主机" }),
    ).not.toBeInTheDocument();
  });

  it("offers Docker SFTP without the cross-host transfer tab action", () => {
    render(
      <MachineSidebar
        groups={containerSidebarGroups}
        onOpenContainerDetails={vi.fn()}
        onOpenSftp={vi.fn()}
        onOpenSftpTransferWorkbench={vi.fn()}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="docker:ubuntu-dev:c0ffee1234567890"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /api/i }));

    expect(screen.getByRole("menuitem", { name: "详情" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开 SFTP" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "容器" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "新建传输 Tab" }),
    ).not.toBeInTheDocument();
  });

  it("opens Docker container details from the right-click menu", async () => {
    const user = userEvent.setup();
    const onOpenContainerDetails = vi.fn();

    render(
      <MachineSidebar
        groups={containerSidebarGroups}
        onOpenContainerDetails={onOpenContainerDetails}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="docker:ubuntu-dev:c0ffee1234567890"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /api/i }));
    await user.click(screen.getByRole("menuitem", { name: "详情" }));

    expect(onOpenContainerDetails).toHaveBeenCalledWith(
      "docker:ubuntu-dev:c0ffee1234567890",
    );
  });

  it("opens local machine actions without creating a duplicate local session", async () => {
    const user = userEvent.setup();
    const onAddMachine = vi.fn();
    const onDeleteMachine = vi.fn();
    const onDuplicateMachine = vi.fn();
    const onEditMachine = vi.fn();
    const onOpenLocalTerminal = vi.fn();

    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onAddMachine={onAddMachine}
        onDeleteMachine={onDeleteMachine}
        onDuplicateMachine={onDuplicateMachine}
        onEditMachine={onEditMachine}
        onOpenLocalTerminal={onOpenLocalTerminal}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /PowerShell/i }));
    await user.click(screen.getByRole("menuitem", { name: "打开本地会话" }));

    expect(onOpenLocalTerminal).toHaveBeenCalledWith("local-powershell");

    fireEvent.contextMenu(screen.getByRole("button", { name: /PowerShell/i }));
    await user.click(screen.getByRole("menuitem", { name: "编辑连接配置" }));

    expect(onEditMachine).toHaveBeenCalledWith("local-powershell");

    fireEvent.contextMenu(screen.getByRole("button", { name: /PowerShell/i }));
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    expect(onDuplicateMachine).toHaveBeenCalledWith("local-powershell");

    fireEvent.contextMenu(screen.getByRole("button", { name: /PowerShell/i }));
    await user.click(screen.getByRole("menuitem", { name: "添加同组连接" }));

    expect(onAddMachine).toHaveBeenCalledWith("__ungrouped__");

    fireEvent.contextMenu(screen.getByRole("button", { name: /PowerShell/i }));
    await user.click(screen.getByRole("menuitem", { name: "删除连接" }));

    expect(onDeleteMachine).toHaveBeenCalledWith("local-powershell");
  });

  it("lights a saved host status dot when it has an open session", () => {
    render(
      <MachineSidebar
        groups={remoteSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        openMachineIds={["ubuntu-dev"]}
        search=""
        selectedMachineId="ubuntu-dev"
      />,
    );

    const hostButton = screen.getByRole("button", { name: /ubuntu-dev/i });
    expect(hostButton.querySelector(".bg-emerald-400")).not.toBeNull();
    expect(hostButton.querySelector(".bg-zinc-500")).toBeNull();
  });

  it("does not render the deprecated local terminal header button", () => {
    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId="local-powershell"
      />,
    );

    expect(
      screen.queryByRole("button", { name: "本地终端" }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when search removes every machine", () => {
    render(
      <MachineSidebar
        groups={localSidebarGroups}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search="no-such-machine"
        selectedMachineId="local-powershell"
      />,
    );

    expect(screen.getByText("没有结果")).toBeInTheDocument();
  });

  it("keeps empty remote groups visible before search is applied", () => {
    render(
      <MachineSidebar
        groups={[
          {
            id: "empty-group",
            machines: [],
            title: "云服务器",
          },
        ]}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId=""
      />,
    );

    expect(screen.getByText("云服务器")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "添加 SSH 连接" }),
    ).not.toBeInTheDocument();
  });

  it("replaces empty search chrome with a single add-connection action", async () => {
    const user = userEvent.setup();
    const onAddConnection = vi.fn();

    render(
      <MachineSidebar
        groups={[]}
        onAddConnection={onAddConnection}
        onSearchChange={vi.fn()}
        onSelectMachine={vi.fn()}
        search=""
        selectedMachineId=""
      />,
    );

    expect(screen.queryByLabelText("搜索主机")).not.toBeInTheDocument();
    expect(screen.getByText("暂无连接")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({ mode: "ssh" });
    expect(screen.getAllByRole("button", { name: "添加连接" })).toHaveLength(1);
  });
});
