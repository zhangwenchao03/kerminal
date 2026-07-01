import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("containerFilesApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("normalizes directory requests for the Tauri command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      containerId: "api",
      entries: [],
      hostId: "host-1",
      path: "/app",
    });
    const { listDockerContainerDirectory } = await import(
      "../../../src/lib/containerFilesApi"
    );

    await listDockerContainerDirectory({
      containerId: " api ",
      hostId: " host-1 ",
      path: " //app// ",
    });

    expect(invokeMock).toHaveBeenCalledWith("docker_list_directory", {
      request: {
        containerId: "api",
        hostId: "host-1",
        path: "/app",
        runtime: "docker",
      },
    });
  });

  it("uses one transfer command for file uploads and downloads", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(true);
    const { downloadDockerContainerPath, uploadDockerContainerPath } =
      await import("../../../src/lib/containerFilesApi");

    await uploadDockerContainerPath({
      containerId: "api",
      hostId: "host-1",
      kind: "file",
      localPath: "C:/tmp/app.log",
      remotePath: "/tmp/app.log",
    });
    await downloadDockerContainerPath({
      containerId: "api",
      hostId: "host-1",
      kind: "directory",
      localPath: "C:/tmp/app",
      remotePath: "/app",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "docker_upload", {
      request: expect.objectContaining({
        kind: "file",
        remotePath: "/tmp/app.log",
      }),
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "docker_download", {
      request: expect.objectContaining({
        kind: "directory",
        remotePath: "/app",
      }),
    });
  });

  it("normalizes container text file read and write commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        binary: false,
        bytesRead: 12,
        containerId: "api",
        content: "hello",
        encoding: "utf-8",
        hostId: "host-1",
        lineEnding: "lf",
        maxBytes: 1024,
        path: "/app/config.json",
        readonly: false,
        revision: { contentSha256: "sha-a", size: 5 },
        truncated: false,
      })
      .mockResolvedValueOnce({
        bytesWritten: 5,
        containerId: "api",
        encoding: "utf-8",
        hostId: "host-1",
        lineEnding: "lf",
        path: "/app/config.json",
        revision: { contentSha256: "sha-b", size: 5 },
      });
    const {
      readDockerContainerTextFile,
      writeDockerContainerTextFile,
    } = await import("../../../src/lib/containerFilesApi");

    await readDockerContainerTextFile({
      containerId: " api ",
      hostId: " host-1 ",
      maxBytes: 1024,
      path: "app/config.json",
      runtime: "docker",
    });
    await writeDockerContainerTextFile({
      containerId: " api ",
      content: "hello",
      create: false,
      encoding: "utf-8",
      expectedRevision: { contentSha256: "sha-a", size: 5 },
      hostId: " host-1 ",
      overwriteOnConflict: false,
      path: "app/config.json",
      runtime: "docker",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "docker_read_text_file", {
      request: {
        containerId: "api",
        hostId: "host-1",
        maxBytes: 1024,
        path: "/app/config.json",
        runtime: "docker",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "docker_write_text_file", {
      request: {
        containerId: "api",
        content: "hello",
        create: false,
        encoding: "utf-8",
        expectedRevision: { contentSha256: "sha-a", size: 5 },
        hostId: "host-1",
        overwriteOnConflict: false,
        path: "/app/config.json",
        runtime: "docker",
      },
    });
  });

  it("provides browser preview entries outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listDockerContainerDirectory } = await import(
      "../../../src/lib/containerFilesApi"
    );

    const listing = await listDockerContainerDirectory({
      containerId: "api",
      hostId: "host-1",
      path: "/app",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(listing.entries.some((entry) => entry.name === "package.json")).toBe(
      true,
    );
  });
});
