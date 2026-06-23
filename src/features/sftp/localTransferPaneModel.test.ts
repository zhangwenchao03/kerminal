/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { LocalDirectoryListing } from "../../lib/fileDialogApi";
import {
  filterLocalDirectoryEntries,
  initialLocalTransferPaneState,
  localDirectorySummary,
  localTransferPaneReducer,
  normalizeLocalTransferError,
  visibleLocalDirectoryListing,
} from "./localTransferPaneModel";

const listing: LocalDirectoryListing = {
  entries: [
    {
      kind: "directory",
      name: "src",
      path: "C:\\Projects\\src",
      raw: "directory C:\\Projects\\src",
    },
    {
      kind: "file",
      hidden: true,
      name: ".env",
      path: "C:\\Projects\\.env",
      raw: "file C:\\Projects\\.env",
      size: 256,
    },
    {
      kind: "file",
      name: "README.md",
      path: "C:\\Projects\\README.md",
      raw: "file C:\\Projects\\README.md",
      size: 2048,
    },
    {
      kind: "symlink",
      hidden: true,
      name: "latest",
      path: "C:\\Projects\\latest",
      raw: "symlink C:\\Projects\\latest",
    },
    {
      kind: "other",
      name: "socket",
      path: "C:\\Projects\\socket",
      raw: "other C:\\Projects\\socket",
    },
  ],
  parentPath: "C:\\",
  path: "C:\\Projects",
};

describe("localTransferPaneModel", () => {
  it("summarizes local directory entries by visible directory and file counts", () => {
    expect(localDirectorySummary(listing)).toEqual({
      directoryCount: 1,
      fileCount: 2,
      label: "5 项 / 1 目录 / 2 文件 / 2 其它",
      otherCount: 1,
      symlinkCount: 1,
      totalCount: 5,
    });
    expect(localDirectorySummary(null)).toEqual({
      directoryCount: 0,
      fileCount: 0,
      label: "0 项 / 0 目录 / 0 文件",
      otherCount: 0,
      symlinkCount: 0,
      totalCount: 0,
    });
  });

  it("filters local directory entries by visible entry kind", () => {
    expect(filterLocalDirectoryEntries(listing, "all").map((entry) => entry.name)).toEqual([
      ".env",
      "latest",
      "README.md",
      "socket",
      "src",
    ]);
    expect(filterLocalDirectoryEntries(listing, "files").map((entry) => entry.name)).toEqual([
      ".env",
      "README.md",
    ]);
    expect(
      filterLocalDirectoryEntries(listing, "directories").map((entry) => entry.name),
    ).toEqual(["src"]);
    expect(filterLocalDirectoryEntries(null, "files")).toEqual([]);
  });

  it("can hide local hidden entries before applying kind filters", () => {
    const visibleListing = visibleLocalDirectoryListing(listing, false);

    expect(visibleListing?.entries.map((entry) => entry.name)).toEqual([
      "src",
      "README.md",
      "socket",
    ]);
    expect(
      filterLocalDirectoryEntries(visibleListing, "files").map((entry) => entry.name),
    ).toEqual(["README.md"]);
    expect(visibleLocalDirectoryListing(listing, true)).toBe(listing);
  });

  it("applies the latest successful directory request and syncs the path draft", () => {
    const loadingState = localTransferPaneReducer(initialLocalTransferPaneState, {
      requestId: 1,
      type: "load-started",
    });
    const nextState = localTransferPaneReducer(loadingState, {
      listing,
      requestId: 1,
      type: "load-succeeded",
    });

    expect(nextState).toMatchObject({
      error: null,
      listing,
      loading: false,
      pathDraft: "C:\\Projects",
      requestId: 1,
    });
  });

  it("ignores stale directory request results without changing active loading state", () => {
    const currentState = localTransferPaneReducer(initialLocalTransferPaneState, {
      requestId: 2,
      type: "load-started",
    });

    expect(
      localTransferPaneReducer(currentState, {
        listing,
        requestId: 1,
        type: "load-succeeded",
      }),
    ).toBe(currentState);
    expect(
      localTransferPaneReducer(currentState, {
        error: "old failure",
        requestId: 1,
        type: "load-failed",
      }),
    ).toBe(currentState);
  });

  it("keeps the last listing visible when the current directory request fails", () => {
    const loadedState = localTransferPaneReducer(initialLocalTransferPaneState, {
      requestId: 1,
      type: "load-started",
    });
    const withListing = localTransferPaneReducer(loadedState, {
      listing,
      requestId: 1,
      type: "load-succeeded",
    });
    const reloading = localTransferPaneReducer(withListing, {
      requestId: 2,
      type: "load-started",
    });
    const failed = localTransferPaneReducer(reloading, {
      error: "Access denied",
      requestId: 2,
      type: "load-failed",
    });

    expect(failed).toMatchObject({
      error: "Access denied",
      listing,
      loading: false,
      pathDraft: "C:\\Projects",
      requestId: 2,
    });
  });

  it("resets the path draft to the active listing path on escape", () => {
    const loadedState = localTransferPaneReducer(
      localTransferPaneReducer(initialLocalTransferPaneState, {
        requestId: 1,
        type: "load-started",
      }),
      {
        listing,
        requestId: 1,
        type: "load-succeeded",
      },
    );
    const editedState = localTransferPaneReducer(loadedState, {
      pathDraft: "C:\\Temp",
      type: "path-draft-changed",
    });

    expect(editedState.pathDraft).toBe("C:\\Temp");
    expect(
      localTransferPaneReducer(editedState, {
        type: "path-draft-reset",
      }).pathDraft,
    ).toBe("C:\\Projects");
  });

  it("normalizes unknown loader errors for display", () => {
    expect(normalizeLocalTransferError(new Error("missing path"))).toBe(
      "missing path",
    );
    expect(normalizeLocalTransferError("plain failure")).toBe("plain failure");
  });
});
