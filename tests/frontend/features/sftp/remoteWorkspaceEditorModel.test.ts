import { describe, expect, it } from "vitest";
import type {
  SftpFileRevision,
  SftpReadTextFileResponse,
  SftpWriteTextFileResponse,
} from "../../../../src/lib/sftpApiTypes";
import {
  activeTabStatus,
  applyOpenTabError,
  applyReloadError,
  applyReloadSuccess,
  applySaveError,
  applySaveSuccess,
  cleanSaveStatus,
  closeFileTabState,
  createLoadedTab,
  createLoadingTab,
  createRootNode,
  entryToTreeNode,
  errorMessage,
  fileNameFromPath,
  isDirtyTab,
  languageForPath,
  normalizeRemotePath,
  readonlySaveStatus,
  resolveWorkspaceTarget,
  startReloadingTab,
  startSavingTab,
  treeFileCount,
  updateTreeNode,
  type OpenFileTab,
  type WorkspaceTreeNode,
} from "../../../../src/features/sftp/remoteWorkspaceEditorModel";

const revision = (size = 12): SftpFileRevision => ({
  contentSha256: `sha-${size}`,
  modified: "2026-06-21T00:00:00Z",
  permissions: "-rw-r--r--",
  permissionsMode: 0o644,
  size,
});

function readResponse(
  overrides: Partial<SftpReadTextFileResponse> = {},
): SftpReadTextFileResponse {
  const content = overrides.content ?? "console.log('hello');";
  return {
    binary: false,
    bytesRead: content.length,
    content,
    encoding: "utf-8",
    hostId: "host-1",
    lineEnding: "lf",
    maxBytes: 10 * 1024,
    path: "/workspace/src/App.tsx",
    readonly: false,
    revision: revision(content.length),
    truncated: false,
    ...overrides,
  };
}

function writeResponse(
  overrides: Partial<SftpWriteTextFileResponse> = {},
): SftpWriteTextFileResponse {
  return {
    bytesWritten: 20,
    encoding: "utf-8",
    hostId: "host-1",
    lineEnding: "lf",
    path: "/workspace/src/App.tsx",
    revision: revision(20),
    ...overrides,
  };
}

function editableTab(overrides: Partial<OpenFileTab> = {}): OpenFileTab {
  return {
    ...createLoadedTab("/workspace/src/App.tsx", readResponse()),
    ...overrides,
  };
}

