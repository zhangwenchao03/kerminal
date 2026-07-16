import type {
  DockerContainerChmodRequest,
  DockerContainerDeleteRequest,
  DockerContainerPathRequest,
  DockerContainerRenameRequest,
} from "../../../lib/containerFilesApi";
import type {
  SftpChmodRequest,
  SftpDeleteRequest,
  SftpPathRequest,
  SftpRenameRequest,
} from "../../../lib/sftpApi";
import type { SftpDialogAction, SftpFileTarget, SftpStatus } from "./types";
import {
  joinRemotePath,
  parentRemotePath,
  resolveRemoteInputPath,
} from "./sftpPathModel";

export type SftpDialogOperation =
  | {
      kind: "mkdir";
      request: SftpPathRequest;
      targetKind: "ssh";
    }
  | {
      kind: "mkdir";
      request: DockerContainerPathRequest;
      targetKind: "dockerContainer";
    }
  | {
      kind: "rename";
      request: SftpRenameRequest;
      targetKind: "ssh";
    }
  | {
      kind: "rename";
      request: DockerContainerRenameRequest;
      targetKind: "dockerContainer";
    }
  | {
      kind: "chmod";
      request: SftpChmodRequest;
      targetKind: "ssh";
    }
  | {
      kind: "chmod";
      request: DockerContainerChmodRequest;
      targetKind: "dockerContainer";
    }
  | {
      kind: "delete";
      request: SftpDeleteRequest;
      targetKind: "ssh";
    }
  | {
      kind: "delete";
      request: DockerContainerDeleteRequest;
      targetKind: "dockerContainer";
    };

export type SftpDialogActionPlan = {
  operations: SftpDialogOperation[];
  reloadPath: string;
  successStatus: SftpStatus;
};

export function dialogActionTitle(action: SftpDialogAction) {
  if (action.kind === "mkdir") {
    return "新建目录";
  }
  if (action.kind === "rename") {
    return "重命名";
  }
  if (action.kind === "chmod") {
    return "修改权限";
  }
  return action.entries.length > 1 ? `删除 ${action.entries.length} 项` : "删除";
}

export function dialogActionDescription(
  action: SftpDialogAction,
  currentPath: string,
) {
  if (action.kind === "mkdir") {
    return currentPath;
  }
  if (action.kind === "delete") {
    return action.entries.length > 1
      ? `此操作会直接修改远程文件系统：${action.entries.length} 项。`
      : "此操作会直接修改远程文件系统。";
  }
  return action.entry.path;
}

export function dialogActionConfirmLabel(action: SftpDialogAction) {
  if (action.kind === "mkdir") {
    return "创建";
  }
  if (action.kind === "rename") {
    return "重命名";
  }
  if (action.kind === "chmod") {
    return "保存权限";
  }
  return action.entries.length > 1
    ? `确认删除 ${action.entries.length} 项`
    : "确认删除";
}

export function getDialogActionBlocker(action: SftpDialogAction, currentPath: string) {
  if (action.kind === "mkdir") {
    return getNonRootRemotePathBlocker(
      resolveRemoteInputPath(currentPath, action.path),
      "新目录路径",
    );
  }

  if (action.kind === "rename") {
    const toPath = renameTargetPath(action.entry.path, action.newName);
    return (
      getRenameNameBlocker(action.newName) ??
      getNonRootRemotePathBlocker(toPath, "目标路径") ??
      (toPath === action.entry.path ? "目标路径不能和原路径相同。" : null)
    );
  }

  if (action.kind === "chmod") {
    return (
      getNonRootRemotePathBlocker(action.entry.path, "远程路径") ??
      getChmodModeBlocker(action.mode)
    );
  }

  if (action.entries.length === 0) {
    return "请选择删除项目。";
  }
  for (const entry of action.entries) {
    const blocker = getNonRootRemotePathBlocker(entry.path, "删除路径");
    if (blocker) {
      return blocker;
    }
  }
  return null;
}

function getNonRootRemotePathBlocker(path: string, label: string) {
  if (!path.trim()) {
    return `请填写${label}。`;
  }
  if (!path.startsWith("/")) {
    return `${label}需要使用绝对路径。`;
  }
  if (path === "/") {
    return `${label}需要包含名称，不能只写根目录。`;
  }
  return null;
}

function getChmodModeBlocker(mode: string) {
  const trimmed = mode.trim();
  if (!trimmed) {
    return "请填写权限模式。";
  }
  if (!/^[0-7]{3,4}$/.test(trimmed)) {
    return "权限模式需要是 3 或 4 位八进制数字，例如 644 或 0755。";
  }
  return null;
}

function getRenameNameBlocker(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "请填写新名称。";
  }
  if (trimmed === "." || trimmed === "..") {
    return "新名称不能是 . 或 ..。";
  }
  if (/[\\/]/.test(trimmed)) {
    return "新名称不能包含路径分隔符。";
  }
  return null;
}

