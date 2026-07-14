import { describe, expect, it } from "vitest";
import {
  directTreeChildren,
  flattenWorkspaceTreeRows,
  workspaceFileTabToSftpEntry,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpWorkspaceTreeModel";

describe("sftpWorkspaceTreeModel", () => {
  it("flattens opened directories and filters hidden descendants", () => {
    const root = {
      children: [
        {
          error: null,
          id: "/.env",
          kind: "file" as const,
          loaded: true,
          loading: false,
          name: ".env",
          path: "/.env",
        },
        {
          error: null,
          id: "/app.ts",
          kind: "file" as const,
          loaded: true,
          loading: false,
          name: "app.ts",
          path: "/app.ts",
        },
      ],
      error: null,
      id: "/",
      kind: "directory" as const,
      loaded: true,
      loading: false,
      name: "/",
      path: "/",
    };
    expect(flattenWorkspaceTreeRows([root], new Set(), 0, false)).toMatchObject([
      { depth: 0, node: { path: "/" } },
      { depth: 1, node: { path: "/app.ts" } },
    ]);
  });

  it("keeps only direct unique children after path normalization", () => {
    expect(
      directTreeChildren(
        [
          { kind: "file", name: "a", path: "/logs/a", raw: "a" },
          { kind: "file", name: "a", path: "/logs//a", raw: "a" },
          { kind: "file", name: "b", path: "/logs/nested/b", raw: "b" },
        ],
        "/logs",
      ).map((entry) => entry.name),
    ).toEqual(["a"]);
  });

  it("converts workspace tabs without leaking unrelated state", () => {
    expect(
      workspaceFileTabToSftpEntry({
        path: "C:\\tmp\\notes.txt",
        title: "Notes",
      }),
    ).toMatchObject({ kind: "file", name: "notes.txt", raw: "Notes" });
  });
});
