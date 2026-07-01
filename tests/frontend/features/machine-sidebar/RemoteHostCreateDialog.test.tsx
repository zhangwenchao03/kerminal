import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSshOptions,
  revealRemoteHostCredential,
  type RemoteHost,
} from "../../../../src/lib/remoteHostApi";
import { testRemoteConnection } from "../../../../src/lib/connectionApi";
import { RemoteHostCreateDialog } from "../../../../src/features/machine-sidebar/RemoteHostCreateDialog";
import {
  chooseSelectOption,
  createdHost,
  groups,
  groupsWithSsh,
} from "../../support/machine-sidebar/RemoteHostCreateDialog.testSupport";

const fileDialogApiMock = vi.hoisted(() => ({
  selectLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
}));

vi.mock("../../../../src/lib/connectionApi", () => ({
  testRemoteConnection: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
  selectLocalFile: fileDialogApiMock.selectLocalFile,
}));

vi.mock("../../../../src/lib/remoteHostApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/remoteHostApi")>();
  return {
    ...actual,
    revealRemoteHostCredential: vi.fn(),
  };
});

describe("RemoteHostCreateDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fileDialogApiMock.selectLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalFile.mockReset();
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue(null);
    fileDialogApiMock.selectLocalFile.mockResolvedValue(null);
    vi.mocked(testRemoteConnection).mockReset();
    vi.mocked(revealRemoteHostCredential).mockReset();
    vi.mocked(revealRemoteHostCredential).mockResolvedValue({
      authType: "password",
      hostId: "host-1",
      message: "没有可回显的保存凭据。",
      status: "missing",
    });
    vi.mocked(testRemoteConnection).mockResolvedValue({
      connected: true,
      latencyMs: 12,
      message: "SSH 连接测试通过：root@127.0.0.1:22（12 ms）",
      mode: "ssh",
    });
  });

  it("creates an SSH host from the form", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        onCreated={onCreated}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "ubuntu-dev");
    await user.type(screen.getByLabelText("主机"), "172.16.41.60");
    await user.type(screen.getByLabelText("用户名"), "ubuntu");
    await user.clear(screen.getByLabelText("标签"));
    await user.type(screen.getByLabelText("标签"), "ssh, ubuntu");
    await chooseSelectOption(user, "认证方式", "密钥");
    fireEvent.change(screen.getByLabelText("私钥路径"), {
      target: { value: "/home/ubuntu/.ssh/id_ed25519" },
    });
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "key",
      credentialRef: "/home/ubuntu/.ssh/id_ed25519",
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "172.16.41.60",
      name: "ubuntu-dev",
      port: 22,
      production: false,
      sshOptions: createDefaultSshOptions(),
      tags: ["ssh", "ubuntu"],
      username: "ubuntu",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdHost));
  });

  it("fills the SSH private key path from the local file picker", async () => {
    const user = userEvent.setup();
    fileDialogApiMock.selectLocalFile.mockResolvedValueOnce(
      "C:\\Users\\dev\\.ssh\\id_ed25519",
    );

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    await chooseSelectOption(user, "认证方式", "密钥");
    fireEvent.change(screen.getByLabelText("私钥内容"), {
      target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n" },
    });

    await user.click(
      screen.getByRole("button", { name: "Choose private key file" }),
    );

    await waitFor(() => {
      expect(fileDialogApiMock.selectLocalFile).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("私钥路径")).toHaveValue(
        "C:\\Users\\dev\\.ssh\\id_ed25519",
      );
    });
    expect(screen.getByLabelText("私钥内容")).toHaveValue("");
  });

  it("shows SSH authentication methods as password, key, then SSH agent", async () => {
    const user = userEvent.setup();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    const authSelect = screen.getByRole("combobox", { name: "认证方式" });
    expect(authSelect).toHaveAttribute("data-value", "password");
    expect(authSelect).toHaveTextContent("密码");

    await user.click(authSelect);
    const options = screen.getAllByRole("option");

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(/^密码/);
    expect(options[1]).toHaveTextContent(/^密钥/);
    expect(options[2]).toHaveTextContent(/^SSH Agent/);
  });

  it("shows validation errors instead of saving incomplete hosts", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(screen.getByText("请输入主机名称。")).toBeInTheDocument();
    expect(onCreateHost).not.toHaveBeenCalled();
  });

  it("runs a backend connection test for the current SSH form", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "test-dev");
    await user.type(screen.getByLabelText("主机"), "127.0.0.1");
    await user.type(screen.getByLabelText("用户名"), "root");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(testRemoteConnection).toHaveBeenCalledWith({
        host: {
          authType: "agent",
          credentialRef: undefined,
          credentialSecret: undefined,
          groupId: undefined,
          host: "127.0.0.1",
          name: "test-dev",
          port: 22,
          production: false,
          sshOptions: createDefaultSshOptions(),
          tags: [],
          username: "root",
        },
        mode: "ssh",
      });
    });
    const successMessage = await screen.findByText(
      "SSH 连接测试通过：root@127.0.0.1:22（12 ms）",
    );
    expect(successMessage).toBeInTheDocument();
    expect(successMessage.closest("footer")).not.toBeNull();
    expect(onCreateHost).not.toHaveBeenCalled();
  });

  it("passes plaintext password secrets for SSH authentication", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue({
      ...createdHost,
      authType: "password",
      credentialSecret: "s3cr3t",
    } satisfies RemoteHost);

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "password-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.9");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "密码");
    expect(screen.queryByLabelText("SSH 密码凭据引用")).not.toBeInTheDocument();
    const passwordInput = screen.getByLabelText("SSH 密码");
    expect(passwordInput).toHaveAttribute("type", "text");
    await user.type(passwordInput, "s3cr3t");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "s3cr3t",
      groupId: undefined,
      host: "10.0.0.9",
      name: "password-dev",
      port: 22,
      production: false,
      sshOptions: createDefaultSshOptions(),
      tags: [],
      username: "deploy",
    });
  });

  it("creates an SSH host without a group when no real group is available", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue({
      ...createdHost,
      groupId: undefined,
    });

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={[]}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    expect(screen.getByRole("combobox", { name: "分组" })).toHaveAttribute(
      "data-value",
      "",
    );

    await user.type(screen.getByLabelText("名称"), "ungrouped-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.8");
    await user.type(screen.getByLabelText("用户名"), "ubuntu");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: undefined,
      host: "10.0.0.8",
      name: "ungrouped-dev",
      port: 22,
      production: false,
      sshOptions: createDefaultSshOptions(),
      tags: [],
      username: "ubuntu",
    });
  });

  it("saves production-grade SSH proxy and jump options", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);
    const defaultSshOptions = createDefaultSshOptions();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "prod-edge");
    await user.type(screen.getByLabelText("主机"), "10.1.2.3");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "SSH Agent");

    await user.click(screen.getByRole("button", { name: "代理" }));
    await chooseSelectOption(user, "代理协议", "SOCKS5");
    await user.type(screen.getByLabelText("代理主机"), "proxy.internal");
    fireEvent.change(screen.getByLabelText("代理端口"), {
      target: { value: "1080" },
    });
    await user.type(screen.getByLabelText("代理用户名"), "proxy-user");
    await user.click(screen.getByRole("button", { name: "跳板机" }));
    await user.type(screen.getByLabelText("跳板机名称"), "bastion");
    await user.type(screen.getByLabelText("跳板机主机"), "bastion.internal");
    await user.type(screen.getByLabelText("跳板机用户名"), "ops");
    expect(screen.queryByLabelText("跳板机凭据引用")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加跳板机" }));

    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "10.1.2.3",
      name: "prod-edge",
      port: 22,
      production: false,
      sshOptions: {
        ...defaultSshOptions,
        jumpHosts: [
          {
            authType: "agent",
            credentialRef: undefined,
            credentialSecret: undefined,
            host: "bastion.internal",
            name: "bastion",
            port: 22,
            username: "ops",
          },
        ],
        proxy: {
          credentialRef: undefined,
          host: "proxy.internal",
          port: 1080,
          protocol: "socks5",
          username: "proxy-user",
        },
        transfer: defaultSshOptions.transfer,
        tunnels: [],
      },
      tags: [],
      username: "deploy",
    });
  });

  it("fills a jump host from an existing SSH host", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="ssh"
        groups={groupsWithSsh}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "app-prod");
    await user.type(screen.getByLabelText("主机"), "10.2.3.4");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "SSH Agent");

    await user.click(screen.getByRole("button", { name: "跳板机" }));
    await chooseSelectOption(user, "已有跳板机主机", "db-prod");

    expect(screen.getByLabelText("跳板机名称")).toHaveValue("db-prod");
    expect(screen.getByLabelText("跳板机主机")).toHaveValue("10.0.0.8");
    expect(screen.getByLabelText("跳板机端口")).toHaveValue("22");
    expect(screen.getByLabelText("跳板机用户名")).toHaveValue("root");
    expect(
      screen.getByRole("combobox", { name: "跳板机认证方式" }),
    ).toHaveAttribute("data-value", "agent");

    await user.click(screen.getByRole("button", { name: "添加跳板机" }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "10.2.3.4",
      name: "app-prod",
      port: 22,
      production: false,
      sshOptions: {
        ...createDefaultSshOptions(),
        jumpHosts: [
          {
            authType: "agent",
            credentialRef: undefined,
            credentialSecret: undefined,
            host: "10.0.0.8",
            name: "db-prod",
            port: 22,
            username: "root",
          },
        ],
      },
      tags: [],
      username: "deploy",
    });
  });

  it("shows protocol-specific configuration sections", async () => {
    const user = userEvent.setup();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("button", { name: "SSH" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "认证方式" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "代理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳板机" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "认证" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "隧道" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "终端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "传输" }),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("root")).toBe(
      screen.getByLabelText("用户名"),
    );
    expect(
      screen.queryByText("SSH 密码和内联私钥会保存在主机记录里。"),
    ).not.toBeInTheDocument();
    const protocolBar = screen.getByRole("button", {
      name: "SSH",
    }).parentElement;
    expect(
      Array.from(protocolBar?.children ?? []).map((child) =>
        child.textContent?.trim(),
      ),
    ).toEqual(["SSH", "Local", "RDP", "Telnet", "Serial"]);
    expect(screen.getByLabelText("标签")).toHaveValue("");
    expect(
      screen.getByText("多个标签可用逗号或空格分隔。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("保存后显示在左侧。")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("生产保护")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telnet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Serial" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Local" }));

    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "测试连接" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "WSL" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Shell" }));
    expect(screen.getByRole("option", { name: "WSL" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "认证" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "RDP" }));

    expect(screen.getByRole("button", { name: "显示" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "网关" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "本地资源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "认证" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Telnet" }));
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "代理" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "终端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "测试连接" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Serial" }));
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "串口" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "终端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "测试连接" }),
    ).toBeInTheDocument();
  });

  it("creates a local terminal from local mode", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreateLocal = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="local"
        groups={groups}
        onClose={onClose}
        onCreateHost={vi.fn()}
        onCreateLocal={onCreateLocal}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "新建主机" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateLocal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creates a local terminal with startup overrides", async () => {
    const user = userEvent.setup();
    const onCreateLocal = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="local"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onCreateLocal={onCreateLocal}
        open
      />,
    );

    await user.type(screen.getByLabelText("会话名称"), "Dev shell");
    await chooseSelectOption(user, "Shell", "PowerShell 7");
    await user.type(
      screen.getByLabelText("工作目录"),
      "C:\\dev\\rust\\kerminal",
    );
    await user.type(screen.getByLabelText("启动参数"), "-NoLogo\n-NoExit");
    await user.click(screen.getByRole("button", { name: "终端" }));
    await user.type(
      screen.getByLabelText("环境变量"),
      "NODE_ENV=development\nKERM=test",
    );
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateLocal).toHaveBeenCalledWith({
      args: ["-NoLogo", "-NoExit"],
      cwd: "C:\\dev\\rust\\kerminal",
      env: {
        KERM: "test",
        NODE_ENV: "development",
      },
      groupId: "group-dev",
      shell: "pwsh.exe",
      title: "Dev shell",
    });
  });

  it("updates a local terminal from edit mode", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onUpdateLocal = vi.fn();

    render(
      <RemoteHostCreateDialog
        editingLocalMachine={{
          args: ["-NoLogo"],
          cwd: "C:\\dev",
          description: "pwsh.exe -NoLogo · C:\\dev",
          env: { TERM: "xterm-256color" },
          id: "profile:profile-pwsh",
          kind: "local",
          name: "Dev shell",
          profileId: "profile-pwsh",
          remoteGroupId: "group-dev",
          shell: "pwsh.exe",
          status: "offline",
          tags: ["local"],
        }}
        groups={groups}
        onClose={onClose}
        onCreateHost={vi.fn()}
        onUpdateLocal={onUpdateLocal}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "编辑连接配置" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("会话名称")).toHaveValue("Dev shell");

    fireEvent.change(screen.getByLabelText("会话名称"), {
      target: { value: "Renamed local" },
    });
    fireEvent.change(screen.getByLabelText("工作目录"), {
      target: { value: "C:\\work" },
    });
    await user.click(screen.getByRole("button", { name: "终端" }));
    fireEvent.change(screen.getByLabelText("环境变量"), {
      target: { value: "NODE_ENV=test" },
    });
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateLocal).toHaveBeenCalledWith("profile:profile-pwsh", {
      args: ["-NoLogo"],
      cwd: "C:\\work",
      env: { NODE_ENV: "test" },
      groupId: "group-dev",
      shell: "pwsh.exe",
      title: "Renamed local",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not expose Docker as a primary add-connection protocol", () => {
    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groupsWithSsh}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Docker" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("选择后加入侧栏。")).not.toBeInTheDocument();
  });

  it("prefills plaintext SSH password and inline private key when editing", () => {
    const passwordHost: RemoteHost = {
      ...createdHost,
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "visible-password",
    };
    const { unmount } = render(
      <RemoteHostCreateDialog
        editingHost={passwordHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={vi.fn()}
        open
      />,
    );

    expect(screen.getByLabelText("SSH 密码")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("SSH 密码")).toHaveValue("visible-password");

    unmount();

    render(
      <RemoteHostCreateDialog
        editingHost={{
          ...createdHost,
          authType: "key",
          credentialRef: undefined,
          credentialSecret: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
        }}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={vi.fn()}
        open
      />,
    );

    expect(screen.getByLabelText("私钥内容")).toHaveValue(
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
    );
  });

  it("reveals a saved vault SSH password when editing", async () => {
    vi.mocked(revealRemoteHostCredential).mockResolvedValueOnce({
      authType: "password",
      credentialSecret: "vault-visible-password",
      hostId: "host-1",
      status: "available",
    });
    const passwordHost: RemoteHost = {
      ...createdHost,
      authType: "password",
      credentialRef: undefined,
      credentialSecret: undefined,
      credentialStatus: "vault",
      secretRef: "credential:kerminal:ssh-host:host-1:target:password:v1",
    };

    render(
      <RemoteHostCreateDialog
        editingHost={passwordHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={vi.fn()}
        open
      />,
    );

    expect(revealRemoteHostCredential).toHaveBeenCalledWith("host-1");
    await waitFor(() =>
      expect(screen.getByLabelText("SSH 密码")).toHaveValue(
        "vault-visible-password",
      ),
    );
  });

  it("updates an existing SSH host from the same dialog", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      ...createdHost,
      production: true,
    };
    const updatedHost: RemoteHost = {
      ...editingHost,
      name: "ubuntu-prod",
      updatedAt: "later",
    };
    const onUpdateHost = vi.fn().mockResolvedValue(updatedHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onCreated={onCreated}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "编辑连接配置" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "ubuntu-prod");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateHost).toHaveBeenCalledWith({
      authType: "key",
      credentialRef: "/home/ubuntu/.ssh/id_ed25519",
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "172.16.41.60",
      id: "host-1",
      name: "ubuntu-prod",
      port: 22,
      production: true,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["ssh", "ubuntu"],
      username: "ubuntu",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(updatedHost));
  });

  it("keeps the edit draft and blocks saving after an external host change", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      ...createdHost,
      updatedAt: "1",
    };
    const onUpdateHost = vi.fn();
    const conflictMessage = "cfg: host changed externally; close + reopen";
    const { rerender } = render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groupsWithSsh}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "draft-name");

    rerender(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        externalConfigConflict={conflictMessage}
        groups={[
          groupsWithSsh[0],
          {
            ...groupsWithSsh[1],
            machines: groupsWithSsh[1].machines.map((machine) =>
              machine.id === editingHost.id
                ? { ...machine, name: "external-name", updatedAt: "2" }
                : machine,
            ),
          },
        ]}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    expect(screen.getByLabelText("名称")).toHaveValue("draft-name");
    expect(screen.getByRole("alert")).toHaveTextContent(conflictMessage);
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
    expect(onUpdateHost).not.toHaveBeenCalled();
  });

  it("saves an RDP connection to the host list with password metadata", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const savedRdpHost: RemoteHost = {
      authType: "password",
      createdAt: "now",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      production: false,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    };
    const onCreateHost = vi.fn().mockResolvedValue(savedRdpHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="rdp"
        groups={groups}
        onClose={onClose}
        onCreateHost={onCreateHost}
        onCreated={onCreated}
        open
      />,
    );

    expect(screen.getByRole("combobox", { name: "分组" })).toHaveAttribute(
      "data-value",
      "group-dev",
    );
    await user.type(screen.getByLabelText("名称"), "office-rdp");
    await user.type(screen.getByLabelText("主机"), "rdp.internal");
    await user.type(screen.getByLabelText("用户名"), "administrator");
    await user.type(screen.getByLabelText("密码"), "rdp-secret");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "rdp-secret",
      groupId: "group-dev",
      host: "rdp.internal",
      name: "office-rdp",
      port: 3389,
      production: false,
      tags: ["rdp"],
      username: "administrator",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(savedRdpHost));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reveals and updates saved RDP password when editing", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      authType: "password",
      createdAt: "now",
      credentialRef: undefined,
      secretRef: "credential:kerminal:rdp-host:rdp-1:target:password:v1",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      production: false,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    };
    const updatedHost: RemoteHost = {
      ...editingHost,
      updatedAt: "later",
    };
    const onUpdateHost = vi.fn().mockResolvedValue(updatedHost);
    const onCreated = vi.fn();
    vi.mocked(revealRemoteHostCredential).mockResolvedValueOnce({
      authType: "password",
      credentialSecret: "visible-rdp-secret",
      hostId: "rdp-1",
      status: "available",
    });

    render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onCreated={onCreated}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    const passwordInput = screen.getByLabelText("密码");
    expect(passwordInput).toHaveAttribute("type", "text");
    await waitFor(() => expect(passwordInput).toHaveValue("visible-rdp-secret"));

    await user.clear(passwordInput);
    await user.type(passwordInput, "next-rdp-secret");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "next-rdp-secret",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      production: false,
      sortOrder: 10,
      tags: ["rdp"],
      username: "administrator",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(updatedHost));
  });

  it("keeps existing RDP password auth when saving before reveal finishes", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      authType: "password",
      createdAt: "now",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      production: false,
      secretRef: "credential:kerminal:rdp-host:rdp-1:target:password:v1",
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    };
    const onUpdateHost = vi.fn().mockResolvedValue(editingHost);
    vi.mocked(revealRemoteHostCredential).mockImplementationOnce(
      () => new Promise(() => {}),
    );

    render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    expect(screen.getByLabelText("密码")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      production: false,
      sortOrder: 10,
      tags: ["rdp"],
      username: "administrator",
    });
  });

  it("creates a group from the RDP form and keeps the form values", async () => {
    const user = userEvent.setup();
    const createdGroup = {
      createdAt: "now",
      id: "group-rdp",
      name: "远程桌面",
      sortOrder: 20,
      updatedAt: "now",
    };
    const onCreateGroup = vi.fn().mockResolvedValue(createdGroup);
    let currentDefaultGroupId: string | undefined;
    let currentGroups = groups;
    let rerenderDialog = () => {};
    const onGroupCreated = vi.fn(async () => {
      currentDefaultGroupId = createdGroup.id;
      currentGroups = [
        ...groups,
        {
          id: createdGroup.id,
          machines: [],
          title: createdGroup.name,
        },
      ];
      rerenderDialog();
    });
    const onCreateHost = vi.fn().mockResolvedValue({
      authType: "password",
      createdAt: "now",
      groupId: "group-rdp",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      production: false,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    } satisfies RemoteHost);

    const renderDialog = () => (
      <RemoteHostCreateDialog
        defaultGroupId={currentDefaultGroupId}
        defaultMode="rdp"
        groups={currentGroups}
        onClose={vi.fn()}
        onCreateGroup={onCreateGroup}
        onCreateHost={onCreateHost}
        onGroupCreated={onGroupCreated}
        open
      />
    );
    const { rerender } = render(renderDialog());
    rerenderDialog = () => rerender(renderDialog());

    await user.type(screen.getByLabelText("名称"), "office-rdp");
    await user.click(screen.getByRole("button", { name: "新建分组" }));
    expect(
      screen.getByRole("dialog", { name: "新建分组" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("分组名称"), "远程桌面");
    await user.click(screen.getByRole("button", { name: "创建分组" }));

    await waitFor(() => {
      expect(onCreateGroup).toHaveBeenCalledWith({ name: "远程桌面" });
    });
    await waitFor(() => {
      expect(onGroupCreated).toHaveBeenCalledWith(createdGroup);
    });
    expect(screen.getByLabelText("名称")).toHaveValue("office-rdp");

    await user.type(screen.getByLabelText("主机"), "rdp.internal");
    await user.type(screen.getByLabelText("用户名"), "administrator");
    await user.type(screen.getByLabelText("密码"), "rdp-secret");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "rdp-secret",
      groupId: "group-rdp",
      host: "rdp.internal",
      name: "office-rdp",
      port: 3389,
      production: false,
      tags: ["rdp"],
      username: "administrator",
    });
  });

  it("validates RDP display options without opening the system client", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="rdp"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "office-windowed");
    await user.type(screen.getByLabelText("主机"), "rdp.internal");
    await user.type(screen.getByLabelText("用户名"), "administrator");
    await user.click(screen.getByRole("button", { name: "显示" }));
    await user.click(screen.getByLabelText("全屏"));
    await user.clear(screen.getByLabelText("RDP 宽度"));
    await user.type(screen.getByLabelText("RDP 宽度"), "320");
    await user.clear(screen.getByLabelText("RDP 高度"));
    await user.type(screen.getByLabelText("RDP 高度"), "720");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const validationMessage = screen.getByText(
      "RDP 窗口尺寸不能小于 640x480。",
    );
    expect(validationMessage).toBeInTheDocument();
    expect(validationMessage.closest("footer")).not.toBeNull();
    expect(testRemoteConnection).not.toHaveBeenCalled();
    expect(onCreateHost).not.toHaveBeenCalled();
  });
});
