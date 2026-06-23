import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSshOptions,
  type RemoteHost,
} from "../../lib/remoteHostApi";
import { RemoteHostCreateDialog } from "./RemoteHostCreateDialog";
import {
  apiContainer,
  chooseSelectOption,
  createdHost,
  groups,
  groupsWithSsh,
} from "./RemoteHostCreateDialog.testSupport";

describe("RemoteHostCreateDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

    await user.click(screen.getByRole("button", { name: "跳板机" }));
    await chooseSelectOption(user, "已有跳板机主机", "db-prod");

    expect(screen.getByLabelText("跳板机名称")).toHaveValue("db-prod");
    expect(screen.getByLabelText("跳板机主机")).toHaveValue("10.0.0.8");
    expect(screen.getByLabelText("跳板机端口")).toHaveValue("22");
    expect(screen.getByLabelText("跳板机用户名")).toHaveValue("root");
    expect(screen.getByRole("combobox", { name: "跳板机认证方式" })).toHaveAttribute(
      "data-value",
      "agent",
    );

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
    expect(screen.queryByRole("button", { name: "认证" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "隧道" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "传输" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("root")).toBe(screen.getByLabelText("用户名"));
    expect(
      screen.queryByText("SSH 密码和内联私钥会保存在主机记录里。"),
    ).not.toBeInTheDocument();
    const protocolBar = screen.getByRole("button", { name: "SSH" }).parentElement;
    expect(
      Array.from(protocolBar?.children ?? []).map((child) =>
        child.textContent?.trim(),
      ),
    ).toEqual(["SSH", "Docker", "Local", "RDP", "Telnet", "Serial"]);
    expect(screen.getByLabelText("标签")).toHaveValue("");
    expect(
      screen.getByText(
        "多个标签可用逗号、空格或中文逗号分隔，例如：dev ubuntu，staging。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("生产保护")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telnet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Serial" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Local" }));

    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "网关" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "本地资源" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "认证" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Telnet" }));
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "代理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Serial" }));
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "串口" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
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

  it("keeps Docker host unselected until the user chooses a host", async () => {
    const onListDockerContainers = vi.fn().mockResolvedValue([apiContainer]);

    render(
      <RemoteHostCreateDialog
        defaultMode="docker"
        groups={groupsWithSsh}
        onAddDockerContainer={vi.fn()}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        open
      />,
    );

    expect(
      await screen.findByText("请选择主机后读取远端容器。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "主机" })).toHaveTextContent(
      "请选择主机",
    );
    expect(onListDockerContainers).not.toHaveBeenCalled();
  });

  it("adds a Docker container target from an existing SSH host", async () => {
    const user = userEvent.setup();
    const onAddDockerContainer = vi.fn();
    const onClose = vi.fn();
    const onListDockerContainers = vi.fn().mockResolvedValue([apiContainer]);

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="docker"
        groups={groupsWithSsh}
        onAddDockerContainer={onAddDockerContainer}
        onClose={onClose}
        onCreateHost={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        open
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "主机" }));
    await user.type(screen.getByLabelText("搜索主机"), "ubuntu");
    await user.click(screen.getByRole("option", { name: /ubuntu-dev/ }));

    expect(
      await screen.findByRole("button", { name: /api/ }),
    ).toBeInTheDocument();
    expect(onListDockerContainers).toHaveBeenCalledWith({
      hostId: "host-1",
      includeStopped: true,
      runtime: "docker",
    });

    await user.click(screen.getByRole("button", { name: "进入选项" }));
    await user.type(screen.getByLabelText("容器 Shell"), "exec bash -l");
    await user.type(screen.getByLabelText("容器用户"), "root");
    await user.type(screen.getByLabelText("容器工作目录"), "/workspace");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onAddDockerContainer).toHaveBeenCalledWith({
      container: apiContainer,
      groupId: "group-dev",
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("remembers the last selected Docker host for the next dialog opening", async () => {
    const user = userEvent.setup();
    const onListDockerContainers = vi.fn().mockResolvedValue([apiContainer]);

    const { unmount } = render(
      <RemoteHostCreateDialog
        defaultMode="docker"
        groups={groupsWithSsh}
        onAddDockerContainer={vi.fn()}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        open
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "主机" }));
    await user.type(screen.getByLabelText("搜索主机"), "ubuntu");
    await user.click(screen.getByRole("option", { name: /ubuntu-dev/ }));
    await waitFor(() => {
      expect(onListDockerContainers).toHaveBeenCalledWith({
        hostId: "host-1",
        includeStopped: true,
        runtime: "docker",
      });
    });

    unmount();
    onListDockerContainers.mockClear();

    render(
      <RemoteHostCreateDialog
        defaultMode="docker"
        groups={groupsWithSsh}
        onAddDockerContainer={vi.fn()}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onListDockerContainers={onListDockerContainers}
        open
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "主机" })).toHaveTextContent(
        "ubuntu-dev",
      );
    });
    expect(onListDockerContainers).toHaveBeenCalledWith({
      hostId: "host-1",
      includeStopped: true,
      runtime: "docker",
    });
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

    expect(screen.getByText("RDP 窗口尺寸不能小于 640x480。")).toBeInTheDocument();
    expect(onCreateHost).not.toHaveBeenCalled();
  });

});
