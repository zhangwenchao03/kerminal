import type { DragDropEvent } from "@tauri-apps/api/webview";
import type {
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { SftpEntry, SftpTransferKind } from "../../../lib/sftpApi";
import type { ContainerRuntime, RemoteTargetRef } from "../../../lib/targetModel";
import type { RemoteWorkspaceOpenCommand } from "../RemoteWorkspaceEditor";

export type SftpStatus = {
  kind: "info" | "success" | "error";
  message: string;
};

export const TRANSIENT_ERROR_STATUS_MS = 4_000;
export const SFTP_TRANSFER_UPDATED_EVENT = "sftp-transfer-updated";

export type SftpDialogAction =
  | {
      kind: "mkdir";
      path: string;
    }
  | {
      entry: SftpEntry;
      kind: "rename";
      toPath: string;
    }
  | {
      entry: SftpEntry;
      kind: "chmod";
      mode: string;
    }
  | {
      entry: SftpEntry;
      kind: "delete";
    };

export type SftpContextMenuState = {
  entry: SftpEntry | null;
  x: number;
  y: number;
};

export type SftpMenuAction =
  | "open"
  | "workspace"
  | "preview"
  | "download"
  | "downloadArchive"
  | "downloadClipboard"
  | "copyItem"
  | "pasteClipboard"
  | "copyPath"
  | "rename"
  | "chmod"
  | "delete"
  | "uploadFile"
  | "uploadDirectory"
  | "uploadFileArchive"
  | "uploadDirectoryArchive"
  | "uploadFileInto"
  | "uploadDirectoryInto"
  | "newDirectory"
  | "refresh"
  | "toggleHidden";

export type SftpContextMenuEvent =
  | MouseEvent<HTMLElement>
  | ReactPointerEvent<HTMLElement>;
export type SftpSelectionEvent = Pick<
  MouseEvent<HTMLElement>,
  "ctrlKey" | "metaKey" | "shiftKey"
>;
export type SftpDragDropPayload = DragDropEvent;

export type SftpClipboardEntry = {
  kind: SftpTransferKind;
  name: string;
  path: string;
};

export type SftpClipboard = {
  copiedAt: number;
  sourceHostId: string;
  sourceHostLabel: string;
  entries: SftpClipboardEntry[];
};

export type SftpWorkspaceDialog = {
  openCommand: RemoteWorkspaceOpenCommand | null;
  rootPath: string;
};

export type RemoteDirectoryListing = {
  entries: SftpEntry[];
  hostId: string;
  parentPath?: string;
  path: string;
};

export type SftpTransferTarget = {
  hostId: string;
  hostLabel: string;
  remotePath: string;
  side: "left" | "right";
};

export type DockerContainerTargetRef = Extract<
  RemoteTargetRef,
  { kind: "dockerContainer" }
>;

export type SftpFileTarget =
  | {
      kind: "ssh";
      hostId: string;
      initialPath: string;
      protocol: "sftp://";
      summary: string;
    }
  | {
      containerId: string;
      containerName?: string;
      hostId: string;
      initialPath: string;
      kind: "dockerContainer";
      protocol: "container://";
      runtime: ContainerRuntime;
      summary: string;
    };