describe("remoteWorkspaceEditorModel", () => {
  it("normalizes remote paths and derives names", () => {
    expect(normalizeRemotePath(" \\\\var\\\\log//nginx/// ")).toBe("/var/log/nginx");
    expect(normalizeRemotePath("////")).toBe("/");
    expect(fileNameFromPath("/var/log/nginx/access.log")).toBe("access.log");
    expect(createRootNode("/var/log/")).toMatchObject({
      id: "/var/log",
      kind: "directory",
      name: "log",
      path: "/var/log",
    });
  });

  it("maps entries and updates nested tree nodes immutably", () => {
    const root = createRootNode("/workspace");
    const source = entryToTreeNode({
      kind: "file",
      modified: "2026-06-20T09:00:00Z",
      name: "",
      path: "/workspace/src/main.rs",
      permissions: "-rw-r--r--",
      raw: "-rw-r--r-- main.rs",
      size: 42,
    });
    const tree: WorkspaceTreeNode[] = [
      {
        ...root,
        children: [
          {
            ...createRootNode("/workspace/src"),
            children: [source],
            loaded: true,
          },
        ],
        loaded: true,
      },
    ];

    const updated = updateTreeNode(tree, "/workspace/src/main.rs", (node) => ({
      ...node,
      error: "read failed",
    }));

    expect(updated).not.toBe(tree);
    expect(updated[0].children?.[0].children?.[0]).toMatchObject({
      error: "read failed",
      name: "main.rs",
      size: 42,
    });
    expect(treeFileCount(updated)).toBe(1);
  });

  it("creates loading tabs with language detection and dirty status", () => {
    const tab = createLoadingTab("/workspace/src/App.tsx");

    expect(tab).toMatchObject({
      language: "typescript",
      loading: true,
      name: "App.tsx",
      readonly: true,
    });
    expect(isDirtyTab({ ...tab, content: "changed" })).toBe(true);
    expect(activeTabStatus({ ...tab, error: "远端文件已变更" })).toEqual({
      kind: "error",
      message: "远端文件已变更",
    });
    expect(activeTabStatus(tab)).toBeNull();
  });

  it("creates loaded tabs from read responses and marks unsafe content readonly", () => {
    const tab = createLoadedTab(
      "/workspace/README.md",
      readResponse({
        binary: true,
        content: "# title",
        path: "/workspace/README.md",
        readonly: false,
        revision: revision(7),
        truncated: false,
      }),
    );

    expect(tab).toMatchObject({
      content: "# title",
      language: "markdown",
      loading: false,
      name: "README.md",
      readonly: true,
      savedContent: "# title",
      saving: false,
      truncated: false,
    });
    expect(tab.revision).toEqual(revision(7));
    expect(
      createLoadedTab(
        "/workspace/src/App.tsx",
        readResponse({ binary: false, readonly: false, truncated: true }),
      ).readonly,
    ).toBe(true);
    expect(
      applyOpenTabError(createLoadingTab("/workspace/src/App.tsx"), "denied"),
    ).toMatchObject({ error: "denied", loading: false, readonly: true });
  });

  it("derives save guard statuses without mutating tab state", () => {
    const cleanTab = editableTab();

    expect(readonlySaveStatus({ ...cleanTab, readonly: true })).toEqual({
      kind: "error",
      message: "当前文件为只读状态。",
    });
    expect(readonlySaveStatus({ ...cleanTab, truncated: true })).toEqual({
      kind: "error",
      message: "文件已截断，不能直接保存。",
    });
    expect(readonlySaveStatus(cleanTab)).toBeNull();
    expect(cleanSaveStatus(cleanTab, false)).toEqual({
      kind: "info",
      message: "当前文件没有未保存修改。",
    });
    expect(cleanSaveStatus(cleanTab, true)).toBeNull();
    expect(cleanSaveStatus({ ...cleanTab, content: "changed" }, false)).toBeNull();
  });

  it("transitions save state for start, success, and error outcomes", () => {
    const dirtyTab = editableTab({
      content: "changed",
      error: "stale",
      savedContent: "original",
    });

    expect(startSavingTab(dirtyTab)).toMatchObject({
      error: null,
      saving: true,
    });

    const saved = applySaveSuccess(
      { ...dirtyTab, saving: true },
      writeResponse({
        encoding: "utf-8-lossy",
        lineEnding: "crlf",
        revision: revision(99),
      }),
    );

    expect(saved).toMatchObject({
      encoding: "utf-8-lossy",
      error: null,
      lineEnding: "crlf",
      savedContent: "changed",
      saving: false,
    });
    expect(saved.revision).toEqual(revision(99));
    expect(applySaveError({ ...dirtyTab, saving: true }, "conflict")).toMatchObject({
      error: "conflict",
      saving: false,
      savedContent: "original",
    });
  });

  it("transitions reload state while preserving content on errors", () => {
    const dirtyTab = editableTab({
      content: "local edits",
      error: "old",
      savedContent: "remote",
    });

    expect(startReloadingTab(dirtyTab)).toMatchObject({
      error: null,
      loading: true,
    });

    const reloaded = applyReloadSuccess(
      { ...dirtyTab, loading: true },
      readResponse({
        content: "remote refresh",
        lineEnding: "mixed",
        path: dirtyTab.path,
        readonly: true,
        revision: revision(30),
      }),
    );

    expect(reloaded).toMatchObject({
      content: "remote refresh",
      error: null,
      language: "typescript",
      lineEnding: "mixed",
      loading: false,
      readonly: true,
      savedContent: "remote refresh",
      truncated: false,
    });
    expect(reloaded.revision).toEqual(revision(30));
    expect(applyReloadError({ ...dirtyTab, loading: true }, "offline")).toMatchObject({
      content: "local edits",
      error: "offline",
      loading: false,
      savedContent: "remote",
    });
  });

  it("closes tabs and picks the same next active file as the editor UI", () => {
    const first = editableTab({ path: "/workspace/a.ts", name: "a.ts" });
    const second = editableTab({ path: "/workspace/b.ts", name: "b.ts" });
    const third = editableTab({ path: "/workspace/c.ts", name: "c.ts" });
    const tabs = [first, second, third];

    expect(closeFileTabState(tabs, second.path, second.path)).toEqual({
      activePath: first.path,
      tabs: [first, third],
    });
    expect(closeFileTabState(tabs, third.path, third.path)).toEqual({
      activePath: second.path,
      tabs: [first, second],
    });
    expect(closeFileTabState(tabs, second.path, first.path)).toEqual({
      activePath: second.path,
      tabs: [second, third],
    });
    expect(closeFileTabState([first], first.path, first.path)).toEqual({
      activePath: null,
      tabs: [],
    });
  });

  it("covers language and target resolution boundaries", () => {
    expect(languageForPath("/tmp/config.toml")).toBe("ini");
    expect(languageForPath("/tmp/script.sh")).toBe("shell");
    expect(languageForPath("/tmp/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("/tmp/Dockerfile.dev")).toBe("dockerfile");
    expect(languageForPath("/tmp/.env.production")).toBe("ini");
    expect(languageForPath("/tmp/README")).toBe("markdown");
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(resolveWorkspaceTarget(undefined, " host-1 ")).toEqual({
      hostId: "host-1",
      kind: "ssh",
    });
    expect(
      resolveWorkspaceTarget(
        {
          containerId: "container-1",
          hostId: "host-1",
          kind: "dockerContainer",
        },
        undefined,
      ),
    ).toEqual({
      containerId: "container-1",
      hostId: "host-1",
      kind: "dockerContainer",
    });
    expect(resolveWorkspaceTarget({ kind: "local" }, undefined)).toBeNull();
  });
});
