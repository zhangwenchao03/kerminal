import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SftpTransferWorkbench } from "./SftpTransferWorkbench";
import type { MachineGroup } from "../workspace/types";
import type { SftpClipboard } from "./SftpToolContent";
import type { SftpTransferTarget } from "./sftp-tool-content/types";
import type { SftpTransferSummary } from "../../lib/sftpApi";

const sftpApiMock = vi.hoisted(() => ({
  cancelSftpTransfer: vi.fn(),
  clearCompletedSftpTransfers: vi.fn(),
  listSftpTransfers: vi.fn(),
}));

const fileDialogApiMock = vi.hoisted(() => ({
  listLocalDirectory: vi.fn(),
  openLocalDirectory: vi.fn(),
  selectLocalDirectory: vi.fn(),
}));

vi.mock("../../lib/sftpApi", () => ({
  cancelSftpTransfer: sftpApiMock.cancelSftpTransfer,
  clearCompletedSftpTransfers: sftpApiMock.clearCompletedSftpTransfers,
  listSftpTransfers: sftpApiMock.listSftpTransfers,
}));

vi.mock("../../lib/fileDialogApi", () => ({
  listLocalDirectory: fileDialogApiMock.listLocalDirectory,
  openLocalDirectory: fileDialogApiMock.openLocalDirectory,
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
}));

vi.mock("./SftpToolContent", () => ({
  SftpToolContent: ({
    active,
    compactHeader,
    onCurrentPathChange,
    onSftpClipboardChange,
    selectedMachine,
    showLocalTransferActions,
    showTransferStatusBar,
    sftpClipboard,
    transferTarget,
    transferViewScope,
  }: {
    active: boolean;
    compactHeader?: boolean;
    onCurrentPathChange?: (path: string) => void;
    onSftpClipboardChange: (clipboard: SftpClipboard | null) => void;
    selectedMachine: { id: string; name: string };
    showLocalTransferActions?: boolean;
    showTransferStatusBar?: boolean;
    sftpClipboard: SftpClipboard | null;
    transferTarget?: SftpTransferTarget;
    transferViewScope?: string | null;
  }) => {
    const transferTargetLabel =
      transferTarget?.kind === "local"
        ? `${transferTarget.side}:${transferTarget.localPath}`
        : transferTarget?.kind === "remote"
          ? `${transferTarget.side}:${transferTarget.hostLabel}:${transferTarget.remotePath}`
          : "none";

    return (
      <div aria-label={`SFTP 面板 ${selectedMachine.name}`}>
        <span>active:{String(active)}</span>
        <span>compact:{String(compactHeader)}</span>
        <span>local-actions:{String(showLocalTransferActions)}</span>
        <span>transfer-status:{String(showTransferStatusBar)}</span>
        <span>transfer-scope:{transferViewScope ?? "none"}</span>
        <span>transfer-target:{transferTargetLabel}</span>
        <span>clipboard:{sftpClipboard?.sourceHostId ?? "empty"}</span>
        <button
          onClick={() =>
            onSftpClipboardChange({
              copiedAt: 1,
              entries: [{ kind: "file", name: "app.log", path: "/tmp/app.log" }],
              sourceHostId: selectedMachine.id,
              sourceHostLabel: selectedMachine.name,
            })
          }
          type="button"
        >
          复制 {selectedMachine.name}
        </button>
        <button
          onClick={() => onCurrentPathChange?.(`/srv/${selectedMachine.name}`)}
          type="button"
        >
          报告路径 {selectedMachine.name}
        </button>
      </div>
    );
  },
}));

const groups: MachineGroup[] = [
  {
    id: "group-main",
    machines: [
      {
        description: "root@left.internal:22",
        id: "host-left",
        kind: "ssh",
        name: "left",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "root@right.internal:22",
        id: "host-right",
        kind: "ssh",
        name: "right",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "root@backup.internal:22",
        id: "host-backup",
        kind: "ssh",
        name: "backup",
        status: "offline",
        tags: ["ssh"],
      },
    ],
    title: "主机",
  },
];

const groupsWithoutRightHost: MachineGroup[] = [
  {
    id: "group-main",
    machines: [
      {
        description: "root@left.internal:22",
        id: "host-left",
        kind: "ssh",
        name: "left",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "local profile using a stale host id",
        id: "host-right",
        kind: "local",
        name: "stale local right",
        status: "offline",
        tags: ["local"],
      },
      {
        description: "root@backup.internal:22",
        id: "host-backup",
        kind: "ssh",
        name: "backup",
        status: "offline",
        tags: ["ssh"],
      },
    ],
    title: "主机",
  },
];

