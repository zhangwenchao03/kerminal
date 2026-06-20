import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("remoteHostApi", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists the remote host tree through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        createdAt: "now",
        hosts: [],
        id: "group-1",
        name: "虚拟机",
        sortOrder: 10,
        updatedAt: "now",
      },
    ]);
    const { listRemoteHostTree } = await import("./remoteHostApi");

    const tree = await listRemoteHostTree();

    expect(tree[0].name).toBe("虚拟机");
    expect(invokeMock).toHaveBeenCalledWith("remote_host_tree");
  });

  it("normalizes create host requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      authType: "agent",
      createdAt: "now",
      groupId: "group-1",
      host: "dev.internal",
      id: "host-1",
      name: "dev",
      port: 22,
      production: false,
      sortOrder: 10,
      tags: [],
      updatedAt: "now",
      username: "deploy",
    });
    const { createDefaultSshOptions, createRemoteHost } = await import(
      "./remoteHostApi"
    );

    await createRemoteHost({
      groupId: "group-1",
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    expect(invokeMock).toHaveBeenCalledWith("remote_host_create", {
      request: {
        authType: "agent",
        credentialRef: undefined,
        credentialSecret: undefined,
        groupId: "group-1",
        host: "dev.internal",
        name: "dev",
        port: 22,
        production: false,
        sshOptions: createDefaultSshOptions(),
        tags: [],
        username: "deploy",
      },
    });
  });

  it("normalizes ungrouped create host requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      authType: "agent",
      createdAt: "now",
      groupId: undefined,
      host: "dev.internal",
      id: "host-1",
      name: "dev",
      port: 22,
      production: false,
      sortOrder: 10,
      tags: [],
      updatedAt: "now",
      username: "deploy",
    });
    const { createDefaultSshOptions, createRemoteHost } = await import(
      "./remoteHostApi"
    );

    await createRemoteHost({
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    expect(invokeMock).toHaveBeenCalledWith("remote_host_create", {
      request: {
        authType: "agent",
        credentialRef: undefined,
        credentialSecret: undefined,
        groupId: undefined,
        host: "dev.internal",
        name: "dev",
        port: 22,
        production: false,
        sshOptions: createDefaultSshOptions(),
        tags: [],
        username: "deploy",
      },
    });
  });

  it("starts with an empty browser remote host tree outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listRemoteHostTree } = await import("./remoteHostApi");

    await expect(listRemoteHostTree()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("creates browser preview hosts in the default group outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createRemoteHost, listRemoteHostTree } = await import(
      "./remoteHostApi"
    );

    const host = await createRemoteHost({
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    const tree = await listRemoteHostTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: "__ungrouped__",
      name: "默认分组",
    });
    expect(tree[0].hosts[0]).toMatchObject({
      groupId: undefined,
      id: host.id,
      name: "dev",
    });
  });

  it("moves browser preview hosts to ungrouped when deleting a group", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      createRemoteHost,
      createRemoteHostGroup,
      deleteRemoteHostGroup,
      listRemoteHostTree,
    } = await import("./remoteHostApi");

    const group = await createRemoteHostGroup({ name: "开发主机" });
    const host = await createRemoteHost({
      groupId: group.id,
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    await expect(deleteRemoteHostGroup(group.id)).resolves.toBe(true);

    const tree = await listRemoteHostTree();
    expect(tree.map((item) => item.id)).toEqual(["__ungrouped__"]);
    expect(tree[0].hosts[0]).toMatchObject({
      groupId: undefined,
      id: host.id,
      name: "dev",
    });
  });

  it("returns browser preview groups and hosts sorted by sort order", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      createRemoteHost,
      createRemoteHostGroup,
      listRemoteHostTree,
      updateRemoteHost,
      updateRemoteHostGroup,
    } = await import("./remoteHostApi");

    const firstGroup = await createRemoteHostGroup({ name: "First" });
    const pinnedGroup = await createRemoteHostGroup({ name: "Pinned" });
    const firstHost = await createRemoteHost({
      groupId: firstGroup.id,
      host: "first.internal",
      name: "first",
      username: "deploy",
    });
    const pinnedHost = await createRemoteHost({
      groupId: firstGroup.id,
      host: "pinned.internal",
      name: "pinned",
      username: "deploy",
    });

    await updateRemoteHostGroup({
      id: pinnedGroup.id,
      name: pinnedGroup.name,
      sortOrder: -10,
    });
    await updateRemoteHost({
      authType: "agent",
      groupId: firstGroup.id,
      host: pinnedHost.host,
      id: pinnedHost.id,
      name: pinnedHost.name,
      production: false,
      sortOrder: -10,
      tags: [],
      username: pinnedHost.username,
    });

    const tree = await listRemoteHostTree();
    expect(tree.map((group) => group.id)).toEqual([
      pinnedGroup.id,
      firstGroup.id,
    ]);
    expect(tree[1].hosts.map((host) => host.id)).toEqual([
      pinnedHost.id,
      firstHost.id,
    ]);
  });

  it("normalizes credential secrets without storing them in browser host state", async () => {
    isTauriMock.mockReturnValue(false);
    const { createRemoteHost, listRemoteHostTree } = await import(
      "./remoteHostApi"
    );

    await createRemoteHost({
      authType: "password",
      credentialSecret: "s3cr3t",
      host: "secret.internal",
      name: "secret",
      username: "deploy",
    });

    const tree = await listRemoteHostTree();
    expect(tree[0].hosts[0]).toMatchObject({
      authType: "password",
      credentialRef: undefined,
      host: "secret.internal",
      name: "secret",
    });
    expect(tree[0].hosts[0]).not.toHaveProperty("credentialSecret");
  });
});
