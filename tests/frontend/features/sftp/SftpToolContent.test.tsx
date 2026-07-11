import {
  act,
  fireEvent,
  render,
  screen,
  waitFor } from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import { afterEach,
  describe,
  expect,
  it,
  vi } from "vitest";
import {  localMachine,
  containerFilesApiMocks,
  containerMachine,
  sftpApiMocks,
  sshCommandApiMocks,
  sshMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";


describe("SftpToolContent basic behavior", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("shows an empty state for non SSH machines", () => {
    render(<SftpToolContent selectedMachine={localMachine} />);



    expect(screen.getByText("本地文件")).toBeInTheDocument();
    expect(screen.getByText("本机文件系统")).toBeInTheDocument();
    expect(screen.getByLabelText("当前本地路径")).toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();

  });



  it("does not load a remote directory while inactive", () => {

    render(<SftpToolContent active={false} selectedMachine={sshMachine} />);



    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();

    expect(screen.getByLabelText("当前远程路径")).toBeInTheDocument();

  });



  it("uses a compact path-only header when embedded in the transfer workbench", async () => {

    render(<SftpToolContent compactHeader selectedMachine={sshMachine} />);



    expect(screen.getByLabelText("当前远程路径")).toBeInTheDocument();

    expect(await screen.findByText("var")).toBeInTheDocument();

    expect(screen.queryByText("deploy@prod.internal:22")).not.toBeInTheDocument();

    expect(screen.queryByText("CWD SYNC")).not.toBeInTheDocument();

    expect(

      screen.queryByRole("switch", { name: "跟随终端目录" }),

    ).not.toBeInTheDocument();

  });



  it("loads and navigates the selected SSH host directory on directory double click", async () => {
    const user = userEvent.setup();



    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledWith({

      hostId: "prod-api",

      path: "/",

    });

    expect(screen.queryByText("上级")).not.toBeInTheDocument();

    expect(screen.queryByText("刷新")).not.toBeInTheDocument();

    expect(screen.queryByText("上传文件")).not.toBeInTheDocument();

    expect(screen.queryByText("上传文件夹")).not.toBeInTheDocument();

    expect(screen.queryByText("新建")).not.toBeInTheDocument();

    expect(screen.queryByText("隐藏点文件")).not.toBeInTheDocument();

    expect(

      screen.queryByRole("status", { name: "SFTP 传输状态" }),

    ).not.toBeInTheDocument();



    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));


    expect(await screen.findByText("app.log")).toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({
      hostId: "prod-api",
      path: "/var/log",
    });
  });

  it("selects a directory without entering it on single click", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    const initialLoadCount = sftpApiMocks.listSftpDirectory.mock.calls.length;
    const logDirectory = screen.getByRole("button", { name: "打开目录 log" });

    await user.click(logDirectory);
    await new Promise((resolve) => window.setTimeout(resolve, 220));

    expect(
      logDirectory.closest("[aria-selected='true']"),
    ).toBeInTheDocument();
    expect(screen.queryByText("app.log")).not.toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledTimes(
      initialLoadCount,
    );
  });

  it("lets users explicitly trust an unknown SFTP host key after a directory error", async () => {
    const user = userEvent.setup();

    sftpApiMocks.listSftpDirectory.mockRejectedValueOnce(

      new Error("SSH 主机密钥未信任"),

    );



    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("无法读取远程目录")).toBeInTheDocument();
    expect(screen.getByText(/SSH 主机密钥未信任/)).not.toBeVisible();
    await user.click(

      screen.getByRole("button", { name: "信任 SFTP 主机密钥" }),

    );



    await waitFor(() =>

      expect(sftpApiMocks.trustSftpHostKey).toHaveBeenCalledWith({

        hostId: "prod-api",

      }),

    );

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({

      hostId: "prod-api",

      path: "/",

    });

    expect(

      await screen.findByText("已信任主机密钥：prod.internal:22"),

    ).toBeInTheDocument();

  });



  it("opens a context menu from right clicking files and folders", async () => {

    const user = userEvent.setup();



    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "打开目录 var" }),

      {

        clientX: 80,

        clientY: 120,

      },

    );



    expect(

      screen.getByRole("menu", { name: "SFTP var 右键菜单" }),

    ).toBeInTheDocument();

    expect(screen.getByRole("menuitem", { name: "打开" })).toBeInTheDocument();

    expect(

      screen.getByRole("menuitem", { name: "下载文件夹" }),

    ).toBeInTheDocument();

    expect(
      screen.queryByRole("menuitem", { name: "下载为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(

      screen.getByRole("menuitem", { name: "下载到剪贴板" }),

    ).toBeInTheDocument();

    expect(

      screen

        .getByRole("button", { name: "打开目录 var" })

        .closest("[aria-selected='true']"),

    ).toBeInTheDocument();



    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "文件 app.log" }),

      {

        clientX: 80,

        clientY: 160,

      },

    );



    expect(

      screen.getByRole("menu", { name: "SFTP app.log 右键菜单" }),

    ).toBeInTheDocument();

    expect(

      screen.getByRole("menuitem", { name: "打开编辑器" }),

    ).toBeInTheDocument();

    expect(screen.getByRole("menuitem", { name: "下载" })).not.toBeDisabled();

    expect(
      screen.queryByRole("menuitem", { name: "下载为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(

      screen.getByRole("menuitem", { name: "下载到剪贴板" }),

    ).not.toBeDisabled();

    expect(

      screen

        .getByRole("button", { name: "文件 app.log" })

        .closest("[aria-selected='true']"),

    ).toBeInTheDocument();

  });



  it("lets the SFTP context menu follow the document theme", async () => {
    document.documentElement.classList.add("dark");
    render(<SftpToolContent selectedMachine={sshMachine} />);


    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "打开目录 var" }),

      {

        clientX: 80,

        clientY: 120,

      },

    );


    const menu = screen.getByRole("menu", { name: "SFTP var 右键菜单" });
    expect(document.documentElement).toHaveClass("dark");
    expect(menu).not.toHaveClass("dark");
    document.documentElement.classList.remove("dark");
    expect(menu).not.toHaveClass("dark");
    expect(menu.parentElement).toBe(document.body);
  });


  it("opens a context menu from a right mouse down event", async () => {

    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "打开目录 var" }), {

      button: 2,

      buttons: 2,

      clientX: 1800,

      clientY: 120,

    });



    const menu = screen.getByRole("menu", { name: "SFTP var 右键菜单" });

    expect(menu).toBeInTheDocument();

    expect(menu.parentElement).toBe(document.body);

    expect(screen.getByRole("menuitem", { name: "打开" })).toBeInTheDocument();

  });



  it("opens a context menu from a right pointer down event", async () => {

    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("var"), {

      button: 2,

      buttons: 2,

      clientX: 1800,

      clientY: 120,

      pointerType: "mouse",

    });



    const menu = screen.getByRole("menu", { name: "SFTP var 右键菜单" });

    expect(menu).toBeInTheDocument();

    expect(menu.parentElement).toBe(document.body);

  });



  it("jumps to an edited remote path from the header input", async () => {

    const user = userEvent.setup();



    render(<SftpToolContent selectedMachine={sshMachine} />);



    await screen.findByText("var");

    const pathInput = screen.getByLabelText("当前远程路径");

    await user.clear(pathInput);

    await user.type(pathInput, "/var/log{Enter}");



    expect(await screen.findByText("app.log")).toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({

      hostId: "prod-api",

      path: "/var/log",

    });

  });



  it("allows downloading symlink entries from the context menu", async () => {
    const user = userEvent.setup();


    render(<SftpToolContent selectedMachine={sshMachine} />);



    await screen.findByText("var");

    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("current")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "链接 current" }),

      {

        clientX: 80,

        clientY: 160,

      },

    );



    expect(screen.getByRole("menuitem", { name: "下载" })).not.toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "打开编辑器" })).toBeDisabled();
  });

  it("shows direct Docker container transfer status at the bottom of the browser", async () => {
    const user = userEvent.setup();
    let resolveDownload: ((value: boolean) => void) | undefined;
    containerFilesApiMocks.downloadDockerContainerPath.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "文件 package.json" }), {
      clientX: 80,
      clientY: 160,
    });
    await user.click(screen.getByRole("menuitem", { name: "下载" }));

    expect(containerFilesApiMocks.downloadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/app/package.json",
      runtime: "docker",
    });
    const progress = await screen.findByRole("progressbar", {
      name: "传输进度 package.json",
    });
    const transferStatusBar = screen.getByRole("status", {
      name: "SFTP 传输状态",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "8");
    expect(transferStatusBar).toHaveTextContent("SFTP 传输队列");
    expect(transferStatusBar).toHaveTextContent("下载中");
    expect(transferStatusBar).toHaveTextContent("package.json");
    expect(screen.queryByTestId("sftp-operation-progress")).not.toBeInTheDocument();

    await act(async () => {
      resolveDownload?.(true);
    });

    expect(await screen.findByText("完成")).toBeInTheDocument();
    expect(transferStatusBar).toHaveTextContent("100%");
    expect(screen.queryByTestId("sftp-operation-status")).not.toBeInTheDocument();
    const dropZone = screen.getByTestId("sftp-drop-zone");

    expect(
      dropZone.compareDocumentPosition(transferStatusBar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("follows the focused terminal directory when the switch is enabled", async () => {
    const user = userEvent.setup();



    render(

      <SftpToolContent

        followedRemotePath="/var/log"

        selectedMachine={sshMachine}

      />,

    );



    expect(await screen.findByText("var")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "跟随终端目录" }));



    expect(await screen.findByText("app.log")).toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({

      hostId: "prod-api",

      path: "/var/log",

    });

  });



  it("allows manual browsing while cwd sync waits for a new terminal path", async () => {

    const user = userEvent.setup();

    const { rerender } = render(

      <SftpToolContent

        followedRemotePath="/var/log"

        selectedMachine={sshMachine}

      />,

    );



    expect(await screen.findByText("var")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "跟随终端目录" }));

    expect(await screen.findByText("app.log")).toBeInTheDocument();



    const pathInput = screen.getByLabelText("当前远程路径");

    await user.clear(pathInput);

    await user.type(pathInput, "/{Enter}");



    expect(await screen.findByText("var")).toBeInTheDocument();

    expect(screen.queryByText("app.log")).not.toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({

      hostId: "prod-api",

      path: "/",

    });



    rerender(

      <SftpToolContent

        followedRemotePath="/srv/app"

        selectedMachine={sshMachine}

      />,

    );



    expect(await screen.findByText("release.sh")).toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({

      hostId: "prod-api",

      path: "/srv/app",

    });

  });



  it("sets up remote shell cwd tracking from the SFTP follow controls", async () => {
    const user = userEvent.setup();



    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    expect(screen.queryByText("自动设置")).not.toBeInTheDocument();

    await user.click(

      screen.getByRole("button", { name: "自动设置 SFTP 目录跟随" }),

    );



    await waitFor(() => {

      expect(sshCommandApiMocks.executeSshCommand).toHaveBeenCalledWith(

        expect.objectContaining({

          hostId: "prod-api",

          maxOutputBytes: 4096,

          timeoutSeconds: 15,

        }),

      );

    });

    expect(

      sshCommandApiMocks.executeSshCommand.mock.calls[0][0].command,

    ).toContain("1337;CurrentDir");

    expect(

      sshCommandApiMocks.executeSshCommand.mock.calls[0][0].command,

    ).toContain("add-zsh-hook precmd __kerminal_cwd");

    expect(await screen.findByText(/目录跟随已配置/)).toBeInTheDocument();
  });



  it("shows an error when remote cwd tracking setup fails", async () => {

    const user = userEvent.setup();

    sshCommandApiMocks.executeSshCommand.mockResolvedValueOnce({

      durationMs: 18,

      exitCode: 1,

      host: "prod.internal",

      hostId: "prod-api",

      hostName: "prod api",

      maxOutputBytes: 4096,

      port: 22,

      stderr: "permission denied token=cwd-ui-secret",
      stderrBytes: 37,
      stderrTruncated: false,

      stdout: "",

      stdoutBytes: 0,

      stdoutTruncated: false,

      success: false,

      username: "deploy",

    });



    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    await user.click(

      screen.getByRole("button", { name: "自动设置 SFTP 目录跟随" }),

    );



    expect(await screen.findByText("无法启用目录跟随")).toBeInTheDocument();
    expect(
      screen.getByText("检查远端文件权限或重新连接后重试。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cwd-ui-secret/)).not.toBeInTheDocument();

    await user.click(screen.getByText("技术详情"));

    expect(screen.getByText(/token="\[已隐藏\]"/)).toBeVisible();
    expect(screen.queryByText(/cwd-ui-secret/)).not.toBeInTheDocument();
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
