import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDirectoryListing } from "../../../../src/lib/fileDialogApi";
import type { Machine } from "../../../../src/features/workspace/types";
import { LocalTransferPane } from "../../../../src/features/sftp/LocalTransferPane";
import { SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME } from "../../../../src/features/sftp/sftp-tool-content/sftpLocalUploadDropModel";
import { SFTP_REMOTE_DRAG_PAYLOAD_MIME } from "../../../../src/features/sftp/sftp-tool-content/sftpRemoteTransferModel";

const fileDialogApiMock = vi.hoisted(() => ({
  listLocalDirectory: vi.fn(),
  openLocalDirectory: vi.fn(),
  selectLocalDirectory: vi.fn(),
}));

const sftpApiMock = vi.hoisted(() => ({
  enqueueSftpTransfer: vi.fn(),
}));

const localFilesApiMock = vi.hoisted(() => ({
  createLocalDirectory: vi.fn(),
  copyLocalPath: vi.fn(),
  deleteLocalPath: vi.fn(),
  renameLocalPath: vi.fn(),
}));

const desktopClipboardApiMock = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  listLocalDirectory: fileDialogApiMock.listLocalDirectory,
  openLocalDirectory: fileDialogApiMock.openLocalDirectory,
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
}));

vi.mock("../../../../src/lib/sftpApi", () => ({
  enqueueSftpTransfer: sftpApiMock.enqueueSftpTransfer,
}));

vi.mock("../../../../src/lib/localFilesApi", () => ({
  createLocalDirectory: localFilesApiMock.createLocalDirectory,
  copyLocalPath: localFilesApiMock.copyLocalPath,
  deleteLocalPath: localFilesApiMock.deleteLocalPath,
  renameLocalPath: localFilesApiMock.renameLocalPath,
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMock.writeDesktopClipboardText(...args),
}));

const targetMachine: Machine = {
  description: "root@example.internal:22",
  id: "host-right",
  kind: "ssh",
  name: "right",
  status: "offline",
  tags: ["ssh"],
};

const initialListing: LocalDirectoryListing = {
  entries: [
    {
      kind: "directory",
      name: "logs",
      path: "C:\\Users\\24052\\logs",
      raw: "directory C:\\Users\\24052\\logs",
    },
    {
      kind: "file",
      name: "notes.md",
      path: "C:\\Users\\24052\\notes.md",
      raw: "file C:\\Users\\24052\\notes.md",
      size: 2048,
    },
  ],
  parentPath: "C:\\Users",
  path: "C:\\Users\\24052",
};

const copiedListing: LocalDirectoryListing = {
  entries: [
    ...initialListing.entries,
    {
      kind: "file",
      name: "notes copy.md",
      path: "C:\\Users\\24052\\notes copy.md",
      raw: "file C:\\Users\\24052\\notes copy.md",
      size: 2048,
    },
  ],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};

const createdDirectoryListing: LocalDirectoryListing = {
  entries: [
    initialListing.entries[0],
    {
      kind: "directory",
      name: "new-dir",
      path: "C:\\\\Users\\\\24052\\\\new-dir",
      raw: "directory C:\\\\Users\\\\24052\\\\new-dir",
    },
    initialListing.entries[1],
  ],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};

