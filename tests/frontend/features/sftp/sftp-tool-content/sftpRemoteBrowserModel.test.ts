/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { RemoteDirectoryListing } from "../../../../../src/features/sftp/sftp-tool-content/types";
import {
  initialSftpRemoteBrowserState,
  nextSftpRemoteBrowserRequestId,
  normalizeSftpRemoteBrowserError,
  resolveSftpRemoteBrowserSetState,
  sftpRemoteBrowserReducer,
  type SftpRemoteBrowserState,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpRemoteBrowserModel";

const rootListing: RemoteDirectoryListing = {
  entries: [
    {
      kind: "directory",
      name: "var",
      path: "/var",
      permissions: "drwxr-xr-x",
      raw: "drwxr-xr-x var",
      size: 4096,
    },
  ],
  hostId: "prod-api",
  path: "/",
};

const appListing: RemoteDirectoryListing = {
  entries: [
    {
      kind: "file",
      name: "release.sh",
      path: "/srv/app/release.sh",
      permissions: "-rwxr-xr-x",
      raw: "-rwxr-xr-x release.sh",
      size: 2048,
    },
  ],
  hostId: "prod-api",
  parentPath: "/srv",
  path: "/srv/app",
};

describe("sftpRemoteBrowserModel", () => {
  it("starts a new request without discarding the visible listing", () => {
    const selectedState: SftpRemoteBrowserState = {
      ...initialSftpRemoteBrowserState,
      error: "old failure",
      listing: rootListing,
      loading: false,
      pathDraft: "/var",
      requestId: 1,
      selectedEntryPath: "/var",
      selectedEntryPaths: new Set(["/var"]),
    };
    const nextState = sftpRemoteBrowserReducer(selectedState, {
      requestId: 2,
      type: "load-started",
    });

    expect(nextState).toMatchObject({
      error: null,
      listing: rootListing,
      loading: true,
      pathDraft: "/var",
      requestId: 2,
      selectedEntryPath: null,
    });
    expect(nextState.selectedEntryPaths.size).toBe(0);
  });

  it("applies the latest successful request and syncs the path draft", () => {
    const loadingState = sftpRemoteBrowserReducer(
      initialSftpRemoteBrowserState,
      {
        requestId: 1,
        type: "load-started",
      },
    );
    const nextState = sftpRemoteBrowserReducer(loadingState, {
      listing: rootListing,
      requestId: 1,
      type: "load-succeeded",
    });

    expect(nextState).toMatchObject({
      error: null,
      listing: rootListing,
      loading: false,
      pathDraft: "/",
      requestId: 1,
      selectedEntryPath: null,
    });
    expect(nextState.selectedEntryPaths.size).toBe(0);
  });

  it("clears stale selection when a directory request succeeds", () => {
    const selectedState: SftpRemoteBrowserState = {
      ...initialSftpRemoteBrowserState,
      listing: rootListing,
      loading: true,
      pathDraft: "/var",
      requestId: 2,
      selectedEntryPath: "/var",
      selectedEntryPaths: new Set(["/var"]),
    };
    const nextState = sftpRemoteBrowserReducer(selectedState, {
      listing: appListing,
      requestId: 2,
      type: "load-succeeded",
    });

    expect(nextState).toMatchObject({
      error: null,
      listing: appListing,
      loading: false,
      pathDraft: "/srv/app",
      selectedEntryPath: null,
    });
    expect(nextState.selectedEntryPaths.size).toBe(0);
  });

  it("ignores stale directory results without changing the active request", () => {
    const loadedState = sftpRemoteBrowserReducer(
      sftpRemoteBrowserReducer(initialSftpRemoteBrowserState, {
        requestId: 1,
        type: "load-started",
      }),
      {
        listing: rootListing,
        requestId: 1,
        type: "load-succeeded",
      },
    );
    const selectedState = sftpRemoteBrowserReducer(loadedState, {
      selectedEntryPath: "/var",
      selectedEntryPaths: new Set(["/var"]),
      type: "selection-changed",
    });
    const currentState = sftpRemoteBrowserReducer(selectedState, {
      requestId: 2,
      type: "load-started",
    });

    expect(
      sftpRemoteBrowserReducer(currentState, {
        listing: appListing,
        requestId: 1,
        type: "load-succeeded",
      }),
    ).toBe(currentState);
    expect(
      sftpRemoteBrowserReducer(currentState, {
        error: "old failure",
        requestId: 1,
        type: "load-failed",
      }),
    ).toBe(currentState);
  });

  it("keeps the previous listing visible when the current request fails", () => {
    const loadedState = sftpRemoteBrowserReducer(
      sftpRemoteBrowserReducer(initialSftpRemoteBrowserState, {
        requestId: 1,
        type: "load-started",
      }),
      {
        listing: rootListing,
        requestId: 1,
        type: "load-succeeded",
      },
    );
    const requestedState = sftpRemoteBrowserReducer(
      sftpRemoteBrowserReducer(loadedState, {
        pathDraft: "/missing",
        type: "path-draft-changed",
      }),
      {
        requestId: 2,
        type: "load-started",
      },
    );
    const failedState = sftpRemoteBrowserReducer(requestedState, {
      error: "Permission denied",
      requestId: 2,
      type: "load-failed",
    });

    expect(failedState).toMatchObject({
      error: "Permission denied",
      listing: rootListing,
      loading: false,
      pathDraft: "/missing",
      requestId: 2,
    });
  });

  it("clears stale target state by advancing the request id", () => {
    const requestId = nextSftpRemoteBrowserRequestId(2);
    const nextState = sftpRemoteBrowserReducer(
      {
        ...initialSftpRemoteBrowserState,
        error: "old error",
        listing: rootListing,
        loading: true,
        pathDraft: "/var",
        requestId: 2,
        selectedEntryPath: "/var",
        selectedEntryPaths: new Set(["/var"]),
      },
      {
        requestId,
        type: "target-reset",
      },
    );

    expect(nextState).toMatchObject({
      error: null,
      listing: null,
      loading: false,
      pathDraft: "/",
      requestId: 3,
      selectedEntryPath: null,
    });
    expect(nextState.selectedEntryPaths.size).toBe(0);
  });

  it("resets the path draft to the current listing path or root", () => {
    const dirtyDraftState: SftpRemoteBrowserState = {
      ...initialSftpRemoteBrowserState,
      listing: appListing,
      pathDraft: "/tmp/manual-input",
    };

    expect(
      sftpRemoteBrowserReducer(dirtyDraftState, {
        type: "path-draft-reset",
      }).pathDraft,
    ).toBe("/srv/app");
    expect(
      sftpRemoteBrowserReducer(
        {
          ...initialSftpRemoteBrowserState,
          pathDraft: "/tmp/manual-input",
        },
        { type: "path-draft-reset" },
      ).pathDraft,
    ).toBe("/");
  });

  it("resolves direct and functional set-state values", () => {
    expect(resolveSftpRemoteBrowserSetState("/var", "/opt")).toBe("/opt");
    expect(
      resolveSftpRemoteBrowserSetState("/var", (current) => `${current}/log`),
    ).toBe("/var/log");
  });

  it("normalizes loader errors for display", () => {
    expect(normalizeSftpRemoteBrowserError(new Error("network down"))).toBe(
      "network down",
    );
    expect(normalizeSftpRemoteBrowserError("plain failure")).toBe(
      "plain failure",
    );
  });
});
