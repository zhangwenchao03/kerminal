import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  localMachine,
  sftpApiMocks,
  sshMachine,
} from "../../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../../src/features/sftp/SftpToolContent";


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



});
