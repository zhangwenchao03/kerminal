/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpEntry } from "../../../../../src/lib/sftpApi";
import {
  nextContextMenuSelection,
  nextSelectedEntryPaths,
  selectionRangePaths,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpSelectionModel";

const entries: SftpEntry[] = [
  {
    kind: "directory",
    name: "var",
    path: "/var",
    raw: "drwxr-xr-x var",
  },
  {
    kind: "directory",
    name: "log",
    path: "/var/log",
    raw: "drwxr-xr-x log",
  },
  {
    kind: "file",
    name: "app.log",
    path: "/var/log/app.log",
    raw: "-rw-r--r-- app.log",
  },
];

describe("sftpSelectionModel", () => {
  it("selects a contiguous range from the anchor to the clicked entry", () => {
    expect(selectionRangePaths(entries, "/var", "/var/log/app.log")).toEqual([
      "/var",
      "/var/log",
      "/var/log/app.log",
    ]);
  });

  it("toggles entries during ctrl or meta selection", () => {
    const selected = nextSelectedEntryPaths(
      entries,
      new Set(["/var"]),
      "/var",
      "/var/log",
      { ctrlKey: true, metaKey: false, shiftKey: false },
    );

    expect([...selected]).toEqual(["/var", "/var/log"]);
    expect(
      nextSelectedEntryPaths(entries, selected, "/var", "/var", {
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toEqual(new Set(["/var/log"]));
  });

  it("keeps multi-selection when opening a context menu on a selected entry", () => {
    const currentSelection = {
      selectedEntryPath: "/var/log",
      selectedEntryPaths: new Set(["/var", "/var/log"]),
    };

    expect(nextContextMenuSelection(currentSelection, "/var")).toBe(
      currentSelection,
    );
  });

  it("reduces selection to the context-menu entry when it is not selected", () => {
    const nextSelection = nextContextMenuSelection(
      {
        selectedEntryPath: "/var/log",
        selectedEntryPaths: new Set(["/var", "/var/log"]),
      },
      "/var/log/app.log",
    );

    expect(nextSelection.selectedEntryPath).toBe("/var/log/app.log");
    expect(nextSelection.selectedEntryPaths).toEqual(
      new Set(["/var/log/app.log"]),
    );
  });

  it("does not clear selection when opening the current-directory menu", () => {
    const currentSelection = {
      selectedEntryPath: "/var/log",
      selectedEntryPaths: new Set(["/var", "/var/log"]),
    };

    expect(nextContextMenuSelection(currentSelection, null)).toBe(
      currentSelection,
    );
  });
});
