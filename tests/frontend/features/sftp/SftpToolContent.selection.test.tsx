/**
 * @author kongweiguang
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sftpApiMocks, sshMachine } from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent selection behavior", () => {
  it("preserves multi-selection when right-clicking a selected entry", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    const varButton = await screen.findByRole("button", {
      name: "打开目录 var",
    });
    const logButton = screen.getByRole("button", { name: "打开目录 log" });

    fireEvent.click(varButton, { ctrlKey: true });
    fireEvent.click(logButton, { ctrlKey: true });

    expect(screen.getByText("3 / 3 项 / 已选 2")).toBeInTheDocument();

    fireEvent.contextMenu(varButton, { clientX: 80, clientY: 120 });

    expect(
      screen.getByRole("menu", { name: "SFTP 已选 2 项右键菜单" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "下载选中 2 项" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "删除选中 2 项" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 / 3 项 / 已选 2")).toBeInTheDocument();
    expect(varButton.closest("[aria-selected='true']")).toBeInTheDocument();
    expect(logButton.closest("[aria-selected='true']")).toBeInTheDocument();
  });

  it("switches selection when right-clicking an unselected entry", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    const varButton = await screen.findByRole("button", {
      name: "打开目录 var",
    });
    const logButton = screen.getByRole("button", { name: "打开目录 log" });
    const envButton = screen.getByRole("button", { name: "文件 .env" });

    fireEvent.click(varButton, { ctrlKey: true });
    fireEvent.click(logButton, { ctrlKey: true });

    fireEvent.contextMenu(envButton, { clientX: 80, clientY: 160 });

    expect(
      screen.getByRole("menu", { name: "SFTP .env 右键菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 / 3 项 / 已选 1")).toBeInTheDocument();
    expect(varButton.closest("[aria-selected='true']")).not.toBeInTheDocument();
    expect(logButton.closest("[aria-selected='true']")).not.toBeInTheDocument();
    expect(envButton.closest("[aria-selected='true']")).toBeInTheDocument();
  });

  it("keeps selection when opening the current-directory context menu", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    const varButton = await screen.findByRole("button", {
      name: "打开目录 var",
    });
    const logButton = screen.getByRole("button", { name: "打开目录 log" });

    fireEvent.click(varButton, { ctrlKey: true });
    fireEvent.click(logButton, { ctrlKey: true });
    fireEvent.contextMenu(screen.getByTestId("sftp-drop-zone"), {
      clientX: 24,
      clientY: 24,
    });

    expect(
      screen.getByRole("menu", { name: "SFTP 目录右键菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 / 3 项 / 已选 2")).toBeInTheDocument();
    expect(varButton.closest("[aria-selected='true']")).toBeInTheDocument();
    expect(logButton.closest("[aria-selected='true']")).toBeInTheDocument();
  });

  it("virtualizes large remote directories while keeping range selection on all entries", async () => {
    sftpApiMocks.listSftpDirectory.mockResolvedValueOnce({
      entries: buildRemoteEntries(500),
      hostId: "prod-api",
      path: "/",
    });
    const { container } = render(<SftpToolContent selectedMachine={sshMachine} />);

    const firstFile = await screen.findByRole("button", { name: "文件 file-0000" });
    const remoteList = screen.getByTestId("sftp-remote-entry-list");

    expect(remoteList).toHaveAttribute("data-virtualized", "true");
    expect(remoteList).toHaveAttribute("data-row-height", "44");
    expect(container.querySelectorAll("[data-sftp-entry-row]").length).toBeLessThan(80);

    fireEvent.click(firstFile);
    remoteList.scrollTop = 44 * 250;
    fireEvent.scroll(remoteList);

    const middleFile = await screen.findByRole("button", { name: "文件 file-0250" });
    fireEvent.click(middleFile, { shiftKey: true });

    expect(screen.getByText("500 / 500 项 / 已选 251")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-sftp-entry-row]").length).toBeLessThan(80);
  });

  it("uses tighter row rhythm in compact density", async () => {
    sftpApiMocks.listSftpDirectory.mockResolvedValueOnce({
      entries: buildRemoteEntries(120),
      hostId: "prod-api",
      path: "/",
    });
    render(<SftpToolContent interfaceDensity="compact" selectedMachine={sshMachine} />);

    await screen.findByRole("button", { name: "文件 file-0000" });

    expect(screen.getByTestId("sftp-remote-entry-list")).toHaveAttribute(
      "data-row-height",
      "36",
    );
  });
});

function buildRemoteEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    kind: "file",
    modified: "Jun 23 12:00",
    name: `file-${index.toString().padStart(4, "0")}`,
    path: `/srv/data/file-${index.toString().padStart(4, "0")}`,
    permissions: "-rw-r--r--",
    raw: `-rw-r--r-- file-${index.toString().padStart(4, "0")}`,
    size: 1024 + index,
  }));
}
