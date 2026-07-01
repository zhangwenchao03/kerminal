import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("localFilesApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("creates a local directory through the local files command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entries: [],
      path: "C:\\\\Users\\\\24052",
    });
    const { createLocalDirectory } = await import("../../../src/lib/localFilesApi");

    await createLocalDirectory({
      name: "logs",
      parentPath: "C:\\\\Users\\\\24052",
      rootPath: "C:\\\\Users\\\\24052",
    });

    expect(invokeMock).toHaveBeenCalledWith("local_files_create_directory", {
      request: {
        name: "logs",
        parentPath: "C:\\\\Users\\\\24052",
        rootPath: "C:\\\\Users\\\\24052",
      },
    });
  });

  it("copies a local path through the local files command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entries: [],
      path: "C:\\\\Target",
    });
    const { copyLocalPath } = await import("../../../src/lib/localFilesApi");

    await copyLocalPath({
      kind: "file",
      rootPath: "C:\\\\Target",
      sourcePath: "C:\\\\Source\\\\notes.md",
      targetDirectoryPath: "C:\\\\Target",
    });

    expect(invokeMock).toHaveBeenCalledWith("local_files_copy_path", {
      request: {
        kind: "file",
        rootPath: "C:\\\\Target",
        sourcePath: "C:\\\\Source\\\\notes.md",
        targetDirectoryPath: "C:\\\\Target",
      },
    });
  });

  it("renames a local path through the local files command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entries: [],
      path: "C:\\\\Users\\\\24052",
    });
    const { renameLocalPath } = await import("../../../src/lib/localFilesApi");

    await renameLocalPath({
      kind: "file",
      name: "renamed.md",
      path: "C:\\\\Users\\\\24052\\\\notes.md",
      rootPath: "C:\\\\Users\\\\24052",
    });

    expect(invokeMock).toHaveBeenCalledWith("local_files_rename_path", {
      request: {
        kind: "file",
        name: "renamed.md",
        path: "C:\\\\Users\\\\24052\\\\notes.md",
        rootPath: "C:\\\\Users\\\\24052",
      },
    });
  });

  it("deletes a local path through the local files command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entries: [],
      path: "C:\\\\Users\\\\24052",
    });
    const { deleteLocalPath } = await import("../../../src/lib/localFilesApi");

    await deleteLocalPath({
      confirmName: "notes.md",
      kind: "file",
      path: "C:\\\\Users\\\\24052\\\\notes.md",
      recursive: false,
      rootPath: "C:\\\\Users\\\\24052",
    });

    expect(invokeMock).toHaveBeenCalledWith("local_files_delete_path", {
      request: {
        confirmName: "notes.md",
        kind: "file",
        path: "C:\\\\Users\\\\24052\\\\notes.md",
        recursive: false,
        rootPath: "C:\\\\Users\\\\24052",
      },
    });
  });

  it("stats a local path through the local files command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      exists: true,
      kind: "file",
      path: "C:\\\\Users\\\\24052\\\\notes.md",
      readonly: false,
      size: 2048,
    });
    const { statLocalPath } = await import("../../../src/lib/localFilesApi");

    await statLocalPath({
      path: "C:\\\\Users\\\\24052\\\\notes.md",
      rootPath: "C:\\\\Users\\\\24052",
    });

    expect(invokeMock).toHaveBeenCalledWith("local_files_stat_path", {
      request: {
        path: "C:\\\\Users\\\\24052\\\\notes.md",
        rootPath: "C:\\\\Users\\\\24052",
      },
    });
  });

  it("rejects local write operations outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      copyLocalPath,
      createLocalDirectory,
      deleteLocalPath,
      renameLocalPath,
      statLocalPath,
    } = await import("../../../src/lib/localFilesApi");

    await expect(
      createLocalDirectory({
        name: "logs",
        parentPath: "C:\\\\Target",
        rootPath: "C:\\\\Target",
      }),
    ).rejects.toThrow("本机文件操作仅支持桌面应用。");

    await expect(
      copyLocalPath({
        kind: "file",
        rootPath: "C:\\\\Target",
        sourcePath: "C:\\\\Source\\\\notes.md",
        targetDirectoryPath: "C:\\\\Target",
      }),
    ).rejects.toThrow("本机文件操作仅支持桌面应用。");
    await expect(
      renameLocalPath({
        kind: "file",
        name: "renamed.md",
        path: "C:\\\\Source\\\\notes.md",
        rootPath: "C:\\\\Source",
      }),
    ).rejects.toThrow("本机文件操作仅支持桌面应用。");
    await expect(
      deleteLocalPath({
        confirmName: "notes.md",
        kind: "file",
        path: "C:\\\\Source\\\\notes.md",
        recursive: false,
        rootPath: "C:\\\\Source",
      }),
    ).rejects.toThrow("本机文件操作仅支持桌面应用。");
    await expect(
      statLocalPath({
        path: "C:\\\\Source\\\\notes.md",
        rootPath: "C:\\\\Source",
      }),
    ).rejects.toThrow("本机文件操作仅支持桌面应用。");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
