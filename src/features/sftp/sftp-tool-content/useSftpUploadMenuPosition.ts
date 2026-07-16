import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

const SFTP_UPLOAD_MENU_WIDTH = 176;
const SFTP_UPLOAD_MENU_VIEWPORT_GAP = 8;

export interface SftpUploadMenuPosition {
  left: number;
  top: number;
}

interface UseSftpUploadMenuPositionOptions {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
}

/** 根据锚点和视口宽度计算上传菜单位置，确保菜单不会越过水平安全边距。 */
export function resolveSftpUploadMenuPosition(
  anchorRect: Pick<DOMRect, "bottom" | "left">,
  viewportWidth: number,
): SftpUploadMenuPosition {
  const effectiveViewportWidth =
    viewportWidth || anchorRect.left + SFTP_UPLOAD_MENU_WIDTH;
  const maxLeft =
    effectiveViewportWidth -
    SFTP_UPLOAD_MENU_WIDTH -
    SFTP_UPLOAD_MENU_VIEWPORT_GAP;
  return {
    left: Math.max(
      SFTP_UPLOAD_MENU_VIEWPORT_GAP,
      Math.min(anchorRect.left, maxLeft),
    ),
    top: anchorRect.bottom + 4,
  };
}

/** 管理上传菜单定位以及窗口 resize、捕获阶段 scroll 的同步与清理。 */
export function useSftpUploadMenuPosition({
  anchorRef,
  open,
}: UseSftpUploadMenuPositionOptions): SftpUploadMenuPosition | null {
  const [position, setPosition] = useState<SftpUploadMenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) {
      setPosition(null);
      return;
    }
    setPosition(
      resolveSftpUploadMenuPosition(
        anchor.getBoundingClientRect(),
        window.innerWidth,
      ),
    );
  }, [anchorRef, open]);

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") {
      setPosition(null);
      return undefined;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return position;
}
