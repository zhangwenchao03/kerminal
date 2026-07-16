/**
 * 本地传输面板的目录浏览纯状态模型。
 *
 * @author kongweiguang
 */

import type { LocalDirectoryListing } from "../../lib/fileDialogApi";

export type LocalDirectoryEntryFilter = "all" | "files" | "directories";

export interface LocalTransferPaneState {
  error: string | null;
  listing: LocalDirectoryListing | null;
  loading: boolean;
  pathDraft: string;
  requestId: number;
}

export type LocalTransferPaneAction =
  | { requestId: number; type: "load-started" }
  | {
      listing: LocalDirectoryListing;
      requestId: number;
      type: "load-succeeded";
    }
  | { error: string; requestId: number; type: "load-failed" }
  | { error: string; type: "error-reported" }
  | { pathDraft: string; type: "path-draft-changed" }
  | { type: "path-draft-reset" };

export const initialLocalTransferPaneState: LocalTransferPaneState = {
  error: null,
  listing: null,
  loading: false,
  pathDraft: "",
  requestId: 0,
};

export function nextLocalDirectoryRequestId(currentRequestId: number) {
  return currentRequestId + 1;
}

export function localTransferPaneReducer(
  state: LocalTransferPaneState,
  action: LocalTransferPaneAction,
): LocalTransferPaneState {
  if (
    (action.type === "load-succeeded" || action.type === "load-failed") &&
    action.requestId !== state.requestId
  ) {
    return state;
  }

  if (action.type === "load-started") {
    return {
      ...state,
      error: null,
      loading: true,
      requestId: action.requestId,
    };
  }

  if (action.type === "load-succeeded") {
    return {
      ...state,
      error: null,
      listing: action.listing,
      loading: false,
      pathDraft: action.listing.path,
    };
  }

  if (action.type === "load-failed") {
    return {
      ...state,
      error: action.error,
      loading: false,
    };
  }

  if (action.type === "error-reported") {
    return {
      ...state,
      error: action.error,
      loading: false,
    };
  }

  if (action.type === "path-draft-changed") {
    return {
      ...state,
      pathDraft: action.pathDraft,
    };
  }

  return {
    ...state,
    pathDraft: state.listing?.path ?? "",
  };
}

export function localDirectorySummary(listing: LocalDirectoryListing | null) {
  const totalCount = listing?.entries.length ?? 0;
  const directoryCount =
    listing?.entries.filter((entry) => entry.kind === "directory").length ?? 0;
  const fileCount =
    listing?.entries.filter((entry) => entry.kind === "file").length ?? 0;
  const symlinkCount =
    listing?.entries.filter((entry) => entry.kind === "symlink").length ?? 0;
  const otherCount =
    listing?.entries.filter((entry) => entry.kind === "other").length ?? 0;
  const specialCount = symlinkCount + otherCount;

  return {
    directoryCount,
    fileCount,
    label:
      specialCount > 0
        ? `${totalCount} 项 / ${directoryCount} 目录 / ${fileCount} 文件 / ${specialCount} 其它`
        : `${totalCount} 项 / ${directoryCount} 目录 / ${fileCount} 文件`,
    otherCount,
    symlinkCount,
    totalCount,
  };
}

export function filterLocalDirectoryEntries(
  listing: LocalDirectoryListing | null,
  filter: LocalDirectoryEntryFilter,
) {
  const entries = listing?.entries ?? [];
  if (filter === "files") {
    return entries.filter((entry) => entry.kind === "file");
  }
  if (filter === "directories") {
    return entries.filter((entry) => entry.kind === "directory");
  }
  return [...entries].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function visibleLocalDirectoryListing(
  listing: LocalDirectoryListing | null,
  showHiddenEntries: boolean,
): LocalDirectoryListing | null {
  if (!listing || showHiddenEntries) {
    return listing;
  }

  return {
    ...listing,
    entries: listing.entries.filter((entry) => !isHiddenLocalDirectoryEntry(entry)),
  };
}

function isHiddenLocalDirectoryEntry(
  entry: LocalDirectoryListing["entries"][number],
) {
  return Boolean(entry.hidden) || entry.name.startsWith(".");
}

export function normalizeLocalTransferError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
