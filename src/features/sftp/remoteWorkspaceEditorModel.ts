import type {
  DockerContainerReadTextFileResponse,
  DockerContainerWriteTextFileResponse,
} from "../../lib/containerFilesApi";
import type {
  SftpEntry,
  SftpFileRevision,
  SftpReadTextFileResponse,
  SftpWriteTextFileResponse,
} from "../../lib/sftpApiTypes";
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

export type RemoteWorkspaceReadResponse =
  | DockerContainerReadTextFileResponse
  | SftpReadTextFileResponse;

export type RemoteWorkspaceWriteResponse =
  | DockerContainerWriteTextFileResponse
  | SftpWriteTextFileResponse;

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

export function createLoadedTab(
  path: string,
  response: RemoteWorkspaceReadResponse,
): OpenFileTab {
  return {
    content: response.content,
    encoding: response.encoding,
    error: null,
    language: languageForPath(path),
    lineEnding: response.lineEnding,
    loading: false,
    name: fileNameFromPath(path),
    path,
    readonly: response.readonly || response.truncated || response.binary,
    revision: response.revision,
    savedContent: response.content,
    saving: false,
    truncated: response.truncated,
  };
}

export function applyOpenTabError(
  tab: OpenFileTab,
  message: string,
): OpenFileTab {
  return {
    ...tab,
    error: message,
    loading: false,
    readonly: true,
  };
}

export function readonlySaveStatus(
  tab: OpenFileTab,
): RemoteWorkspaceStatus | null {
  if (!tab.readonly && !tab.truncated) {
    return null;
  }
  return {
    kind: "error",
    message: tab.truncated
      ? "文件已截断，不能直接保存。"
      : "当前文件为只读状态。",
  };
}

export function cleanSaveStatus(
  tab: OpenFileTab,
  overwriteOnConflict: boolean,
): RemoteWorkspaceStatus | null {
  if (isDirtyTab(tab) || overwriteOnConflict) {
    return null;
  }
  return { kind: "info", message: "当前文件没有未保存修改。" };
}

export function startSavingTab(tab: OpenFileTab): OpenFileTab {
  return { ...tab, error: null, saving: true };
}

export function applySaveSuccess(
  tab: OpenFileTab,
  response: RemoteWorkspaceWriteResponse,
): OpenFileTab {
  return {
    ...tab,
    encoding: response.encoding,
    error: null,
    lineEnding: response.lineEnding,
    revision: response.revision,
    savedContent: tab.content,
    saving: false,
  };
}

export function applySaveError(
  tab: OpenFileTab,
  message: string,
): OpenFileTab {
  return {
    ...tab,
    error: message,
    saving: false,
  };
}

export function startReloadingTab(tab: OpenFileTab): OpenFileTab {
  return { ...tab, error: null, loading: true };
}

export function applyReloadSuccess(
  tab: OpenFileTab,
  response: RemoteWorkspaceReadResponse,
): OpenFileTab {
  return {
    ...tab,
    content: response.content,
    encoding: response.encoding,
    error: null,
    language: languageForPath(tab.path),
    lineEnding: response.lineEnding,
    loading: false,
    readonly: response.readonly || response.truncated || response.binary,
    revision: response.revision,
    savedContent: response.content,
    truncated: response.truncated,
  };
}

export function applyReloadError(
  tab: OpenFileTab,
  message: string,
): OpenFileTab {
  return {
    ...tab,
    error: message,
    loading: false,
  };
}

export function closeFileTabState(
  tabs: OpenFileTab[],
  activePath: string | null,
  path: string,
): { activePath: string | null; tabs: OpenFileTab[] } {
  const index = tabs.findIndex((tab) => tab.path === path);
  const nextTabs = tabs.filter((tab) => tab.path !== path);
  if (activePath !== path) {
    return { activePath, tabs: nextTabs };
  }
  const nextActive = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0] ?? null;
  return { activePath: nextActive?.path ?? null, tabs: nextTabs };
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

const languageByExtension: Record<string, string> = {
  bash: "shell",
  bat: "bat",
  bicep: "bicep",
  c: "cpp",
  cc: "cpp",
  cjs: "javascript",
  clj: "clojure",
  cmd: "bat",
  coffee: "coffee",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  dockerfile: "dockerfile",
  env: "ini",
  fish: "shell",
  fs: "fsharp",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "cpp",
  hcl: "hcl",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  mjs: "javascript",
  md: "markdown",
  mdx: "mdx",
  mysql: "mysql",
  php: "php",
  pl: "perl",
  proto: "protobuf",
  ps1: "powershell",
  psql: "pgsql",
  py: "python",
  r: "r",
  rb: "ruby",
  redis: "redis",
  rs: "rust",
  sass: "scss",
  scala: "scala",
  scss: "scss",
  sh: "shell",
  sol: "solidity",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  tcl: "tcl",
  tf: "hcl",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

const languageByFilename: Record<string, string> = {
  ".bash_profile": "shell",
  ".bashrc": "shell",
  ".dockerignore": "plaintext",
  ".editorconfig": "ini",
  ".env": "ini",
  ".eslintrc": "json",
  ".gitconfig": "ini",
  ".npmrc": "ini",
  ".prettierrc": "json",
  ".profile": "shell",
  ".yarnrc": "ini",
  ".zprofile": "shell",
  ".zshrc": "shell",
  "cargo.lock": "ini",
  "dockerfile": "dockerfile",
  "containerfile": "dockerfile",
  "gemfile": "ruby",
  "license": "plaintext",
  "pipfile": "ini",
  "procfile": "shell",
  "readme": "markdown",
};

export function languageForPath(path: string) {
  const name = fileNameFromPath(path).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (name === "containerfile" || name.startsWith("containerfile.")) {
    return "dockerfile";
  }
  if (name === ".env" || name.startsWith(".env.")) {
    return "ini";
  }

  const languageByExactName = languageByFilename[name];
  if (languageByExactName) {
    return languageByExactName;
  }

  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";
  const languageByFileExtension = languageByExtension[extension];
  if (languageByFileExtension) {
    return languageByFileExtension;
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
