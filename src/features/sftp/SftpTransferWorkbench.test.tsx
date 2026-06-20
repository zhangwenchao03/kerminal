import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SftpTransferWorkbench } from "./SftpTransferWorkbench";
import type { MachineGroup } from "../workspace/types";
import type { SftpClipboard } from "./SftpToolContent";
import type { SftpTransferSummary } from "../../lib/sftpApi";

const sftpApiMock = vi.hoisted(() => ({
  cancelSftpTransfer: vi.fn(),
  clearCompletedSftpTransfers: vi.fn(),
  listSftpTransfers: vi.fn(),
}));

vi.mock("../../lib/sftpApi", () => ({
  cancelSftpTransfer: sftpApiMock.cancelSftpTransfer,
  clearCompletedSftpTransfers: sftpApiMock.clearCompletedSftpTransfers,
  listSftpTransfers: sftpApiMock.listSftpTransfers,
}));

vi.mock("./SftpToolContent", () => ({
  SftpToolContent: ({
    active,
    compactHeader,
    onSftpClipboardChange,
    selectedMachine,
    showLocalTransferActions,
    showTransferStatusBar,
    sftpClipboard,
  }: {
    active: boolean;
    compactHeader?: boolean;
    onSftpClipboardChange: (clipboard: SftpClipboard | null) => void;
    selectedMachine: { id: string; name: string };
    showLocalTransferActions?: boolean;
    showTransferStatusBar?: boolean;
    sftpClipboard: SftpClipboard | null;
  }) => (
    <div aria-label={`SFTP 面板 ${selectedMachine.name}`}>
      <span>active:{String(active)}</span>
      <span>compact:{String(compactHeader)}</span>
      <span>local-actions:{String(showLocalTransferActions)}</span>
      <span>transfer-status:{String(showTransferStatusBar)}</span>
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
    </div>
  ),
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

describe("SftpTransferWorkbench", () => {
  beforeEach(() => {
    sftpApiMock.cancelSftpTransfer.mockReset();
    sftpApiMock.clearCompletedSftpTransfers.mockReset();
    sftpApiMock.listSftpTransfers.mockReset();
    sftpApiMock.listSftpTransfers.mockResolvedValue([]);
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
    expect(screen.getByText("local-actions:true")).toBeInTheDocument();
    expect(screen.getByText("transfer-status:false")).toBeInTheDocument();

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

  it("treats legacy left host options as the initial right server", () => {
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialLeftHostId="host-left"
        lockedLeftHostId="host-left"
      />,
    );

    expect(screen.getByLabelText("SFTP 面板 left")).toBeInTheDocument();
    expect(screen.getByText("目标：left:/")).toBeInTheDocument();
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
    expect(
      screen.getByText("left:/tmp/app.log -> right:/var/log/app.log"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消传输" }));
    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith({
      transferId: "transfer-running",
    });

    await user.click(screen.getByRole("button", { name: "清理" }));
    await waitFor(() =>
      expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalled(),
    );
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
  });
});
