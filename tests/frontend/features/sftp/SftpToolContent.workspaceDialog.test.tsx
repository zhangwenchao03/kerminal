/**
 * @author kongweiguang
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { sshMachine } from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent central file workspace replacement", () => {
  it("routes old directory workspace actions to the right-panel workspace mode", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.contextMenu(screen.getByRole("button", { name: "打开目录 var" }), {
      clientX: 80,
      clientY: 160,
    });
    await user.click(screen.getByRole("menuitem", { name: "工作区打开" }));

    expect(screen.queryByRole("dialog", { name: "远程工作区" })).toBeNull();
    expect(screen.getByText("文件工作区")).toBeInTheDocument();
    expect(screen.getByText("当前根目录")).toBeInTheDocument();
    expect(screen.getByText("/var")).toBeInTheDocument();
  });

  it("opens file entries in the central editable file tab instead of the old dialog", async () => {
    const onOpenWorkspaceFileTab = vi.fn();
    const user = userEvent.setup();

    render(
      <SftpToolContent
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        selectedMachine={sshMachine}
      />,
    );

    await screen.findByText(".env");
    await user.dblClick(screen.getByRole("button", { name: "文件 .env" }));

    await waitFor(() =>
      expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
        access: "editable",
        path: "/.env",
        rootPath: "/",
        source: "sftp",
        target: { hostId: "prod-api", kind: "ssh" },
      }),
    );
    expect(screen.queryByRole("dialog", { name: "远程工作区" })).toBeNull();
  });
});
