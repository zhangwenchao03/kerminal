/**
 * @author kongweiguang
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  sshMachine,
  stageSshMachine,
} from "./SftpToolContent.testSupport";
import { SftpToolContent } from "./SftpToolContent";

describe("SftpToolContent workspace dialog boundaries", () => {
  it("blocks closing a dirty remote workspace until the user confirms", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    try {
      render(<SftpToolContent selectedMachine={sshMachine} />);

      await openWorkspaceDirectory(user);
      await user.click(screen.getByRole("button", { name: "标记工作区未保存" }));
      expect(screen.getByText("有未保存修改。")).toBeInTheDocument();

      confirmSpy.mockReturnValueOnce(false);
      await user.click(screen.getByRole("button", { name: "关闭弹窗" }));
      expect(confirmSpy).toHaveBeenCalledWith(
        "工作区有未保存修改，关闭会丢失这些修改。仍然关闭？",
      );
      expect(
        screen.getByRole("dialog", { name: "远程工作区" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("工作区有未保存修改，确认后可以关闭。"),
      ).toBeInTheDocument();

      confirmSpy.mockReturnValueOnce(true);
      await user.click(screen.getByRole("button", { name: "关闭弹窗" }));
      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", { name: "远程工作区" }),
        ).not.toBeInTheDocument();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("expands and restores a dirty workspace without reopening it", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("window.open should not be called");
    });

    try {
      render(<SftpToolContent selectedMachine={sshMachine} />);

      await openWorkspaceDirectory(user);
      await user.click(screen.getByRole("button", { name: "标记工作区未保存" }));
      await user.click(screen.getByRole("button", { name: "放大工作区" }));

      expect(openSpy).not.toHaveBeenCalled();
      expect(
        screen.getByRole("dialog", { name: "远程工作区" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "还原工作区" })).toBeInTheDocument();
      expect(
        screen.getByText("有未保存修改。"),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "还原工作区" }));
      expect(screen.getByRole("button", { name: "放大工作区" })).toBeInTheDocument();
      expect(
        screen.getByRole("dialog", { name: "远程工作区" }),
      ).toBeInTheDocument();
    } finally {
      openSpy.mockRestore();
    }
  });

  it("clears the workspace dialog when the selected target changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SftpToolContent selectedMachine={sshMachine} />);

    await openWorkspaceDirectory(user);

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "远程工作区" }),
      ).not.toBeInTheDocument();
    });
  });
});

async function openWorkspaceDirectory(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("var");
  fireEvent.contextMenu(screen.getByRole("button", { name: "打开目录 var" }), {
    clientX: 80,
    clientY: 160,
  });
  await user.click(screen.getByRole("menuitem", { name: "工作区打开" }));
  expect(
    await screen.findByRole("dialog", { name: "远程工作区" }),
  ).toBeInTheDocument();
  expect(await screen.findByTestId("remote-workspace-editor")).toBeInTheDocument();
}
