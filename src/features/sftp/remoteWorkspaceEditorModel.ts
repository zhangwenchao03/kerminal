import type { SftpEntry, SftpFileRevision } from "../../lib/sftpApi";
import type { RemoteTargetRef } from "../../lib/targetModel";

export type RemoteWorkspaceStatus = {
  kind: "info" | "success" | "error";
  message: string;
};

export type WorkspaceTreeNode = {
  children?: WorkspaceTreeNode[];
  error: string | null;
  id: string;
  kind: SftpEntry["kind"];
  loaded: boolean;
  loading: boolean;
  modified?: string;
  name: string;
  path: string;
  permissions?: string;
  size?: number;
};

export type OpenFileTab = {
  content: string;
  encoding: string;
  error: string | null;
  language: string;
  lineEnding: string;
  loading: boolean;
  name: string;
  path: string;
  readonly: boolean;
  revision: SftpFileRevision | null;
  savedContent: string;
  saving: boolean;
  truncated: boolean;
};

export function activeTabStatus(
  tab: OpenFileTab | null,
): RemoteWorkspaceStatus | null {
  if (!tab?.error) {
    return null;
  }
  return { kind: "error", message: tab.error };
}

export function createRootNode(path: string): WorkspaceTreeNode {
  const normalizedPath = normalizeRemotePath(path);
  return {
    children: [],
    error: null,
    id: normalizedPath,
    kind: "directory",
    loaded: false,
    loading: false,
    name: normalizedPath === "/" ? "/" : fileNameFromPath(normalizedPath),
    path: normalizedPath,
  };
}

export function entryToTreeNode(entry: SftpEntry): WorkspaceTreeNode {
  const isDirectory = entry.kind === "directory";
  return {
    children: isDirectory ? [] : undefined,
    error: null,
    id: entry.path,
    kind: entry.kind,
    loaded: !isDirectory,
    loading: false,
    modified: entry.modified,
    name: entry.name || fileNameFromPath(entry.path),
    path: entry.path,
    permissions: entry.permissions,
    size: entry.size,
  };
}

export function updateTreeNode(
  nodes: WorkspaceTreeNode[],
  path: string,
  updater: (node: WorkspaceTreeNode) => WorkspaceTreeNode,
): WorkspaceTreeNode[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return updater(node);
    }
    if (!node.children) {
      return node;
    }
    return {
      ...node,
      children: updateTreeNode(node.children, path, updater),
    };
  });
}

export function createLoadingTab(path: string): OpenFileTab {
  return {
    content: "",
    encoding: "utf-8",
    error: null,
    language: languageForPath(path),
    lineEnding: "lf",
    loading: true,
    name: fileNameFromPath(path),
    path,
    readonly: true,
    revision: null,
    savedContent: "",
    saving: false,
    truncated: false,
  };
}

export function isDirtyTab(tab: OpenFileTab) {
  return tab.content !== tab.savedContent;
}

export function treeFileCount(nodes: WorkspaceTreeNode[]): number {
  return nodes.reduce((count, node) => {
    const ownCount = node.kind === "file" ? 1 : 0;
    return count + ownCount + treeFileCount(node.children ?? []);
  }, 0);
}

export function normalizeRemotePath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.length > 1
    ? normalized.replace(/\/+$/g, "")
    : normalized || "/";
}

export function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

export function languageForPath(path: string) {
  const name = fileNameFromPath(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (["ts", "tsx"].includes(extension)) {
    return "typescript";
  }
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) {
    return "javascript";
  }
  if (["json", "jsonc"].includes(extension)) {
    return "json";
  }
  if (["md", "mdx"].includes(extension)) {
    return "markdown";
  }
  if (["yaml", "yml"].includes(extension)) {
    return "yaml";
  }
  if (["html", "htm"].includes(extension)) {
    return "html";
  }
  if (["css", "scss", "sass", "less"].includes(extension)) {
    return "css";
  }
  if (["rs"].includes(extension)) {
    return "rust";
  }
  if (["sh", "bash", "zsh", "fish"].includes(extension)) {
    return "shell";
  }
  if (["toml"].includes(extension)) {
    return "ini";
  }
  if (["py"].includes(extension)) {
    return "python";
  }
  if (["go"].includes(extension)) {
    return "go";
  }
  if (["java"].includes(extension)) {
    return "java";
  }
  if (["c", "h", "cpp", "hpp", "cc"].includes(extension)) {
    return "cpp";
  }
  return "plaintext";
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type WorkspaceRemoteTarget = Extract<
  RemoteTargetRef,
  { kind: "ssh" | "dockerContainer" }
>;

export function resolveWorkspaceTarget(
  target: RemoteTargetRef | undefined,
  hostId: string | undefined,
): WorkspaceRemoteTarget | null {
  if (target?.kind === "ssh" || target?.kind === "dockerContainer") {
    return target;
  }
  if (hostId?.trim()) {
    return { hostId: hostId.trim(), kind: "ssh" };
  }
  return null;
}
