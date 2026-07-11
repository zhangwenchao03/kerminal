/**
 * SFTP 本地文件拖放上传监听器。
 *
 * @author kongweiguang
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { isRunningInTauriWebview } from "./sftpDragDropModel";
import { resolveSftpLocalUploadDropEvent } from "./sftpLocalUploadDropModel";
import { errorMessage } from "./sftpPathModel";
import type { SftpFileTarget, SftpStatus } from "./types";

type UseSftpLocalUploadDropActionsArgs = {
  active: boolean;
  currentPath: string;
  dropZoneRef: RefObject<HTMLDivElement | null>;
  fileTarget: SftpFileTarget | null;
  setDragDropActive: Dispatch<SetStateAction<boolean>>;
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>;
  uploadDroppedLocalPaths: (
    paths: string[],
    targetRemotePath?: string,
  ) => Promise<void>;
};

export function useSftpLocalUploadDropActions({
  active,
  currentPath,
  dropZoneRef,
  fileTarget,
  setDragDropActive,
  setOperationStatus,
  uploadDroppedLocalPaths,
}: UseSftpLocalUploadDropActionsArgs) {
  useEffect(() => {
    if (!active || !fileTarget || !isRunningInTauriWebview()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed) {
          return;
        }

        const decision = resolveSftpLocalUploadDropEvent(
          event,
          dropZoneRef.current,
        );
        if (decision.kind === "hover") {
          setDragDropActive(decision.active);
          return;
        }
        setDragDropActive(false);
        if (decision.kind === "upload") {
          void uploadDroppedLocalPaths(decision.paths, currentPath);
        }
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((nextError) => {
        if (!disposed) {
          setDragDropActive(false);
          setOperationStatus({
            kind: "error",
            message: `拖放上传初始化失败：${errorMessage(nextError)}`,
          });
        }
      });

    return () => {
      disposed = true;
      setDragDropActive(false);
      unlisten?.();
    };
  }, [
    active,
    currentPath,
    dropZoneRef,
    fileTarget,
    setDragDropActive,
    setOperationStatus,
    uploadDroppedLocalPaths,
  ]);
}
