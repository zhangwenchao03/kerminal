import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  sftpApiMocks,
  sshMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent browser modes", () => {
  it("switches between list, tree, and workspace modes without removing the list default", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(
      await screen.findByTestId("sftp-remote-entry-list"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sftp-browser-mode-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("远程目录")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("sftp-browser-mode-tree"));

    expect(
      screen.queryByTestId("sftp-remote-entry-list"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tree", { name: "SFTP 目录树" }),
    ).toBeInTheDocument();
    expect(screen.getByText("目录树")).toBeInTheDocument();
    expect(screen.getByTestId("sftp-browser-mode-tree")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByTestId("sftp-browser-mode-workspace"));

    expect(screen.getByText("文件工作区")).toBeInTheDocument();
    expect(screen.getByText("当前根目录")).toBeInTheDocument();
    expect(
      screen.getByText(
        "右栏只负责导航和文件操作；文件正文会打开到中间工作区 tab。",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("sftp-browser-mode-list"));

    expect(
      await screen.findByTestId("sftp-remote-entry-list"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sftp-browser-mode-list")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("远程目录")).not.toBeInTheDocument();
  });

  it("preserves expanded tree directories when switching browser modes", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByTestId("sftp-remote-entry-list");
    await user.click(screen.getByTestId("sftp-browser-mode-tree"));

    const varNode = await screen.findByRole("treeitem", { name: "var" });
    await user.click(varNode);
    await waitFor(() =>
      expect(varNode).toHaveAttribute("aria-expanded", "true"),
    );
    expect(await screen.findByRole("treeitem", { name: "log" })).toBeInTheDocument();

    await user.click(screen.getByTestId("sftp-browser-mode-list"));
    await screen.findByTestId("sftp-remote-entry-list");
    await user.click(screen.getByTestId("sftp-browser-mode-tree"));

    expect(
      await screen.findByRole("treeitem", { name: "var" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "log" })).toBeInTheDocument();
  });

  it("applies the hidden-file toggle to tree nodes without reloading the tree", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByTestId("sftp-remote-entry-list");
    await user.click(screen.getByTestId("sftp-browser-mode-tree"));

    expect(
      await screen.findByRole("treeitem", { name: ".env" }),
    ).toBeInTheDocument();
    const listCallCount = sftpApiMocks.listSftpDirectory.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "隐藏隐藏文件" }));

    expect(
      screen.queryByRole("treeitem", { name: ".env" }),
    ).not.toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledTimes(listCallCount);

    await user.click(screen.getByRole("button", { name: "显示隐藏文件" }));

    expect(
      screen.getByRole("treeitem", { name: ".env" }),
    ).toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledTimes(listCallCount);
  });

  it("uploads files into the directory selected from the tree context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByTestId("sftp-remote-entry-list");
    await user.click(screen.getByTestId("sftp-browser-mode-tree"));

    const varNode = await screen.findByRole("treeitem", { name: "var" });
    fireEvent.contextMenu(varNode, { clientX: 32, clientY: 48 });
    await user.click(
      screen.getByRole("menuitem", { name: "上传文件到此目录" }),
    );

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
        conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/release.tgz",
        remotePath: "/var/release.tgz",
      }),
    );
  });

  it("loads and selects the requested file when a workspace tab asks to reveal in SFTP", async () => {
    render(
      <SftpToolContent
        selectedMachine={sshMachine}
        sftpRevealRequest={{
          directoryPath: "/var/log",
          filePath: "/var/log/app.log",
          id: 1,
          target: { hostId: "prod-api", kind: "ssh" },
        }}
      />,
    );

    expect(await screen.findByText("app.log")).toBeInTheDocument();
    await waitFor(() =>
      expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({
        hostId: "prod-api",
        path: "/var/log",
      }),
    );
    expect(
      screen
        .getByRole("button", { name: "文件 app.log" })
        .closest("[aria-selected='true']"),
    ).toBeInTheDocument();
  });
});
