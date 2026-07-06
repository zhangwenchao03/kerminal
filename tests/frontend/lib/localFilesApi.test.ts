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

  it("reads and writes local text files through local file commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        binary: false,
        bytesRead: 5,
        content: "hello",
        encoding: "utf-8-lossy",
        lineEnding: "lf",
        maxBytes: 1024,
        path: "C:\\\\repo\\\\notes.md",
        readonly: false,
        revision: { contentSha256: "sha-a", size: 5 },
        truncated: false,
      })
      .mockResolvedValueOnce({
        bytesWritten: 6,
        encoding: "utf-8",
        lineEnding: "lf",
        path: "C:\\\\repo\\\\notes.md",
        revision: { contentSha256: "sha-b", size: 6 },
      });
    const { readLocalTextFile, writeLocalTextFile } = await import(
      "../../../src/lib/localFilesApi"
    );

    const opened = await readLocalTextFile({
      maxBytes: 1024,
      path: "C:\\\\repo\\\\notes.md",
    });
    await writeLocalTextFile({
      content: "hello!",
      create: false,
      encoding: "utf-8",
      expectedRevision: opened.revision,
      overwriteOnConflict: false,
      path: "C:\\\\repo\\\\notes.md",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "local_files_read_text_file", {
      request: {
        maxBytes: 1024,
        path: "C:\\\\repo\\\\notes.md",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "local_files_write_text_file", {
      request: {
        content: "hello!",
        create: false,
        encoding: "utf-8",
        expectedRevision: { contentSha256: "sha-a", size: 5 },
        overwriteOnConflict: false,
        path: "C:\\\\repo\\\\notes.md",
      },
    });
  });

  it("supports browser preview read and write for local text files", async () => {
    isTauriMock.mockReturnValue(false);
    const { readLocalTextFile, writeLocalTextFile } = await import(
      "../../../src/lib/localFilesApi"
    );

    await writeLocalTextFile({
      content: "local preview",
      create: false,
      encoding: "utf-8",
      expectedRevision: null,
      overwriteOnConflict: false,
      path: "/tmp/local.md",
    });
    const opened = await readLocalTextFile({ path: "/tmp/local.md" });

    expect(opened.content).toBe("local preview");
    expect(opened.readonly).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects local write operations outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      copyLocalPath,
      createLocalDirectory,
      deleteLocalPath,
      readLocalTextFile,
      renameLocalPath,
      statLocalPath,
      writeLocalTextFile,
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
    await expect(readLocalTextFile({ path: "C:\\\\Source\\\\notes.md" })).resolves.toMatchObject({
      path: "C:\\\\Source\\\\notes.md",
    });
    await expect(
      writeLocalTextFile({
        content: "ok",
        create: false,
        encoding: "utf-8",
        expectedRevision: null,
        overwriteOnConflict: false,
        path: "C:\\\\Source\\\\notes.md",
      }),
    ).resolves.toMatchObject({
      path: "C:\\\\Source\\\\notes.md",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
