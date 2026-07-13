import type { SftpEntry } from "../../../lib/sftpApi";
import { resolveWorkspaceFilePreviewPolicy } from "../workspaceFilePreviewPolicy";
import { normalizeRemotePath, parentRemotePath } from "./sftpPathModel";
import type { SftpStatus, SftpWorkspaceDialog } from "./types";

export type WorkspaceDialogDecision = { kind: "blocked" } | { kind: "close" };

/** 文件编辑器打开计划；`unsupported` 要求调用方在任何文本读取前停止。 */
export type OpenWorkspaceEditorDialogPlan =
  | {
      dialog: SftpWorkspaceDialog;
      kind: "open";
    }
  | {
      kind: "unsupported";
      status: SftpStatus;
    };

export function buildOpenWorkspaceDirectoryDialog(
  path: string,
): SftpWorkspaceDialog {
  return {
    openCommand: null,
    rootPath: normalizeRemotePath(path),
  };
}

/**
 * 构建普通文件的编辑器打开计划，并提前拦截已知非文本格式。
 * 未知格式仍返回打开计划，由后续受限内容探测完成最终判断。
 */
export function buildOpenWorkspaceEditorDialog({
  entry,
  nonce,
}: {
  entry: SftpEntry;
  nonce: number;
}): OpenWorkspaceEditorDialogPlan {
  if (entry.kind !== "file") {
    return {
      kind: "unsupported",
      status: {
        kind: "info",
        message: "只有普通文件支持打开到编辑器。",
      },
    };
  }

  const previewDecision = resolveWorkspaceFilePreviewPolicy(entry.name);
  if (previewDecision.kind === "unsupported") {
    return {
      kind: "unsupported",
      status: {
        kind: "info",
        message: previewDecision.message,
      },
    };
  }

  return {
    dialog: {
      openCommand: { nonce, path: entry.path },
      rootPath: parentRemotePath(entry.path),
    },
    kind: "open",
  };
}

export function resolveWorkspaceDialogCloseDecision({
  confirmed,
  dirty,
}: {
  confirmed: boolean;
  dirty: boolean;
}): WorkspaceDialogDecision {
  return dirty && !confirmed ? { kind: "blocked" } : { kind: "close" };
}
