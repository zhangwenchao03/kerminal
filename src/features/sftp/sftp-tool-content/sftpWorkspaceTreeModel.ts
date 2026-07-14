import type { SftpEntry } from "../../../lib/sftpApi";
import {
  normalizeRemotePath,
  type WorkspaceTreeNode,
} from "../remoteWorkspaceEditorModel";

export interface SftpTreeRenderRow {
  depth: number;
  node: WorkspaceTreeNode;
}

interface WorkspaceFileTabEntryInput {
  path: string;
  title: string;
}

export function flattenWorkspaceTreeRows(
  nodes: WorkspaceTreeNode[],
  openPaths: Set<string>,
  depth = 0,
  showHiddenFiles = true,
): SftpTreeRenderRow[] {
  return nodes.flatMap((node) => {
    if (depth > 0 && !showHiddenFiles && node.name.startsWith(".")) {
      return [];
    }
    const row = { depth, node };
    const isRootRow = depth === 0;
    if (
      node.kind !== "directory" ||
      (!isRootRow && !openPaths.has(node.path)) ||
      !node.children?.length
    ) {
      return [row];
    }
    return [
      row,
      ...flattenWorkspaceTreeRows(
        node.children,
        openPaths,
        depth + 1,
        showHiddenFiles,
      ),
    ];
  });
}

export function directTreeChildren(
  entries: SftpEntry[],
  parentPath: string,
): SftpEntry[] {
  const normalizedParentPath = normalizeRemotePath(parentPath);
  const seenPaths = new Set<string>();
  return entries.filter((entry) => {
    const normalizedEntryPath = normalizeRemotePath(entry.path);
    if (seenPaths.has(normalizedEntryPath)) {
      return false;
    }
    seenPaths.add(normalizedEntryPath);
    return parentPathForTreeEntry(normalizedEntryPath) === normalizedParentPath;
  });
}

export function treeNodeToSftpEntry(
  node: WorkspaceTreeNode,
  path: string,
): SftpEntry {
  return {
    kind: node.kind,
    modified: node.modified,
    name: node.name,
    path,
    permissions: node.permissions,
    raw: node.name,
    size: node.size,
  };
}

export function workspaceFileTabToSftpEntry(
  tab: WorkspaceFileTabEntryInput,
): SftpEntry {
  return {
    kind: "file",
    name: basenameFromPath(tab.path) || tab.title,
    path: tab.path,
    raw: tab.title,
  };
}

function parentPathForTreeEntry(path: string): string | null {
  const normalizedPath = normalizeRemotePath(path);
  if (normalizedPath === "/") {
    return null;
  }
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "/" : normalizedPath.slice(0, lastSlashIndex);
}

function basenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : normalized;
}
