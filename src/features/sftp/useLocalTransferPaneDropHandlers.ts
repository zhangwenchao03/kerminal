import type { Dispatch, DragEvent, SetStateAction } from "react";
import type { LocalDirectoryListing } from "../../lib/fileDialogApi";
import {
  SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
  parseSftpLocalFileDragPayload,
  resolveSftpLocalPaneDropTarget,
} from "./sftp-tool-content/sftpLocalUploadDropModel";
import {
  SFTP_REMOTE_DRAG_PAYLOAD_MIME,
  hasSftpRemoteDragPayloadType,
} from "./sftp-tool-content/sftpRemoteTransferModel";

interface LocalTransferPaneDropHandlersOptions {
  closeContextMenu: () => void;
  copyLocalEntries: (
    entries: Array<{ kind: "directory" | "file"; path: string }>,
    targetDirectoryPath?: string,
  ) => Promise<void>;
  downloadRemotePayload: (payloadText: string) => Promise<void>;
  listing: LocalDirectoryListing | null;
  reportError: (error: string) => void;
  setDropRejectedActive: Dispatch<SetStateAction<boolean>>;
  setRemoteDropActive: Dispatch<SetStateAction<boolean>>;
}

/** 将浏览器拖放状态机与本地 Pane 的传输编排隔离。 */
export function useLocalTransferPaneDropHandlers({
  closeContextMenu,
  copyLocalEntries,
  downloadRemotePayload,
  listing,
  reportError,
  setDropRejectedActive,
  setRemoteDropActive,
}: LocalTransferPaneDropHandlersOptions) {
  const resolveDrop = (
    event: DragEvent<HTMLElement>,
    type: "drop" | "enter" | "over",
  ) =>
    resolveSftpLocalPaneDropTarget({
      hasLocalPayload: event.dataTransfer.types.includes(
        SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
      ),
      hasRemotePayload: hasSftpRemoteDragPayloadType(event.dataTransfer.types),
      type,
    });

  return {
    handleRemoteDragEnter(event: DragEvent<HTMLElement>) {
      if (!listing) return;
      const decision = resolveDrop(event, "enter");
      if (decision.kind === "ignore") return;
      event.preventDefault();
      setDropRejectedActive(false);
      setRemoteDropActive(
        decision.kind === "copy-hover" ? decision.active : true,
      );
    },
    handleRemoteDragOver(event: DragEvent<HTMLElement>) {
      if (!listing) return;
      const decision = resolveDrop(event, "over");
      if (decision.kind === "ignore") return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropRejectedActive(false);
      setRemoteDropActive(
        decision.kind === "copy-hover" ? decision.active : true,
      );
    },
    handleRemoteDragLeave(event: DragEvent<HTMLElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setRemoteDropActive(false);
        setDropRejectedActive(false);
      }
    },
    handleRemoteDrop(event: DragEvent<HTMLElement>) {
      if (!listing) return;
      const decision = resolveDrop(event, "drop");
      if (decision.kind === "ignore") return;
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
      setRemoteDropActive(false);
      setDropRejectedActive(false);
      if (decision.kind === "copy") {
        const payload = parseSftpLocalFileDragPayload(
          event.dataTransfer.getData(SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME),
        );
        if (!payload) {
          reportError("无法识别拖拽的本机文件。");
          return;
        }
        void copyLocalEntries(payload.entries, listing.path);
        return;
      }
      if (decision.kind === "download") {
        void downloadRemotePayload(
          event.dataTransfer.getData(SFTP_REMOTE_DRAG_PAYLOAD_MIME),
        );
      }
    },
  };
}
