import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDirectoryListing } from "../../lib/fileDialogApi";
import type { Machine } from "../workspace/types";
import { LocalTransferPane } from "./LocalTransferPane";
import { SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME } from "./sftp-tool-content/sftpLocalUploadDropModel";
import { SFTP_REMOTE_DRAG_PAYLOAD_MIME } from "./sftp-tool-content/sftpRemoteTransferModel";

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

vi.mock("../../lib/fileDialogApi", () => ({
  listLocalDirectory: fileDialogApiMock.listLocalDirectory,
  openLocalDirectory: fileDialogApiMock.openLocalDirectory,
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
}));

vi.mock("../../lib/sftpApi", () => ({
  enqueueSftpTransfer: sftpApiMock.enqueueSftpTransfer,
}));

vi.mock("../../lib/localFilesApi", () => ({
  createLocalDirectory: localFilesApiMock.createLocalDirectory,
  copyLocalPath: localFilesApiMock.copyLocalPath,
  deleteLocalPath: localFilesApiMock.deleteLocalPath,
  renameLocalPath: localFilesApiMock.renameLocalPath,
}));

vi.mock("../../lib/desktopClipboardApi", () => ({
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

const selectedListing: LocalDirectoryListing = {
  entries: [
    {
      kind: "file",
      name: "latest.txt",
      path: "C:\\Latest\\latest.txt",
      raw: "file C:\\Latest\\latest.txt",
      size: 1024,
    },
  ],
  parentPath: "C:\\",
  path: "C:\\Latest",
};

const staleListing: LocalDirectoryListing = {
  entries: [
    {
      kind: "file",
      name: "stale.txt",
      path: "C:\\Stale\\stale.txt",
      raw: "file C:\\Stale\\stale.txt",
      size: 512,
    },
  ],
  parentPath: "C:\\",
  path: "C:\\Stale",
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
};

const renamedDirectoryListing: LocalDirectoryListing = {
  entries: [
    {
      kind: "directory",
      name: "renamed-logs",
      path: "C:\\\\Users\\\\24052\\\\renamed-logs",
      raw: "directory C:\\\\Users\\\\24052\\\\renamed-logs",
    },
    initialListing.entries[1],
  ],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};

const deletedFileListing: LocalDirectoryListing = {
  entries: [initialListing.entries[0]],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};

const deletedDirectoryListing: LocalDirectoryListing = {
  entries: [initialListing.entries[1]],
  parentPath: initialListing.parentPath,
  path: initialListing.path,
};

describe("LocalTransferPane", () => {
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

  it("loads the local directory summary and remote target label", async () => {
    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(null);
    expect(await screen.findByText("logs")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByDisplayValue("C:\\Users\\24052")).toBeInTheDocument();
    expect(screen.getByText("2 项 / 1 目录 / 1 文件")).toBeInTheDocument();
    expect(screen.getByText("目标：right:/srv/app")).toBeInTheDocument();
  });

  it("does not let a stale local directory request overwrite the latest listing", async () => {
    const user = userEvent.setup();
    const firstRequest = createDeferred<LocalDirectoryListing>();
    const secondRequest = createDeferred<LocalDirectoryListing>();

    fileDialogApiMock.listLocalDirectory
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue("C:\\Latest");

    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(null);

    await user.click(screen.getByRole("button", { name: "选择本地目录" }));
    await waitFor(() =>
      expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(
        "C:\\Latest",
      ),
    );

    secondRequest.resolve(selectedListing);
    expect(await screen.findByText("latest.txt")).toBeInTheDocument();
    expect(screen.getByDisplayValue("C:\\Latest")).toBeInTheDocument();

    firstRequest.resolve(staleListing);
    await waitFor(() =>
      expect(screen.getByDisplayValue("C:\\Latest")).toBeInTheDocument(),
    );
    expect(screen.queryByText("stale.txt")).not.toBeInTheDocument();
  });

  it("creates a local directory from the toolbar", async () => {
    const user = userEvent.setup();

    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    await screen.findByText("notes.md");
    await user.click(screen.getByRole("button", { name: "新建" }));
    await user.type(screen.getByLabelText("文件夹名称"), "  new-dir  ");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(localFilesApiMock.createLocalDirectory).toHaveBeenCalledWith({
        name: "new-dir",
        parentPath: initialListing.path,
        rootPath: initialListing.path,
      }),
    );
    expect(await screen.findByText("new-dir")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "新建文件夹" }),
    ).not.toBeInTheDocument();
    expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledTimes(1);
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("creates a local directory from the blank context menu", async () => {
    const user = userEvent.setup();
    localFilesApiMock.createLocalDirectory.mockResolvedValue({
      ...createdDirectoryListing,
      entries: [
        ...initialListing.entries,
        {
          kind: "directory",
          name: "menu-dir",
          path: "C:\\\\Users\\\\24052\\\\menu-dir",
          raw: "directory C:\\\\Users\\\\24052\\\\menu-dir",
        },
      ],
    });

    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    await screen.findByText("notes.md");
    const pane = screen.getByLabelText("本地目录面板");
    await openLocalContextMenu(pane);
    await user.click(await screen.findByRole("menuitem", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("文件夹名称"), "menu-dir");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() =>
      expect(localFilesApiMock.createLocalDirectory).toHaveBeenCalledWith({
        name: "menu-dir",
        parentPath: initialListing.path,
        rootPath: initialListing.path,
      }),
    );
    expect(await screen.findByText("menu-dir")).toBeInTheDocument();
  });

  it("does not offer local directory creation from an entry context menu", async () => {
    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await openLocalContextMenu(fileRow);

    expect(
      screen.queryByRole("menuitem", { name: "新建文件夹" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error when creating a local directory fails", async () => {
    const user = userEvent.setup();
    localFilesApiMock.createLocalDirectory.mockRejectedValue(
      new Error("目标目录已存在"),
    );

    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    await screen.findByText("notes.md");
    await user.click(screen.getByRole("button", { name: "新建" }));
    await user.type(screen.getByLabelText("文件夹名称"), "exists");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目标目录已存在",
    );
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("does not create a local directory when the dialog is cancelled or blank", async () => {
    const user = userEvent.setup();

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    await screen.findByText("notes.md");
    const createButton = screen.getByRole("button", { name: "新建" });
    await user.click(createButton);
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(createButton);
    await user.type(screen.getByLabelText("文件夹名称"), "   ");

    expect(screen.getByRole("button", { name: "创建" })).toBeDisabled();
    expect(localFilesApiMock.createLocalDirectory).not.toHaveBeenCalled();
  });

  it("renames a local file from the rename dialog", async () => {
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
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const nameInput = screen.getByLabelText("新名称");
    await user.clear(nameInput);
    await user.type(nameInput, "renamed.md");
    await user.click(screen.getByRole("button", { name: "确认重命名" }));

    await waitFor(() =>
      expect(localFilesApiMock.renameLocalPath).toHaveBeenCalledWith({
        kind: "file",
        name: "renamed.md",
        path: initialListing.entries[1].path,
        rootPath: initialListing.path,
      }),
    );
    expect(await screen.findByText("renamed.md")).toBeInTheDocument();
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "重命名本机项目" }),
    ).not.toBeInTheDocument();
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("renames a local directory from the entry context menu", async () => {
    const user = userEvent.setup();
    localFilesApiMock.renameLocalPath.mockResolvedValue(renamedDirectoryListing);

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const directoryRow = await screen.findByRole("button", { name: /logs/ });
    await openLocalContextMenu(directoryRow);
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const nameInput = screen.getByLabelText("新名称");
    await user.clear(nameInput);
    await user.type(nameInput, "renamed-logs");
    await user.click(screen.getByRole("button", { name: "确认重命名" }));

    await waitFor(() =>
      expect(localFilesApiMock.renameLocalPath).toHaveBeenCalledWith({
        kind: "directory",
        name: "renamed-logs",
        path: initialListing.entries[0].path,
        rootPath: initialListing.path,
      }),
    );
    expect(await screen.findByText("renamed-logs")).toBeInTheDocument();
  });

  it("does not offer rename from the blank context menu", async () => {
    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    await screen.findByText("notes.md");
    await openLocalContextMenu(screen.getByLabelText("本地目录面板"));

    expect(
      screen.queryByRole("menuitem", { name: "重命名" }),
    ).not.toBeInTheDocument();
  });

  it("shows an error when renaming a local entry fails", async () => {
    const user = userEvent.setup();
    localFilesApiMock.renameLocalPath.mockRejectedValue(
      new Error("目标已存在"),
    );

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await openLocalContextMenu(fileRow);
    await user.click(await screen.findByRole("menuitem", { name: "重命名" }));
    const nameInput = screen.getByLabelText("新名称");
    await user.clear(nameInput);
    await user.type(nameInput, "existing.md");
    await user.click(screen.getByRole("button", { name: "确认重命名" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("目标已存在");
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("deletes a local file from the entry context menu after exact-name confirmation", async () => {
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
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));

    expect(screen.getByRole("dialog", { name: "删除本机项目" })).toBeInTheDocument();
    expect(localFilesApiMock.deleteLocalPath).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("输入名称确认删除"), "notes.md");
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(localFilesApiMock.deleteLocalPath).toHaveBeenCalledWith({
        confirmName: "notes.md",
        kind: "file",
        path: initialListing.entries[1].path,
        recursive: false,
        rootPath: initialListing.path,
      }),
    );
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();
    expect(screen.getByText("logs")).toBeInTheDocument();
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("deletes a local directory recursively after confirmation", async () => {
    const user = userEvent.setup();
    localFilesApiMock.deleteLocalPath.mockResolvedValue(deletedDirectoryListing);

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const directoryRow = await screen.findByRole("button", { name: /logs/ });
    await openLocalContextMenu(directoryRow);
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));

    expect(
      screen.getByText("目录会递归删除，包含其中所有文件和子目录。"),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("输入名称确认删除"), "logs");
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(localFilesApiMock.deleteLocalPath).toHaveBeenCalledWith({
        confirmName: "logs",
        kind: "directory",
        path: initialListing.entries[0].path,
        recursive: true,
        rootPath: initialListing.path,
      }),
    );
    expect(await screen.findByText("notes.md")).toBeInTheDocument();
    expect(screen.queryByText("logs")).not.toBeInTheDocument();
  });

  it("does not delete when the local delete dialog is cancelled", async () => {
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
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(localFilesApiMock.deleteLocalPath).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "删除本机项目" })).not.toBeInTheDocument();
  });

  it("keeps delete disabled until the confirmation name matches exactly", async () => {
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
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));

    const confirmButton = screen.getByRole("button", { name: "确认删除" });
    expect(confirmButton).toBeDisabled();
    await user.type(screen.getByLabelText("输入名称确认删除"), "notes");
    expect(confirmButton).toBeDisabled();
    expect(localFilesApiMock.deleteLocalPath).not.toHaveBeenCalled();
  });

  it("does not offer delete from the blank context menu or symlink entries", async () => {
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

    await screen.findByText("notes.md");
    await openLocalContextMenu(screen.getByLabelText("本地目录面板"));
    expect(screen.queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument();

    fireEvent.click(document.body);
    const linkRow = await screen.findByRole("button", { name: /latest-link/ });
    await openLocalContextMenu(linkRow);
    expect(screen.queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument();
  });

  it("shows an error when deleting a local entry fails", async () => {
    const user = userEvent.setup();
    localFilesApiMock.deleteLocalPath.mockRejectedValue(
      new Error("删除确认名称不匹配"),
    );

    render(
      <LocalTransferPane
        active
        targetMachine={targetMachine}
        targetPath="/srv/app"
      />,
    );

    const fileRow = await screen.findByRole("button", { name: /notes.md/ });
    await openLocalContextMenu(fileRow);
    await user.click(await screen.findByRole("menuitem", { name: "删除" }));
    await user.type(screen.getByLabelText("输入名称确认删除"), "notes.md");
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "删除确认名称不匹配",
    );
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
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

    const pane = await screen.findByLabelText("本地目录面板");
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
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
function createDataTransfer() {
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
