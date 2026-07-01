/**
 * SFTP 传输状态栏测试。
 *
 * @author kongweiguang
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../../../../src/lib/sftpApi";
import { SftpTransferStatusBar } from "../../../../../src/features/sftp/sftp-tool-content/SftpTransferStatusBar";

function transfer(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  const remotePath = overrides.remotePath ?? "/var/log/app.log";
  const localPath = overrides.localPath ?? "/Users/me/Downloads/app.log";

  return {
    bytesTransferred: 512,
    cancelRequested: false,
    createdAt: 1,
    direction: "download",
    hostId: "prod-api",
    id: "transfer-running",
    kind: "file",
    localPath,
    operation: "download",
    remotePath,
    source: {
      hostId: "prod-api",
      hostLabel: "prod-api",
      kind: "remote",
      path: remotePath,
    },
    status: "running",
    target: {
      kind: "local",
      path: localPath,
    },
    totalBytes: 1024,
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}

describe("SftpTransferStatusBar", () => {
  it("does not offer cancel again after a transfer already requested cancellation", () => {
    const onCancel = vi.fn();

    render(
      <SftpTransferStatusBar
        onCancel={onCancel}
        onClearCompleted={vi.fn()}
        transfers={[transfer({ cancelRequested: true })]}
      />,
    );

    expect(
      screen.getByRole("status", { name: "SFTP 传输状态" }),
    ).toBeInTheDocument();
    expect(screen.getByText("app.log")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消传输 app.log" }),
    ).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("offers clear when finished transfers exist alongside active transfers", async () => {
    const user = userEvent.setup();
    const onClearCompleted = vi.fn();

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={onClearCompleted}
        transfers={[
          transfer({ id: "running", status: "running" }),
          transfer({
            bytesTransferred: 1024,
            id: "succeeded",
            status: "succeeded",
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "清理完成的传输" }));

    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it("keeps long transfer history compact and expandable", async () => {
    const user = userEvent.setup();

    render(
      <SftpTransferStatusBar
        onCancel={vi.fn()}
        onClearCompleted={vi.fn()}
        transfers={Array.from({ length: 6 }, (_, index) =>
          transfer({
            id: `transfer-${index}`,
            localPath: `/Users/me/Downloads/app-${index}.log`,
            remotePath: `/var/log/app-${index}.log`,
            updatedAt: index,
          }),
        )}
      />,
    );

    const history = screen.getByLabelText("SFTP 传输历史列表");

    expect(history).toHaveClass("max-h-[15rem]", "overflow-hidden");
    expect(screen.getByText("app-0.log")).toBeInTheDocument();
    expect(screen.getByText("app-2.log")).toBeInTheDocument();
    expect(screen.queryByText("app-3.log")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "展开传输历史，查看其余 3 项",
      }),
    );

    expect(history).toHaveClass("max-h-72", "overflow-y-auto");
    expect(screen.getByText("app-5.log")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收起传输历史" }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
