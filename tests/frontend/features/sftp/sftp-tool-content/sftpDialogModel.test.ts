/**
 * SFTP dialog model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import {
  buildSftpDialogActionPlan,
  dedupeDeleteEntries,
  dialogActionConfirmLabel,
  dialogActionDescription,
  dialogActionTitle,
  getDialogActionBlocker,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpDialogModel";
import type { SftpFileTarget } from "../../../../../src/features/sftp/sftp-tool-content/types";

const sshTarget: SftpFileTarget = {
  hostId: "ssh-host",
  initialPath: "/srv",
  kind: "ssh",
  protocol: "sftp://",
  summary: "prod",
};

const containerTarget: SftpFileTarget = {
  containerId: "container-1",
  containerName: "api",
  hostId: "docker-host",
  initialPath: "/app",
  kind: "dockerContainer",
  protocol: "container://",
  runtime: "docker",
  summary: "api container",
};

function entry(overrides: Partial<SftpEntry> = {}): SftpEntry {
  const name = overrides.name ?? "app.log";
  return {
    kind: "file",
    name,
    path: `/srv/${name}`,
    permissions: "-rw-r--r--",
    raw: name,
    ...overrides,
  };
}

describe("sftpDialogModel", () => {
  it("builds an SSH mkdir command plan with resolved remote path", () => {
    const plan = buildSftpDialogActionPlan({
      action: { kind: "mkdir", path: "logs" },
      currentPath: "/srv",
      fileTarget: sshTarget,
    });

    expect(plan).toEqual({
      operations: [
        {
          kind: "mkdir",
          request: { hostId: "ssh-host", path: "/srv/logs" },
          targetKind: "ssh",
        },
      ],
      reloadPath: "/srv",
      successStatus: { kind: "success", message: "目录已创建：/srv/logs" },
    });
  });

  it("builds a Docker rename command plan without losing container context", () => {
    const source = entry({
      name: "config.json",
      path: "/app/config.json",
    });
    const plan = buildSftpDialogActionPlan({
      action: { entry: source, kind: "rename", newName: "config.old.json" },
      currentPath: "/app",
      fileTarget: containerTarget,
    });

    expect(plan).toEqual({
      operations: [
        {
          kind: "rename",
          request: {
            containerId: "container-1",
            fromPath: "/app/config.json",
            hostId: "docker-host",
            runtime: "docker",
            toPath: "/app/config.old.json",
          },
          targetKind: "dockerContainer",
        },
      ],
      reloadPath: "/app",
      successStatus: {
        kind: "success",
        message: "已重命名：config.json -> config.old.json",
      },
    });
  });

  it("trims chmod mode before building the SSH request", () => {
    const target = entry({ path: "/srv/run.sh", permissions: "-rwxr-xr-x" });
    const plan = buildSftpDialogActionPlan({
      action: { entry: target, kind: "chmod", mode: " 0755 " },
      currentPath: "/srv",
      fileTarget: sshTarget,
    });

    expect(plan.operations[0]).toEqual({
      kind: "chmod",
      request: { hostId: "ssh-host", mode: "0755", path: "/srv/run.sh" },
      targetKind: "ssh",
    });
    expect(plan.successStatus).toEqual({
      kind: "success",
      message: "权限已修改：/srv/run.sh",
    });
  });

  it("marks Docker directory delete requests as recursive directory operations", () => {
    const target = entry({
      kind: "directory",
      name: "logs",
      path: "/app/logs",
    });
    const plan = buildSftpDialogActionPlan({
      action: { entries: [target], kind: "delete" },
      currentPath: "/app",
      fileTarget: containerTarget,
    });

    expect(plan.operations[0]).toEqual({
      kind: "delete",
      request: {
        containerId: "container-1",
        directory: true,
        hostId: "docker-host",
        path: "/app/logs",
        runtime: "docker",
      },
      targetKind: "dockerContainer",
    });
    expect(plan.successStatus).toEqual({
      kind: "success",
      message: "已删除：/app/logs",
    });
  });

  it("marks Docker file delete requests as non-directory operations", () => {
    const target = entry({
      kind: "file",
      name: "package.json",
      path: "/app/package.json",
    });
    const plan = buildSftpDialogActionPlan({
      action: { entries: [target], kind: "delete" },
      currentPath: "/app",
      fileTarget: containerTarget,
    });

    expect(plan.operations[0]).toEqual({
      kind: "delete",
      request: {
        containerId: "container-1",
        directory: false,
        hostId: "docker-host",
        path: "/app/package.json",
        runtime: "docker",
      },
      targetKind: "dockerContainer",
    });
  });

  it("computes rename targets from the source parent and the new name", () => {
    const source = entry({ path: "/srv/app.log" });
    const plan = buildSftpDialogActionPlan({
      action: { entry: source, kind: "rename", newName: "app.old.log" },
      currentPath: "/srv",
      fileTarget: sshTarget,
    });

    expect(plan.operations[0]).toEqual({
      kind: "rename",
      request: {
        fromPath: "/srv/app.log",
        hostId: "ssh-host",
        toPath: "/srv/app.old.log",
      },
      targetKind: "ssh",
    });
  });

  it("deduplicates batch delete entries and removes children covered by directories", () => {
    const directory = entry({
      kind: "directory",
      name: "logs",
      path: "/srv/logs",
    });
    const child = entry({ name: "app.log", path: "/srv/logs/app.log" });
    const sibling = entry({ name: "config.json", path: "/srv/config.json" });

    const deduped = dedupeDeleteEntries([child, directory, child, sibling]);

    expect(deduped.map((item) => item.path)).toEqual([
      "/srv/logs",
      "/srv/config.json",
    ]);
  });

  it("keeps dialog labels and descriptions stable", () => {
    const target = entry();
    expect(dialogActionTitle({ kind: "mkdir", path: "/srv/new" })).toBe(
      "新建目录",
    );
    expect(dialogActionConfirmLabel({ entries: [target], kind: "delete" })).toBe(
      "确认删除",
    );
    expect(
      dialogActionConfirmLabel({ entries: [target, entry({ path: "/srv/b.log" })], kind: "delete" }),
    ).toBe("确认删除 2 项");
    expect(
      dialogActionDescription({ entry: target, kind: "rename", newName: "" }, "/srv"),
    ).toBe("/srv/app.log");
  });

  it("blocks empty, root, duplicate, and invalid chmod actions", () => {
    const target = entry();

    expect(getDialogActionBlocker({ kind: "mkdir", path: " " }, "/srv")).toBe(
      "请填写新目录路径。",
    );
    expect(
      getDialogActionBlocker({ entry: target, kind: "rename", newName: target.name }, "/srv"),
    ).toBe("目标路径不能和原路径相同。");
    expect(
      getDialogActionBlocker({ entry: target, kind: "rename", newName: "a/b" }, "/srv"),
    ).toBe("新名称不能包含路径分隔符。");
    expect(
      getDialogActionBlocker(
        { entries: [{ ...target, path: "/" }], kind: "delete" },
        "/srv",
      ),
    ).toBe("删除路径需要包含名称，不能只写根目录。");
    expect(getDialogActionBlocker({ entries: [], kind: "delete" }, "/srv")).toBe(
      "请选择删除项目。",
    );
    expect(
      getDialogActionBlocker({ entry: target, kind: "chmod", mode: "88" }, "/srv"),
    ).toBe("权限模式需要是 3 或 4 位八进制数字，例如 644 或 0755。");
    expect(
      getDialogActionBlocker({ entry: target, kind: "chmod", mode: "0755" }, "/srv"),
    ).toBeNull();
  });
});
