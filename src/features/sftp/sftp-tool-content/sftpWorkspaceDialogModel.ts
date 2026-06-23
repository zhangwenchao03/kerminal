import type { SftpEntry } from "../../../lib/sftpApi";
import { normalizeRemotePath, parentRemotePath } from "./sftpPathModel";
import type { SftpStatus, SftpWorkspaceDialog } from "./types";

export type WorkspaceDialogDecision =
  | { kind: "blocked" }
  | { kind: "close" };

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
