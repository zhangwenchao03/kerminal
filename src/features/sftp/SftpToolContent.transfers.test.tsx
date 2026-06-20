import {
  fireEvent,
  render,
  screen,
  waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe,
  expect,
  it,
  vi } from "vitest";
import {  containerFilesApiMocks,
  fileDialogMocks,
  openCurrentDirectoryContextMenu,
  sftpApiMocks,
  sshMachine,
  containerMachine,
  webviewMocks,
} from "./SftpToolContent.testSupport";
import { SftpToolContent } from "./SftpToolContent";

describe("SftpToolContent transfers and containers", () => {
  it("downloads a selected file from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 app.log" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectSaveFile).toHaveBeenCalledWith("app.log"),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      direction: "download",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/var/log/app.log",
    });
    expect(await screen.findByText(/已加入下载队列/)).toBeInTheDocument();
  });

  it("downloads a directory from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "打开目录 var" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载文件夹" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      direction: "download",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/Downloads/var",
      remotePath: "/var",
    });
    expect(await screen.findByText(/已加入文件夹下载队列/)).toBeInTheDocument();
  });

  it("downloads a selected remote file as a ZIP archive", async () => {
    const user = userEvent.setup();
    fileDialogMocks.selectSaveFile.mockResolvedValue(
      "/Users/me/Downloads/app.log.zip",
    );

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 app.log" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载为 ZIP" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectSaveFile).toHaveBeenCalledWith(
        "app.log.zip",
      ),
    );
    expect(sftpApiMocks.enqueueSftpArchiveDownload).toHaveBeenCalledWith({
      hostId: "prod-api",
      kind: "file",
      sourceRemotePath: "/var/log/app.log",
      targetLocalPath: "/Users/me/Downloads/app.log.zip",
    });
    expect(await screen.findByText(/已加入 ZIP 下载队列/)).toBeInTheDocument();
  });

  it("downloads a remote directory as a ZIP archive from the context menu", async () => {
    const user = userEvent.setup();
    fileDialogMocks.selectSaveFile.mockResolvedValue(
      "/Users/me/Downloads/var.zip",
    );

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "打开目录 var" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载为 ZIP" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectSaveFile).toHaveBeenCalledWith("var.zip"),
    );
    expect(sftpApiMocks.enqueueSftpArchiveDownload).toHaveBeenCalledWith({
      hostId: "prod-api",
      kind: "directory",
      sourceRemotePath: "/var",
      targetLocalPath: "/Users/me/Downloads/var.zip",
    });
  });

  it("downloads a selected remote file to the local file clipboard", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 app.log" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载到剪贴板" }));

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpClipboardDownload).toHaveBeenCalledWith({
        hostId: "prod-api",
        kind: "file",
        sourceRemotePath: "/var/log/app.log",
      }),
    );
    expect(
      await screen.findByText(/已加入本地剪贴板下载队列/),
    ).toBeInTheDocument();
  });

  it("downloads a remote directory to the local file clipboard from the context menu", async () => {
    const user = userEvent.setup();
    sftpApiMocks.enqueueSftpClipboardDownload.mockImplementationOnce(
      async (request) => ({
        bytesTransferred: 0,
        cancelRequested: false,
        createdAt: 1,
        direction: "download",
        hostId: request.hostId,
        id: "clipboard-download-1",
        kind: request.kind,
        localPath: "/Users/me/Downloads/var",
        remotePath: request.sourceRemotePath,
        status: "queued",
        totalBytes: undefined,
        updatedAt: 1,
      }),
    );

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "打开目录 var" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载到剪贴板" }));

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpClipboardDownload).toHaveBeenCalledWith({
        hostId: "prod-api",
        kind: "directory",
        sourceRemotePath: "/var",
      }),
    );
  });

  it("uploads a local file from the toolbar upload menu and refreshes the current directory", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalFile).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      direction: "upload",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/release.tgz",
    });
    expect(await screen.findByText(/已加入上传队列/)).toBeInTheDocument();
  });

  it("uploads a local directory from the toolbar upload menu", async () => {
    const user = userEvent.setup();
    fileDialogMocks.selectLocalDirectory.mockResolvedValue("/Users/me/dist");

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件夹" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      direction: "upload",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/dist",
      remotePath: "/dist",
    });
    expect(await screen.findByText(/已加入文件夹上传队列/)).toBeInTheDocument();
  });

  it("loads container files through the unified file panel", async () => {
    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("docker:prod-api:api")).toBeInTheDocument();
    expect(containerFilesApiMocks.listDockerContainerDirectory).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      path: "/app",
      runtime: "docker",
    });
    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "上传文件为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "粘贴 SFTP 剪贴板" }),
    ).not.toBeInTheDocument();
  });

  it("uploads a local file into a container from the shared toolbar", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalFile).toHaveBeenCalled(),
    );
    expect(containerFilesApiMocks.uploadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/app/release.tgz",
      runtime: "docker",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(await screen.findByText(/已上传：release.tgz/)).toBeInTheDocument();
  });

  it("downloads a container file from the shared context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 package.json" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );

    expect(screen.getByRole("menuitem", { name: "下载" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "下载为 ZIP" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "下载" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectSaveFile).toHaveBeenCalledWith(
        "package.json",
      ),
    );
    expect(containerFilesApiMocks.downloadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/app/package.json",
      runtime: "docker",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(await screen.findByText(/已下载：\/app\/package.json/)).toBeInTheDocument();
  });

  it("opens a container file in the same remote workspace editor", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    await user.dblClick(
      screen.getByRole("button", { name: "文件 package.json" }),
    );

    expect(
      await screen.findByTestId("remote-workspace-editor"),
    ).toHaveTextContent("/app/package.json");
    expect(screen.getByTestId("remote-workspace-target")).toHaveTextContent(
      "dockerContainer",
    );
  });

  it("dismisses workspace error status after a short hint", async () => {
    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "文件 package.json" }),
    );
    expect(
      await screen.findByTestId("remote-workspace-editor"),
    ).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "触发工作区错误" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "容器文件包含二进制内容",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uploads a local directory as a ZIP archive from the context menu", async () => {
    const user = userEvent.setup();
    fileDialogMocks.selectLocalDirectory.mockResolvedValue("/Users/me/dist");

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    openCurrentDirectoryContextMenu();
    await user.click(
      screen.getByRole("menuitem", { name: "上传文件夹为 ZIP" }),
    );

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpArchiveUpload).toHaveBeenCalledWith({
      hostId: "prod-api",
      kind: "directory",
      sourceLocalPath: "/Users/me/dist",
      targetRemotePath: "/dist.zip",
    });
    expect(await screen.findByText(/已加入 ZIP 上传队列/)).toBeInTheDocument();
  });

  it("uploads dropped local paths into the current SFTP directory", async () => {
    const dragDropHandlers: Array<(event: { payload: unknown }) => void> = [];
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    webviewMocks.onDragDropEvent.mockImplementation(
      async (handler: (event: { payload: unknown }) => void) => {
        dragDropHandlers.push(handler);
        return () => undefined;
      },
    );

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await waitFor(() =>
      expect(webviewMocks.onDragDropEvent).toHaveBeenCalled(),
    );
    const dropZone = screen.getByTestId("sftp-drop-zone");
    dropZone.getBoundingClientRect = () =>
      ({
        bottom: 240,
        height: 220,
        left: 10,
        right: 430,
        top: 20,
        width: 420,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    dragDropHandlers[0]({
      payload: {
        paths: ["/Users/me/release.tgz", "/Users/me/dist"],
        position: { x: 24, y: 48 },
        type: "drop",
      },
    });

    await waitFor(() =>
      expect(sftpApiMocks.classifySftpLocalPaths).toHaveBeenCalledWith({
        paths: ["/Users/me/release.tgz", "/Users/me/dist"],
      }),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      direction: "upload",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/release.tgz",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      direction: "upload",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/dist",
      remotePath: "/dist",
    });
    expect(
      await screen.findByText(/已加入拖拽上传队列：2 个本地项目/),
    ).toBeInTheDocument();
  });

});