const groupsWithoutSshHosts: MachineGroup[] = [
  {
    id: "group-local",
    machines: [
      {
        description: "local profile using a stale host id",
        id: "host-right",
        kind: "local",
        name: "stale local right",
        status: "offline",
        tags: ["local"],
      },
    ],
    title: "本地",
  },
];

const groupsWithCreatedHost: MachineGroup[] = [
  {
    ...groups[0],
    machines: [
      ...groups[0].machines,
      {
        description: "deploy@created.internal:22",
        id: "host-created",
        kind: "ssh",
        name: "created",
        status: "offline",
        tags: ["ssh"],
      },
    ],
  },
];

const runningTransfer: SftpTransferSummary = {
  bytesTransferred: 512,
  cancelRequested: false,
  createdAt: 20,
  direction: "upload",
  hostId: "host-right",
  id: "transfer-running",
  kind: "file",
  localPath: "sftp://host-left/tmp/app.log",
  operation: "remoteCopy",
  remotePath: "/var/log/app.log",
  source: {
    hostId: "host-left",
    hostLabel: "left",
    kind: "remote",
    path: "/tmp/app.log",
  },
  status: "running",
  target: {
    hostId: "host-right",
    hostLabel: "right",
    kind: "remote",
    path: "/var/log/app.log",
  },
  totalBytes: 1024,
  transportMode: "clientBridge",
  updatedAt: 21,
};

const succeededTransfer: SftpTransferSummary = {
  ...runningTransfer,
  bytesTransferred: 1024,
  id: "transfer-succeeded",
  localPath: "sftp://host-left/tmp/done.log",
  remotePath: "/var/log/done.log",
  source: {
    hostId: "host-left",
    hostLabel: "left",
    kind: "remote",
    path: "/tmp/done.log",
  },
  status: "succeeded",
  target: {
    hostId: "host-right",
    hostLabel: "right",
    kind: "remote",
    path: "/var/log/done.log",
  },
  updatedAt: 22,
};

const localListing = {
  entries: [
    {
      kind: "directory" as const,
      modified: "1771351200",
      name: ".codex",
      path: "C:\\Users\\24052\\.codex",
      raw: "directory C:\\Users\\24052\\.codex",
    },
    {
      kind: "file" as const,
      modified: "1771351200",
      name: "notes.md",
      path: "C:\\Users\\24052\\notes.md",
      raw: "file C:\\Users\\24052\\notes.md",
      size: 2048,
    },
  ],
  parentPath: "C:\\Users",
  path: "C:\\Users\\24052",
};

