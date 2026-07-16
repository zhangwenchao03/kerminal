import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineSidebar } from "../../../../src/features/machine-sidebar/MachineSidebar";
import { localSidebarGroups, mockElementFromPoint, remoteSidebarGroups, terminalTransportSidebarGroups } from "../../support/machine-sidebar/MachineSidebar.testSupport";

describe("MachineSidebar", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
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


});
