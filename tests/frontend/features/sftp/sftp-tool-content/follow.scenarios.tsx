// @author kongweiguang

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  sftpApiMocks,
  sshCommandApiMocks,
  sshMachine,
} from "../../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../../src/features/sftp/SftpToolContent";


describe("SftpToolContent terminal directory follow behavior", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("follows the focused terminal directory when the control is enabled", async () => {
    const user = userEvent.setup();



    render(

      <SftpToolContent

        followedRemotePath="/var/log"

        selectedMachine={sshMachine}

      />,

    );



    expect(await screen.findByText("var")).toBeInTheDocument();

    const followButton = screen.getByRole("button", { name: "跟随终端目录" });
    await user.click(followButton);
    expect(followButton).toHaveAttribute("aria-pressed", "true");



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

    const followButton = screen.getByRole("button", { name: "跟随终端目录" });
    await user.click(followButton);
    expect(followButton).toHaveAttribute("aria-pressed", "true");

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


});