const renamedFileListing: LocalDirectoryListing = {
  entries: [
    initialListing.entries[0],
    {
      kind: "file",
      name: "renamed.md",
      path: "C:\\\\Users\\\\24052\\\\renamed.md",
      raw: "file C:\\\\Users\\\\24052\\\\renamed.md",
      size: 2048,
    },
  ],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};const deletedFileListing: LocalDirectoryListing = {
  entries: [initialListing.entries[0]],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};describe("LocalTransferPane", () => {
  beforeEach(() => {
    fileDialogApiMock.listLocalDirectory.mockReset();
    fileDialogApiMock.openLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalDirectory.mockReset();
    sftpApiMock.enqueueSftpTransfer.mockReset();
    localFilesApiMock.createLocalDirectory.mockReset();
    localFilesApiMock.copyLocalPath.mockReset();
    localFilesApiMock.deleteLocalPath.mockReset();
    localFilesApiMock.renameLocalPath.mockReset();
    desktopClipboardApiMock.writeDesktopClipboardText.mockReset();
    fileDialogApiMock.listLocalDirectory.mockResolvedValue(initialListing);
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue(null);
    localFilesApiMock.createLocalDirectory.mockResolvedValue(
      createdDirectoryListing,
    );
    localFilesApiMock.copyLocalPath.mockResolvedValue(copiedListing);
    localFilesApiMock.deleteLocalPath.mockResolvedValue(deletedFileListing);
    localFilesApiMock.renameLocalPath.mockResolvedValue(renamedFileListing);
    sftpApiMock.enqueueSftpTransfer.mockResolvedValue({
      bytesTransferred: 0,
      cancelRequested: false,
      createdAt: 1,
      direction: "upload",
      hostId: "host-right",
      id: "transfer-local-upload",
      kind: "file",
      localPath: "C:\\\\Users\\\\24052\\\\notes.md",
      remotePath: "/srv/app/notes.md",
      status: "queued",
      updatedAt: 1,
    });
    desktopClipboardApiMock.writeDesktopClipboardText.mockResolvedValue({
      ok: true,
    });
  });

  it("offers a local file context menu that uploads to the selected remote pane", async () => {
    const user = userEvent.setup();
    const onTransferQueued = vi.fn();

    render(
      <LocalTransferPane
        active
        onTransferQueued={onTransferQueued}
        targetMachine={targetMachine}
        targetPath="/srv/app"
        transferViewScope="sftp-workbench:tab-a"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await openLocalContextMenu(fileRow);

    await user.click(await screen.findByRole("menuitem", { name: "传输到右侧" }));

    expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "host-right",
      kind: "file",
      localPath: initialListing.entries[1].path,
      remotePath: "/srv/app/notes.md",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(onTransferQueued).toHaveBeenCalled();
  });

  it("copies a local entry path through the desktop clipboard facade", async () => {
    const user = userEvent.setup();

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await openLocalContextMenu(fileRow);
    await user.click(await screen.findByRole("menuitem", { name: "复制路径" }));

    await waitFor(() =>
      expect(
        desktopClipboardApiMock.writeDesktopClipboardText,
      ).toHaveBeenCalledWith("C:\\Users\\24052\\notes.md"),
    );
  });

  it("writes a local drag payload for transferable entries", async () => {
    const dataTransfer = createDataTransfer();

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    fireEvent.dragStart(fileRow, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(dataTransfer.getData("text/plain")).toBe(initialListing.entries[1].path);
    expect(
      JSON.parse(dataTransfer.getData(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME)),
    ).toEqual({
      entries: [initialListing.entries[1]],
      source: "local",
    });
  });

  it("opens a directory row on double click", async () => {
    const logsListing: LocalDirectoryListing = {
      entries: [],
      parentPath: initialListing.path,
      path: initialListing.entries[0].path,
    };
    fileDialogApiMock.listLocalDirectory
      .mockResolvedValueOnce(initialListing)
      .mockResolvedValueOnce(logsListing);

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const directoryRow = await screen.findByRole("button", { name: /logs/ });
    fireEvent.doubleClick(directoryRow);

    await waitFor(() =>
      expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(
        initialListing.entries[0].path,
      ),
    );
    expect(
      await screen.findByDisplayValue(initialListing.entries[0].path),
    ).toBeInTheDocument();
  });

  it("does not make non-file local entries draggable", async () => {
    const mixedListing: LocalDirectoryListing = {
      entries: [
        ...initialListing.entries,
        {
          kind: "symlink",
          name: "latest-link",
          path: "C:\\Users\\24052\\latest-link",
          raw: "symlink C:\\Users\\24052\\latest-link",
        },
      ],
      parentPath: initialListing.parentPath,
      path: initialListing.path,
    };
    fileDialogApiMock.listLocalDirectory.mockResolvedValueOnce(mixedListing);

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const linkRow = await screen.findByRole("button", { name: /latest-link/ });

    expect(linkRow).toHaveAttribute("draggable", "false");
  });

  it("copies selected local entries into the workbench clipboard", async () => {
    const onLocalClipboardChange = vi.fn();

    render(
      <LocalTransferPane
        active
        onLocalClipboardChange={onLocalClipboardChange}
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await userEvent.click(fileRow);
    fireEvent.keyDown(fileRow, { ctrlKey: true, key: "c" });

    expect(onLocalClipboardChange).toHaveBeenCalledWith({
      copiedAt: expect.any(Number),
      entries: [
        {
          kind: "file",
          name: "notes.md",
          path: initialListing.entries[1].path,
        },
      ],
      kind: "local",
      sourcePath: initialListing.path,
    });
  });

  it("pastes copied local entries into the selected remote target", async () => {
    const onTransferQueued = vi.fn();

    render(
      <LocalTransferPane
        active
        onTransferQueued={onTransferQueued}
        targetMachine={targetMachine}
        targetPath="/srv/app"
        transferViewScope="sftp-workbench:tab-a"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await userEvent.click(fileRow);
    fireEvent.keyDown(fileRow, { ctrlKey: true, key: "c" });
    fireEvent.keyDown(fileRow, { ctrlKey: true, key: "v" });

    await waitFor(() =>
      expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenCalledWith({
        conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "host-right",
        kind: "file",
        localPath: initialListing.entries[1].path,
        remotePath: "/srv/app/notes.md",
        viewScope: "sftp-workbench:tab-a",
      }),
    );
    expect(onTransferQueued).toHaveBeenCalled();
  });

  it("pastes copied local entries into the current local pane", async () => {
    render(
      <LocalTransferPane
        active
        targetMachine={undefined}
        targetPath={undefined}
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await userEvent.click(fileRow);
    fireEvent.keyDown(fileRow, { ctrlKey: true, key: "c" });
    fireEvent.keyDown(fileRow, { ctrlKey: true, key: "v" });

    await waitFor(() =>
      expect(localFilesApiMock.copyLocalPath).toHaveBeenCalledWith({
        kind: "file",
        rootPath: initialListing.path,
        sourcePath: initialListing.entries[1].path,
        targetDirectoryPath: initialListing.path,
      }),
    );
    expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(
      initialListing.path,
    );
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("does not intercept clipboard shortcuts from the local path input", async () => {
    const onLocalClipboardChange = vi.fn();

    render(
      <LocalTransferPane
        active
        onLocalClipboardChange={onLocalClipboardChange}
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const pathInput = await screen.findByDisplayValue("C:\\Users\\24052");
    fireEvent.keyDown(pathInput, { ctrlKey: true, key: "c" });

    expect(onLocalClipboardChange).not.toHaveBeenCalled();
  });

  it("downloads a remote drag payload into the current local directory", async () => {
    const onTransferQueued = vi.fn();
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(
      SFTP_REMOTE_DRAG_PAYLOAD_MIME,
      JSON.stringify({
        entries: [
          { kind: "file", name: "app.log", path: "/srv/app.log" },
          { kind: "directory", name: "conf", path: "/srv/conf" },
        ],
        sourceHostId: "host-left",
        sourceHostLabel: "left",
      }),
    );

    render(
      <LocalTransferPane
        active
        onTransferQueued={onTransferQueued}
        targetMachine={targetMachine}
        targetPath="/srv/app"
        transferViewScope="sftp-workbench:tab-a"
      />,
    );

    const pane = await screen.findByLabelText("本地目录面板");
    fireEvent.dragOver(pane, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    fireEvent.drop(pane, { dataTransfer });

    await waitFor(() =>
      expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenCalledTimes(2),
    );
    expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenNthCalledWith(1, {
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "host-left",
      kind: "file",
      localPath: "C:\\Users\\24052\\app.log",
      remotePath: "/srv/app.log",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(sftpApiMock.enqueueSftpTransfer).toHaveBeenNthCalledWith(2, {
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "host-left",
      kind: "directory",
      localPath: "C:\\Users\\24052\\conf",
      remotePath: "/srv/conf",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(onTransferQueued).toHaveBeenCalled();
  });

  it("shows an error instead of queueing an invalid remote drag payload", async () => {
    const dataTransfer = createDataTransfer();
    dataTransfer.setData(SFTP_REMOTE_DRAG_PAYLOAD_MIME, "{bad json");

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    await screen.findByRole("button", { name: /notes.md/ });
    const pane = screen.getByLabelText("本地目录面板");
    fireEvent.drop(pane, { dataTransfer });

    expect(
      await screen.findByText("无法识别拖拽的远程文件。"),
    ).toBeInTheDocument();
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("copies a local drag payload dropped back onto the local pane", async () => {
    const dataTransfer = createDataTransfer();

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    fireEvent.dragStart(fileRow, { dataTransfer });

    const pane = screen.getByLabelText("本地目录面板");
    fireEvent.dragOver(pane, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(pane.className).toContain("border-sky-400");
    fireEvent.drop(pane, { dataTransfer });

    await waitFor(() =>
      expect(localFilesApiMock.copyLocalPath).toHaveBeenCalledWith({
        kind: "file",
        rootPath: initialListing.path,
        sourcePath: initialListing.entries[1].path,
        targetDirectoryPath: initialListing.path,
      }),
    );
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

});function createDataTransfer() {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => store.get(type) ?? "",
    setData: (type: string, value: string) => store.set(type, value),
    get types() {
      return Array.from(store.keys());
    },
  };
}
async function openLocalContextMenu(target: HTMLElement) {
  await waitFor(() => {
    fireEvent.contextMenu(target, { bubbles: true, cancelable: true, clientX: 12, clientY: 16 });
    expect(screen.getByRole("menu", { name: "本地文件操作菜单" })).toBeInTheDocument();
  });
}