export function buildSftpDialogActionPlan({
  action,
  currentPath,
  fileTarget,
}: {
  action: SftpDialogAction;
  currentPath: string;
  fileTarget: SftpFileTarget;
}): SftpDialogActionPlan {
  if (action.kind === "mkdir") {
    const path = resolveRemoteInputPath(currentPath, action.path);
    return {
      operations: [buildMkdirOperation(fileTarget, path)],
      reloadPath: currentPath,
      successStatus: { kind: "success", message: `目录已创建：${path}` },
    };
  }

  if (action.kind === "rename") {
    const toPath = renameTargetPath(action.entry.path, action.newName);
    return {
      operations: [buildRenameOperation(fileTarget, action.entry.path, toPath)],
      reloadPath: currentPath,
      successStatus: {
        kind: "success",
        message: `已重命名：${action.entry.name} -> ${action.newName.trim()}`,
      },
    };
  }

  if (action.kind === "chmod") {
    const mode = action.mode.trim();
    return {
      operations: [buildChmodOperation(fileTarget, action.entry.path, mode)],
      reloadPath: currentPath,
      successStatus: {
        kind: "success",
        message: `权限已修改：${action.entry.path}`,
      },
    };
  }

  const entries = dedupeDeleteEntries(action.entries);
  return {
    operations: entries.map((entry) =>
      buildDeleteOperation(fileTarget, entry.path, entry.kind === "directory"),
    ),
    reloadPath: currentPath,
    successStatus: {
      kind: "success",
      message:
        entries.length > 1
          ? `已删除 ${entries.length} 项`
          : `已删除：${entries[0]?.path ?? ""}`,
    },
  };
}

export function dedupeDeleteEntries(
  entries: Extract<SftpDialogAction, { kind: "delete" }>["entries"],
) {
  const result: typeof entries = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.path)) {
      continue;
    }
    const coveredByExistingDirectory = result.some(
      (existing) =>
        existing.kind === "directory" && isRemotePathDescendant(entry.path, existing.path),
    );
    if (coveredByExistingDirectory) {
      continue;
    }
    if (entry.kind === "directory") {
      for (let index = result.length - 1; index >= 0; index -= 1) {
        if (isRemotePathDescendant(result[index].path, entry.path)) {
          seen.delete(result[index].path);
          result.splice(index, 1);
        }
      }
    }
    seen.add(entry.path);
    result.push(entry);
  }
  return result;
}

function renameTargetPath(entryPath: string, newName: string) {
  return joinRemotePath(parentRemotePath(entryPath), newName.trim());
}

function isRemotePathDescendant(path: string, possibleParentPath: string) {
  if (possibleParentPath === "/") {
    return path !== "/" && path.startsWith("/");
  }
  return path !== possibleParentPath && path.startsWith(`${possibleParentPath}/`);
}

function buildMkdirOperation(
  fileTarget: SftpFileTarget,
  path: string,
): SftpDialogOperation {
  if (fileTarget.kind === "ssh") {
    return {
      kind: "mkdir",
      request: { hostId: fileTarget.hostId, path },
      targetKind: "ssh",
    };
  }
  return {
    kind: "mkdir",
    request: dockerPathRequest(fileTarget, path),
    targetKind: "dockerContainer",
  };
}

function buildRenameOperation(
  fileTarget: SftpFileTarget,
  fromPath: string,
  toPath: string,
): SftpDialogOperation {
  if (fileTarget.kind === "ssh") {
    return {
      kind: "rename",
      request: { fromPath, hostId: fileTarget.hostId, toPath },
      targetKind: "ssh",
    };
  }
  return {
    kind: "rename",
    request: dockerRenameRequest(fileTarget, fromPath, toPath),
    targetKind: "dockerContainer",
  };
}

function buildChmodOperation(
  fileTarget: SftpFileTarget,
  path: string,
  mode: string,
): SftpDialogOperation {
  if (fileTarget.kind === "ssh") {
    return {
      kind: "chmod",
      request: { hostId: fileTarget.hostId, mode, path },
      targetKind: "ssh",
    };
  }
  return {
    kind: "chmod",
    request: { ...dockerPathRequest(fileTarget, path), mode },
    targetKind: "dockerContainer",
  };
}

function buildDeleteOperation(
  fileTarget: SftpFileTarget,
  path: string,
  directory: boolean,
): SftpDialogOperation {
  if (fileTarget.kind === "ssh") {
    return {
      kind: "delete",
      request: { directory, hostId: fileTarget.hostId, path },
      targetKind: "ssh",
    };
  }
  return {
    kind: "delete",
    request: { ...dockerPathRequest(fileTarget, path), directory },
    targetKind: "dockerContainer",
  };
}

function dockerPathRequest(
  fileTarget: Extract<SftpFileTarget, { kind: "dockerContainer" }>,
  path: string,
): DockerContainerPathRequest {
  return {
    containerId: fileTarget.containerId,
    hostId: fileTarget.hostId,
    path,
    runtime: fileTarget.runtime,
  };
}

function dockerRenameRequest(
  fileTarget: Extract<SftpFileTarget, { kind: "dockerContainer" }>,
  fromPath: string,
  toPath: string,
): DockerContainerRenameRequest {
  return {
    containerId: fileTarget.containerId,
    fromPath,
    hostId: fileTarget.hostId,
    runtime: fileTarget.runtime,
    toPath,
  };
}
