/**
 * SFTP 远端目录浏览的纯状态模型。
 *
 * @author kongweiguang
 */

import type { SetStateAction } from "react";
import { errorMessage } from "./sftpPathModel";
import type { RemoteDirectoryListing } from "./types";

export interface SftpRemoteBrowserState {
  error: string | null;
  listing: RemoteDirectoryListing | null;
  loading: boolean;
  pathDraft: string;
  requestId: number;
  selectedEntryPath: string | null;
  selectedEntryPaths: Set<string>;
}

export type SftpRemoteBrowserAction =
  | { requestId: number; type: "target-reset" }
  | { requestId: number; type: "load-started" }
  | {
      listing: RemoteDirectoryListing;
      requestId: number;
      type: "load-succeeded";
    }
  | { error: string; requestId: number; type: "load-failed" }
  | { pathDraft: string; type: "path-draft-changed" }
  | { type: "path-draft-reset" }
  | {
      selectedEntryPath: string | null;
      selectedEntryPaths: Set<string>;
      type: "selection-changed";
    }
  | { selectedEntryPath: string | null; type: "selection-anchor-changed" }
  | { selectedEntryPaths: Set<string>; type: "selection-paths-changed" };

export const initialSftpRemoteBrowserState: SftpRemoteBrowserState = {
  error: null,
  listing: null,
  loading: false,
  pathDraft: "/",
  requestId: 0,
  selectedEntryPath: null,
  selectedEntryPaths: new Set(),
};

export function nextSftpRemoteBrowserRequestId(currentRequestId: number) {
  return currentRequestId + 1;
}

export function sftpRemoteBrowserReducer(
  state: SftpRemoteBrowserState,
  action: SftpRemoteBrowserAction,
): SftpRemoteBrowserState {
  if (
    (action.type === "load-succeeded" || action.type === "load-failed") &&
    action.requestId !== state.requestId
  ) {
    return state;
  }

  if (action.type === "target-reset") {
    return {
      ...initialSftpRemoteBrowserState,
      requestId: action.requestId,
    };
  }

  if (action.type === "load-started") {
    return {
      ...state,
      error: null,
      loading: true,
      requestId: action.requestId,
      selectedEntryPath: null,
      selectedEntryPaths: new Set(),
    };
  }

  if (action.type === "load-succeeded") {
    return {
      ...state,
      error: null,
      listing: action.listing,
      loading: false,
      pathDraft: action.listing.path,
      selectedEntryPath: null,
      selectedEntryPaths: new Set(),
    };
  }

  if (action.type === "load-failed") {
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

  if (action.type === "selection-changed") {
    return {
      ...state,
      selectedEntryPath: action.selectedEntryPath,
      selectedEntryPaths: action.selectedEntryPaths,
    };
  }

  if (action.type === "selection-anchor-changed") {
    return {
      ...state,
      selectedEntryPath: action.selectedEntryPath,
    };
  }

  if (action.type === "selection-paths-changed") {
    return {
      ...state,
      selectedEntryPaths: action.selectedEntryPaths,
    };
  }

  return {
    ...state,
    pathDraft: state.listing?.path ?? "/",
  };
}

export function resolveSftpRemoteBrowserSetState<T>(
  current: T,
  next: SetStateAction<T>,
) {
  return typeof next === "function"
    ? (next as (previous: T) => T)(current)
    : next;
}

export function normalizeSftpRemoteBrowserError(error: unknown) {
  return errorMessage(error);
}
