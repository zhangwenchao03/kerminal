import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SftpEntry } from "../../../lib/sftpApi";

interface UseSftpBrowserCommandsOptions {
  handleTransferKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  openDeleteDialog: (entries: SftpEntry[]) => void;
  openRenameDialog: (entry: SftpEntry) => void;
  selectedEntries: SftpEntry[];
}

/**
 * 组合浏览器级键盘命令；实际 I/O 继续由捕获了当前 target generation 的 action 执行。
 */
export function useSftpBrowserCommands({
  handleTransferKeyDown,
  openDeleteDialog,
  openRenameDialog,
  selectedEntries,
}: UseSftpBrowserCommandsOptions) {
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      handleTransferKeyDown(event);
      if (event.defaultPrevented || isSftpEditableKeyboardTarget(event.target)) {
        return;
      }

      if (event.key === "Delete" && selectedEntries.length > 0) {
        event.preventDefault();
        openDeleteDialog(selectedEntries);
        return;
      }

      if (event.key === "F2" && selectedEntries.length === 1) {
        event.preventDefault();
        openRenameDialog(selectedEntries[0]);
      }
    },
    [
      handleTransferKeyDown,
      openDeleteDialog,
      openRenameDialog,
      selectedEntries,
    ],
  );

  return { handleKeyDown };
}

function isSftpEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']",
    ),
  );
}
