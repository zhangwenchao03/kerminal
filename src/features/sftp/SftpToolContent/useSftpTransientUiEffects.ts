import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { SftpStatus } from "../sftp-tool-content/types";
import { TRANSIENT_ERROR_STATUS_MS } from "../sftp-tool-content/types";

/** 错误状态短暂展示后自动清理，且不会覆盖期间产生的新状态。 */
export function useTransientSftpErrorStatus(
  operationStatus: SftpStatus | null,
  setOperationStatus: Dispatch<SetStateAction<SftpStatus | null>>,
) {
  useEffect(() => {
    if (!operationStatus || operationStatus.kind !== "error") return undefined;
    const timeoutId = window.setTimeout(() => {
      setOperationStatus((current) => current === operationStatus ? null : current);
    }, TRANSIENT_ERROR_STATUS_MS);
    return () => window.clearTimeout(timeoutId);
  }, [operationStatus, setOperationStatus]);
}

/** 上传菜单打开时监听外部点击，并保留 portal 菜单区域的交互。 */
export function useSftpUploadMenuDismiss(
  uploadMenuOpen: boolean,
  uploadMenuRef: RefObject<HTMLDivElement | null>,
  setUploadMenuOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!uploadMenuOpen) return undefined;
    const closeUploadMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && uploadMenuRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[data-sftp-upload-menu]")) return;
      setUploadMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeUploadMenu);
    return () => window.removeEventListener("pointerdown", closeUploadMenu);
  }, [setUploadMenuOpen, uploadMenuOpen, uploadMenuRef]);
}

/** 右键菜单通过普通点击或 Escape 关闭，右键按下交给菜单定位逻辑处理。 */
export function useSftpContextMenuDismiss(
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.button !== 2) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open]);
}