describe("SftpTransferWorkbench", () => {
  beforeEach(() => {
    sftpApiMock.cancelSftpTransfer.mockReset();
    sftpApiMock.clearCompletedSftpTransfers.mockReset();
    sftpApiMock.listSftpTransfers.mockReset();
    fileDialogApiMock.listLocalDirectory.mockReset();
    fileDialogApiMock.openLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalDirectory.mockReset();
    sftpApiMock.listSftpTransfers.mockResolvedValue([]);
    fileDialogApiMock.listLocalDirectory.mockResolvedValue(localListing);
    sftpApiMock.cancelSftpTransfer.mockResolvedValue({
      ...runningTransfer,
      cancelRequested: true,
      status: "canceled",
    });
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([]);
  });

  it("starts with a local left pane and no selected remote server", () => {
    render(<SftpTransferWorkbench groups={groups} />);

    expect(screen.getByLabelText("本地目录面板")).toBeInTheDocument();
    expect(screen.getByText("右侧未选择服务器")).toBeInTheDocument();
    expect(screen.getByText("选择右侧服务器。")).toBeInTheDocument();
    expect(screen.queryByLabelText(/SFTP 面板/)).not.toBeInTheDocument();
  });

  it("loads the local directory into the left pane", async () => {
    render(<SftpTransferWorkbench groups={groups} />);

    expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(null);
    expect(await screen.findByText(".codex")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByDisplayValue("C:\\Users\\24052")).toBeInTheDocument();
    expect(screen.getByText("2 项 / 1 目录 / 1 文件")).toBeInTheDocument();
  });

  it("opens an initial right server and lets the right side add SSH hosts", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(screen.getByLabelText("SFTP 面板 right")).toBeInTheDocument();
    expect(screen.getByText("目标：right:/")).toBeInTheDocument();
    expect(screen.getByText("compact:true")).toBeInTheDocument();
    expect(screen.getByText("transfer-status:false")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("local-actions:false")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("transfer-target:left:C:\\Users\\24052"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "backup" }));

    expect(screen.getByLabelText("SFTP 面板 backup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "right" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "backup" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "right" }));

    expect(screen.getAllByRole("button", { name: "right" })).toHaveLength(2);
  });

  it("scopes transfer history to its workspace tab", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(
      await screen.findByText("transfer-scope:sftp-workbench:tab-transfer"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));

    expect(
      screen.getAllByText("transfer-scope:sftp-workbench:tab-transfer").length,
    ).toBeGreaterThanOrEqual(2);
    await waitFor(() =>
      expect(sftpApiMock.listSftpTransfers).toHaveBeenCalledWith({
        viewScope: "sftp-workbench:tab-transfer",
      }),
    );
  });

  it("requests a new SSH host from the selected workbench side", async () => {
    const user = userEvent.setup();
    const onCreateSshHost = vi.fn();
    render(
      <SftpTransferWorkbench
        groups={groups}
        onCreateSshHost={onCreateSshHost}
        workspaceTabId="tab-transfer"
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: /新建 SSH 主机/ }));
    expect(onCreateSshHost).toHaveBeenCalledWith({
      side: "left",
      workspaceTabId: "tab-transfer",
    });

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: /新建 SSH 主机/ }));
    expect(onCreateSshHost).toHaveBeenLastCalledWith({
      side: "right",
      workspaceTabId: "tab-transfer",
    });
  });

  it("opens a created SSH host on the matching workbench side after groups refresh", async () => {
    const { rerender } = render(
      <SftpTransferWorkbench
        createdHostTarget={{
          hostId: "host-created",
          sequence: 1,
          side: "right",
          workspaceTabId: "tab-transfer",
        }}
        groups={groups}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(screen.queryByLabelText("SFTP 面板 created")).not.toBeInTheDocument();

    rerender(
      <SftpTransferWorkbench
        createdHostTarget={{
          hostId: "host-created",
          sequence: 1,
          side: "right",
          workspaceTabId: "tab-transfer",
        }}
        groups={groupsWithCreatedHost}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(await screen.findByLabelText("SFTP 面板 created")).toBeInTheDocument();
    expect(screen.getByText("目标：created:/")).toBeInTheDocument();
  });

  it("ignores created SSH host signals for another transfer workbench", () => {
    render(
      <SftpTransferWorkbench
        createdHostTarget={{
          hostId: "host-created",
          sequence: 2,
          side: "left",
          workspaceTabId: "tab-other",
        }}
        groups={groupsWithCreatedHost}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(screen.queryByLabelText("SFTP 面板 created")).not.toBeInTheDocument();
  });

  it("lets the left side add SSH hosts and exposes the active left remote target", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));

    expect(screen.getByLabelText("SFTP 面板 left")).toBeInTheDocument();
    expect(screen.getByText("transfer-target:right:right:/")).toBeInTheDocument();
    expect(screen.getByText("transfer-target:left:left:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "报告路径 left" }));

    expect(
      screen.getByText("transfer-target:left:left:/srv/left"),
    ).toBeInTheDocument();
  });

  it("restores the right transfer target when the left pane switches back to local", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));
    expect(screen.getByText("transfer-target:left:left:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "本机" }));

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("SFTP 面板 left")).not.toBeInTheDocument();
  });

  it("falls back to the local left pane after closing the active left SSH tab", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));
    expect(screen.getByText("transfer-target:left:left:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭 left" }));

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("SFTP 面板 left")).not.toBeInTheDocument();
  });

  it("updates the right transfer target when the left local directory changes", async () => {
    const user = userEvent.setup();
    const deployListing = {
      ...localListing,
      parentPath: "D:\\",
      path: "D:\\deploy",
    };
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue("D:\\deploy");
    fileDialogApiMock.listLocalDirectory.mockImplementation(async (path) =>
      path === "D:\\deploy" ? deployListing : localListing,
    );

    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "选择本地目录" }));

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:D:\\deploy"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("D:\\deploy")).toBeInTheDocument();
  });

  it("keeps a locked source host tab while activating the initial right host", () => {
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
        lockedLeftHostId="host-left"
      />,
    );

    expect(screen.getByLabelText("SFTP 面板 right")).toBeInTheDocument();
    expect(screen.getByText("目标：right:/")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /left.*固定/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reconciles removed and non-SSH host tabs to the remaining SSH tab", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "backup" }));
    await user.click(screen.getByRole("button", { name: "right" }));

    rerender(
      <SftpTransferWorkbench
        groups={groupsWithoutRightHost}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("SFTP 面板 backup")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("SFTP 面板 right")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stale local right" })).not.toBeInTheDocument();
    expect(screen.getByText("目标：backup:/")).toBeInTheDocument();
  });

  it("keeps reported remote paths scoped to the active host tab", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await user.click(screen.getByRole("button", { name: "报告路径 right" }));
    expect(screen.getByText("目标：right:/srv/right")).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "backup" }));
    expect(screen.getByText("目标：backup:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "报告路径 backup" }));
    expect(screen.getByText("目标：backup:/srv/backup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "right" }));
    expect(screen.getByText("目标：right:/srv/right")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "backup" }));
    expect(screen.getByText("目标：backup:/srv/backup")).toBeInTheDocument();
  });

  it("does not activate a stale or non-SSH host when no SSH hosts are available", async () => {
    const { rerender } = render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    rerender(
      <SftpTransferWorkbench
        groups={groupsWithoutSshHosts}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(screen.queryByLabelText(/SFTP 面板/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("没有可用于 SFTP 的 SSH 服务器。")).toBeInTheDocument();
    expect(screen.getByText("右侧未选择服务器")).toBeInTheDocument();
  });

  it("shows queue progress and delegates cancel and clear actions", async () => {
    const user = userEvent.setup();
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      runningTransfer,
      succeededTransfer,
    ]);
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([runningTransfer]);

    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getAllByText("本机桥接")).toHaveLength(2);
    expect(
      screen.getByText("left:/tmp/app.log -> right:/var/log/app.log"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消传输" }));
    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: "transfer-running",
        viewScope: expect.stringMatching(/^sftp-workbench:/),
      }),
    );

    await user.click(screen.getByRole("button", { name: "清理" }));
    await waitFor(() =>
      expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalledWith({
        viewScope: expect.stringMatching(/^sftp-workbench:/),
      }),
    );
  });

  it("keeps long transfer history collapsed and scrollable when expanded", async () => {
    const user = userEvent.setup();
    sftpApiMock.listSftpTransfers.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        ...runningTransfer,
        bytesTransferred: index,
        createdAt: index,
        id: `transfer-${index}`,
        localPath: `sftp://host-left/tmp/log-${index}.txt`,
        remotePath: `/var/log/log-${index}.txt`,
        source: {
          hostId: "host-left",
          hostLabel: "left",
          kind: "remote" as const,
          path: `/tmp/log-${index}.txt`,
        },
        target: {
          hostId: "host-right",
          hostLabel: "right",
          kind: "remote" as const,
          path: `/var/log/log-${index}.txt`,
        },
        totalBytes: 100,
        updatedAt: index,
      })),
    );

    render(
      <SftpTransferWorkbench groups={groups} initialRightHostId="host-right" />,
    );

    const history = await screen.findByLabelText("SFTP 后台传输历史");

    expect(history).toHaveClass("max-h-44", "overflow-hidden");
    expect(screen.getByText("log-9.txt")).toBeInTheDocument();
    expect(screen.getByText("log-8.txt")).toBeInTheDocument();
    expect(screen.getByText("log-7.txt")).toBeInTheDocument();
    expect(screen.queryByText("log-0.txt")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "展开传输历史，查看其余 7 项" }),
    );

    expect(history).toHaveClass("max-h-72", "overflow-y-auto");
    expect(screen.getByText("log-0.txt")).toBeInTheDocument();
  });

  it("does not offer cancel again after a transfer already requested cancellation", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      {
        ...runningTransfer,
        cancelRequested: true,
      },
    ]);

    render(
      <SftpTransferWorkbench groups={groups} initialRightHostId="host-right" />,
    );

    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByText("传输中")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消传输" }),
    ).not.toBeInTheDocument();
    expect(sftpApiMock.cancelSftpTransfer).not.toHaveBeenCalled();
  });

  it("does not poll the transfer queue while inactive", () => {
    render(
      <SftpTransferWorkbench
        active={false}
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(sftpApiMock.listSftpTransfers).not.toHaveBeenCalled();
    expect(fileDialogApiMock.listLocalDirectory).not.toHaveBeenCalled();
  });
});
