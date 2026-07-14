import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sftpApiMocks,
  sshMachine,
} from "../../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../../src/features/sftp/SftpToolContent";


describe("SftpToolContent workspace behavior", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("opens a remote file in the central workspace tab by double clicking a file", async () => {
    const user = userEvent.setup();
    const onOpenWorkspaceFileTab = vi.fn();

    render(
      <SftpToolContent
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        selectedMachine={sshMachine}
      />,
    );

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();

    await user.dblClick(screen.getByRole("button", { name: "文件 app.log" }));

    await waitFor(() =>
      expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
        access: "editable",
        path: "/var/log/app.log",
        rootPath: "/var/log",
        source: "sftp",
        target: { hostId: "prod-api", kind: "ssh" },
      }),
    );
    expect(sftpApiMocks.previewSftpFile).not.toHaveBeenCalled();
  });


  it("navigates into a directory without opening the workspace dialog on double click", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));

    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "远程工作区" }),
    ).not.toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({
      hostId: "prod-api",
      path: "/var/log",
    });
  });


  it("opens the selected directory in workspace mode from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.contextMenu(screen.getByRole("button", { name: "打开目录 var" }), {
      clientX: 80,
      clientY: 160,
    });
    await user.click(screen.getByRole("menuitem", { name: "工作区打开" }));

    expect(await screen.findByText("文件工作区")).toBeInTheDocument();
    expect(screen.getByText("当前根目录")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/var")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "远程工作区" }),
    ).not.toBeInTheDocument();
  });


  it("keeps workspace mode in the current app without opening a new window", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("window.open should not be called");
    });

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.contextMenu(screen.getByRole("button", { name: "打开目录 var" }), {
      clientX: 80,
      clientY: 160,
    });
    await user.click(screen.getByRole("menuitem", { name: "工作区打开" }));

    expect(await screen.findByText("文件工作区")).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "远程工作区" }),
    ).not.toBeInTheDocument();

    openSpy.mockRestore();
  });
});
