import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalDirectoryListing } from "../../../../src/lib/fileDialogApi";
import type { Machine } from "../../../../src/features/workspace/types";
import { LocalTransferPane } from "../../../../src/features/sftp/LocalTransferPane";

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
      new Error("目标目录已存在: token=secret"),
    );

    render(<LocalTransferPane active targetMachine={targetMachine} targetPath="/srv/app" />);

    await screen.findByText("notes.md");
    await user.click(screen.getByRole("button", { name: "新建" }));
    await user.type(screen.getByLabelText("文件夹名称"), "exists");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("本地文件操作未完成")).toBeVisible();
    const technicalDetail = screen.getByText(/目标目录已存在/);
    expect(technicalDetail).not.toBeVisible();
    expect(technicalDetail).not.toHaveTextContent("token=secret");
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


});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}async function openLocalContextMenu(target: HTMLElement) {
  await waitFor(() => {
    fireEvent.contextMenu(target, { bubbles: true, cancelable: true, clientX: 12, clientY: 16 });
    expect(screen.getByRole("menu", { name: "本地文件操作菜单" })).toBeInTheDocument();
  });
}
