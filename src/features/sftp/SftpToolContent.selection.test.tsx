/**
 * @author kongweiguang
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sshMachine } from "./SftpToolContent.testSupport";
import { SftpToolContent } from "./SftpToolContent";

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
      screen.getByRole("menu", { name: "SFTP var 右键菜单" }),
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
});
