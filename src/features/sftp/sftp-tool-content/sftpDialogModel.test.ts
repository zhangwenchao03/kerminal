/**
 * SFTP dialog model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../lib/sftpApi";
import {
  buildSftpDialogActionPlan,
  dialogActionConfirmLabel,
  dialogActionDescription,
  dialogActionTitle,
  getDialogActionBlocker,
} from "./sftpDialogModel";
import type { SftpFileTarget } from "./types";

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
      operation: {
        kind: "mkdir",
        request: { hostId: "ssh-host", path: "/srv/logs" },
        targetKind: "ssh",
      },
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
      action: { entry: source, kind: "rename", toPath: "config.old.json" },
      currentPath: "/app",
      fileTarget: containerTarget,
    });

    expect(plan).toEqual({
      operation: {
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
      reloadPath: "/app",
      successStatus: {
        kind: "success",
        message: "已重命名：/app/config.json -> /app/config.old.json",
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

    expect(plan.operation).toEqual({
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
      action: { entry: target, kind: "delete" },
      currentPath: "/app",
      fileTarget: containerTarget,
    });

    expect(plan.operation).toEqual({
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
      action: { entry: target, kind: "delete" },
      currentPath: "/app",
      fileTarget: containerTarget,
    });

    expect(plan.operation).toEqual({
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

  it("normalizes absolute rename targets without joining the current path", () => {
    const source = entry({ path: "/srv/app.log" });
    const plan = buildSftpDialogActionPlan({
      action: { entry: source, kind: "rename", toPath: "//tmp//app.log" },
      currentPath: "/srv",
      fileTarget: sshTarget,
    });

    expect(plan.operation).toEqual({
      kind: "rename",
      request: {
        fromPath: "/srv/app.log",
        hostId: "ssh-host",
        toPath: "/tmp/app.log",
      },
      targetKind: "ssh",
    });
  });

  it("keeps dialog labels and descriptions stable", () => {
    const target = entry();
    expect(dialogActionTitle({ kind: "mkdir", path: "/srv/new" })).toBe(
      "新建目录",
    );
    expect(dialogActionConfirmLabel({ entry: target, kind: "delete" })).toBe(
      "确认删除",
    );
    expect(
      dialogActionDescription({ entry: target, kind: "rename", toPath: "" }, "/srv"),
    ).toBe("/srv/app.log");
  });

  it("blocks empty, root, duplicate, and invalid chmod actions", () => {
    const target = entry();

    expect(getDialogActionBlocker({ kind: "mkdir", path: " " }, "/srv")).toBe(
      "请填写新目录路径。",
    );
    expect(
      getDialogActionBlocker({ entry: target, kind: "rename", toPath: target.path }, "/srv"),
    ).toBe("目标路径不能和原路径相同。");
    expect(
      getDialogActionBlocker(
        { entry: { ...target, path: "/" }, kind: "delete" },
        "/srv",
      ),
    ).toBe("删除路径需要包含名称，不能只写根目录。");
    expect(
      getDialogActionBlocker({ entry: target, kind: "chmod", mode: "88" }, "/srv"),
    ).toBe("权限模式需要是 3 或 4 位八进制数字，例如 644 或 0755。");
    expect(
      getDialogActionBlocker({ entry: target, kind: "chmod", mode: "0755" }, "/srv"),
    ).toBeNull();
  });
});
