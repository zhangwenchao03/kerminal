import { describe, expect, it } from "vitest";
import {
  activeTabStatus,
  createLoadingTab,
  createRootNode,
  entryToTreeNode,
  errorMessage,
  fileNameFromPath,
  isDirtyTab,
  languageForPath,
  normalizeRemotePath,
  resolveWorkspaceTarget,
  treeFileCount,
  updateTreeNode,
  type WorkspaceTreeNode,
} from "./remoteWorkspaceEditorModel";

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

  it("covers language and target resolution boundaries", () => {
    expect(languageForPath("/tmp/config.toml")).toBe("ini");
    expect(languageForPath("/tmp/script.sh")).toBe("shell");
    expect(languageForPath("/tmp/README")).toBe("plaintext");
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
