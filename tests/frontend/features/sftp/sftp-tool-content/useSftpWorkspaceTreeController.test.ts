import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteTargetRef } from "../../../../../src/lib/targetModel";
import type { SftpBrowserMode } from "../../../../../src/features/sftp/sftp-tool-content/sftpBrowserModeModel";
import { useSftpWorkspaceTreeController } from "../../../../../src/features/sftp/sftp-tool-content/useSftpWorkspaceTreeController";

const transportMocks = vi.hoisted(() => ({
  listRemoteWorkspaceDirectory: vi.fn(),
}));

vi.mock(
  "../../../../../src/features/sftp/remoteWorkspaceEditorTransport",
  () => ({
    listRemoteWorkspaceDirectory: (...args: unknown[]) =>
      transportMocks.listRemoteWorkspaceDirectory(...args),
  }),
);

interface HookProps {
  browserMode: SftpBrowserMode;
  currentPath: string;
  showHiddenFiles: boolean;
  workspaceTarget: RemoteTargetRef | null;
}

const sshTarget = (hostId: string): RemoteTargetRef => ({
  hostId,
  kind: "ssh",
});

describe("useSftpWorkspaceTreeController", () => {
  beforeEach(() => {
    transportMocks.listRemoteWorkspaceDirectory.mockReset();
  });

  it("resets the tree scope when the target or root path changes", async () => {
    const { rerender, result } = renderHook(
      (props: HookProps) => useSftpWorkspaceTreeController(props),
      {
        initialProps: {
          browserMode: "list",
          currentPath: "/srv",
          showHiddenFiles: true,
          workspaceTarget: sshTarget("host-a"),
        } satisfies HookProps,
      },
    );

    expect(result.current.visibleTreeRows[0]?.node.path).toBe("/srv");
    expect(result.current.openTreePaths).toEqual(new Set(["/srv"]));

    rerender({
      browserMode: "list",
      currentPath: "/var/log",
      showHiddenFiles: true,
      workspaceTarget: sshTarget("host-b"),
    });

    await waitFor(() => {
      expect(result.current.workspaceTargetKey).toContain("host-b");
      expect(result.current.visibleTreeRows[0]?.node.path).toBe("/var/log");
    });
    expect(result.current.openTreePaths).toEqual(new Set(["/var/log"]));
    expect(result.current.treeStatus).toBeNull();
    expect(transportMocks.listRemoteWorkspaceDirectory).not.toHaveBeenCalled();
  });

  it("loads the root when tree mode first becomes active", async () => {
    transportMocks.listRemoteWorkspaceDirectory.mockResolvedValue({
      entries: [
        { kind: "file", name: "app.log", path: "/srv/app.log", raw: "" },
        {
          kind: "file",
          name: "nested.log",
          path: "/srv/logs/nested.log",
          raw: "",
        },
      ],
    });

    const { result } = renderTreeHook();

    await waitFor(() => {
      expect(result.current.visibleTreeRows.map((row) => row.node.path)).toEqual([
        "/srv",
        "/srv/app.log",
      ]);
    });
    expect(transportMocks.listRemoteWorkspaceDirectory).toHaveBeenCalledTimes(1);
    expect(transportMocks.listRemoteWorkspaceDirectory).toHaveBeenCalledWith(
      sshTarget("host-a"),
      "/srv",
    );
  });

  it("loads an unopened directory lazily when it is expanded", async () => {
    transportMocks.listRemoteWorkspaceDirectory
      .mockResolvedValueOnce({
        entries: [
          { kind: "directory", name: "logs", path: "/srv/logs", raw: "" },
        ],
      })
      .mockResolvedValueOnce({
        entries: [
          {
            kind: "file",
            name: "app.log",
            path: "/srv/logs/app.log",
            raw: "",
          },
        ],
      });
    const { result } = renderTreeHook();

    await waitFor(() => {
      expect(result.current.visibleTreeRows).toHaveLength(2);
    });
    const logsNode = result.current.visibleTreeRows[1]!.node;

    act(() => {
      result.current.toggleTreeDirectory(logsNode);
    });

    await waitFor(() => {
      expect(result.current.visibleTreeRows.map((row) => row.node.path)).toEqual([
        "/srv",
        "/srv/logs",
        "/srv/logs/app.log",
      ]);
    });
    expect(transportMocks.listRemoteWorkspaceDirectory).toHaveBeenLastCalledWith(
      sshTarget("host-a"),
      "/srv/logs",
    );
  });

  it("keeps the last tree and exposes an error when lazy loading fails", async () => {
    transportMocks.listRemoteWorkspaceDirectory
      .mockResolvedValueOnce({
        entries: [
          { kind: "directory", name: "logs", path: "/srv/logs", raw: "" },
        ],
      })
      .mockRejectedValueOnce(new Error("permission denied"));
    const { result } = renderTreeHook();

    await waitFor(() => {
      expect(result.current.visibleTreeRows).toHaveLength(2);
    });
    act(() => {
      result.current.toggleTreeDirectory(
        result.current.visibleTreeRows[1]!.node,
      );
    });

    await waitFor(() => {
      expect(result.current.treeStatus).toEqual({
        kind: "error",
        message: "permission denied",
      });
    });
    expect(result.current.visibleTreeRows.map((row) => row.node.path)).toEqual([
      "/srv",
      "/srv/logs",
    ]);
    expect(result.current.visibleTreeRows[1]?.node).toMatchObject({
      error: "permission denied",
      loaded: false,
      loading: false,
    });
  });
});

function renderTreeHook() {
  return renderHook(() =>
    useSftpWorkspaceTreeController({
      browserMode: "tree",
      currentPath: "/srv",
      showHiddenFiles: true,
      workspaceTarget: sshTarget("host-a"),
    }),
  );
}
