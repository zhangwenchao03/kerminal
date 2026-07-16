import type { SftpEntry } from "../../../lib/sftpApi";
import type { SftpContextMenuState } from "../sftp-tool-content/types";

/** 根据右键目标和当前多选状态生成菜单作用域。 */
export function buildSftpContextMenuScope({
  entry,
  selectedEntries,
  transferableSelectedEntries,
}: {
  entry: SftpEntry | null;
  selectedEntries: SftpEntry[];
  transferableSelectedEntries: SftpEntry[];
}): SftpContextMenuState["scope"] {
  if (
    entry &&
    selectedEntries.length > 1 &&
    selectedEntries.some((selectedEntry) => selectedEntry.path === entry.path)
  ) {
    return {
      entries: selectedEntries,
      kind: "selection",
      transferableEntries: transferableSelectedEntries,
    };
  }
  if (entry) {
    return { entry, kind: "entry" };
  }
  return { kind: "directory" };
}
