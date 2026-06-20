import type { SftpEntry } from "../../../lib/sftpApi";
import type { SftpSelectionEvent } from "./types";

export function nextSelectedEntryPaths(
  entries: SftpEntry[],
  currentSelection: Set<string>,
  anchorPath: string | null,
  clickedPath: string,
  event?: SftpSelectionEvent,
) {
  if (event?.shiftKey && anchorPath) {
    return new Set(selectionRangePaths(entries, anchorPath, clickedPath));
  }

  if (event?.ctrlKey || event?.metaKey) {
    const nextSelection = new Set(currentSelection);
    if (nextSelection.has(clickedPath)) {
      nextSelection.delete(clickedPath);
    } else {
      nextSelection.add(clickedPath);
    }
    return nextSelection;
  }

  return new Set([clickedPath]);
}

export function selectionRangePaths(
  entries: SftpEntry[],
  anchorPath: string,
  clickedPath: string,
) {
  const anchorIndex = entries.findIndex((entry) => entry.path === anchorPath);
  const clickedIndex = entries.findIndex((entry) => entry.path === clickedPath);
  if (anchorIndex < 0 || clickedIndex < 0) {
    return [clickedPath];
  }
  const start = Math.min(anchorIndex, clickedIndex);
  const end = Math.max(anchorIndex, clickedIndex);
  return entries.slice(start, end + 1).map((entry) => entry.path);
}
