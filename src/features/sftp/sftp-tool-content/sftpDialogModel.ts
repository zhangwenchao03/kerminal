import type { SftpDialogAction } from "./types";
import { resolveRemoteInputPath } from "./sftpPathModel";

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
  return "删除";
}

export function dialogActionDescription(
  action: SftpDialogAction,
  currentPath: string,
) {
  if (action.kind === "mkdir") {
    return currentPath;
  }
  if (action.kind === "delete") {
    return "此操作会直接修改远程文件系统。";
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
  return "确认删除";
}

export function getDialogActionBlocker(action: SftpDialogAction, currentPath: string) {
  if (action.kind === "mkdir") {
    return getNonRootRemotePathBlocker(
      resolveRemoteInputPath(currentPath, action.path),
      "新目录路径",
    );
  }

  if (action.kind === "rename") {
    const toPath = resolveRemoteInputPath(currentPath, action.toPath);
    return (
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

  return getNonRootRemotePathBlocker(action.entry.path, "删除路径");
}

export function getNonRootRemotePathBlocker(path: string, label: string) {
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

export function getChmodModeBlocker(mode: string) {
  const trimmed = mode.trim();
  if (!trimmed) {
    return "请填写权限模式。";
  }
  if (!/^[0-7]{3,4}$/.test(trimmed)) {
    return "权限模式需要是 3 或 4 位八进制数字，例如 644 或 0755。";
  }
  return null;
}
