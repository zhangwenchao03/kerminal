/**
 * @author kongweiguang
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  fileDialogMocks,
  localMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent local browser", () => {
  it("shows local files for local terminals and opens files in central editable tabs", async () => {
    const user = userEvent.setup();
    const onOpenWorkspaceFileTab = vi.fn();

    render(
      <SftpToolContent
        followedLocalPath="/repo"
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        selectedMachine={localMachine}
      />,
    );

    expect(await screen.findByText("本地文件")).toBeInTheDocument();
    await waitFor(() =>
      expect(fileDialogMocks.listLocalDirectory).toHaveBeenLastCalledWith(
        "/repo",
      ),
    );
    await user.dblClick(
      screen.getByRole("button", { name: "文件 package.json" }),
    );

    expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
      access: "editable",
      path: "/repo/package.json",
      source: "local",
      target: { kind: "local" },
    });
  });
});
