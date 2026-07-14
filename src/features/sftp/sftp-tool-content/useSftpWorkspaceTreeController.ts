import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { targetStableId, type RemoteTargetRef } from "../../../lib/targetModel";
import {
  createRootNode,
  entryToTreeNode,
  errorMessage,
  normalizeRemotePath,
  updateTreeNode,
  type WorkspaceTreeNode,
} from "../remoteWorkspaceEditorModel";
import { listRemoteWorkspaceDirectory } from "../remoteWorkspaceEditorTransport";
import type { SftpBrowserMode } from "./sftpBrowserModeModel";
import {
  directTreeChildren,
  flattenWorkspaceTreeRows,
  type SftpTreeRenderRow,
} from "./sftpWorkspaceTreeModel";
import type { SftpStatus } from "./types";

interface UseSftpWorkspaceTreeControllerOptions {
  browserMode: SftpBrowserMode;
  currentPath: string;
  showHiddenFiles: boolean;
  workspaceTarget: RemoteTargetRef | null;
}

interface SftpWorkspaceTreeController {
  openTreePaths: Set<string>;
  toggleTreeDirectory: (node: WorkspaceTreeNode) => void;
  treeStatus: SftpStatus | null;
  visibleTreeRows: SftpTreeRenderRow[];
  workspaceTargetKey: string;
}

/**
 * 管理 SFTP 浏览器目录树的作用域、异步加载和展开状态。
 * 目标或根路径变化时必须整体重置，避免跨主机复用旧目录节点。
 */
export function useSftpWorkspaceTreeController({
  browserMode,
  currentPath,
  showHiddenFiles,
  workspaceTarget,
}: UseSftpWorkspaceTreeControllerOptions): SftpWorkspaceTreeController {
  const treeRootPath = useMemo(
    () => normalizeRemotePath(currentPath),
    [currentPath],
  );
  const workspaceTargetKey = workspaceTarget
    ? targetStableId(workspaceTarget)
    : "none";
  const treeScopeKey = `${workspaceTargetKey}|${treeRootPath}`;
  const treeScopeKeyRef = useRef(treeScopeKey);
  const [treeNodes, setTreeNodes] = useState<WorkspaceTreeNode[]>(() => [
    createRootNode(treeRootPath),
  ]);
  const [openTreePaths, setOpenTreePaths] = useState<Set<string>>(
    () => new Set([treeRootPath]),
  );
  const [treeStatus, setTreeStatus] = useState<SftpStatus | null>(null);

  const loadTreeChildren = useCallback(
    async (path: string, replaceRoot = false) => {
      const normalizedPath = normalizeRemotePath(path);
      setTreeStatus(null);
      setOpenTreePaths((current) => {
        if (current.has(normalizedPath)) {
          return current;
        }
        const next = new Set(current);
        next.add(normalizedPath);
        return next;
      });
      setTreeNodes((current) =>
        replaceRoot
          ? [{ ...createRootNode(normalizedPath), loading: true }]
          : updateTreeNode(current, normalizedPath, (node) => ({
              ...node,
              error: null,
              loading: true,
            })),
      );

      try {
        const listing = await listRemoteWorkspaceDirectory(
          workspaceTarget,
          normalizedPath,
        );
        const children = directTreeChildren(
          listing.entries,
          normalizedPath,
        ).map(entryToTreeNode);
        setTreeNodes((current) =>
          replaceRoot
            ? [
                {
                  ...createRootNode(normalizedPath),
                  children,
                  loaded: true,
                  loading: false,
                },
              ]
            : updateTreeNode(current, normalizedPath, (node) => ({
                ...node,
                children,
                error: null,
                loaded: true,
                loading: false,
              })),
        );
      } catch (error) {
        const message = errorMessage(error);
        setTreeStatus({ kind: "error", message });
        setTreeNodes((current) =>
          replaceRoot
            ? [
                {
                  ...createRootNode(normalizedPath),
                  error: message,
                  loaded: false,
                  loading: false,
                },
              ]
            : updateTreeNode(current, normalizedPath, (node) => ({
                ...node,
                error: message,
                loading: false,
              })),
        );
      }
    },
    [workspaceTarget],
  );

  const toggleTreeDirectory = useCallback(
    (node: WorkspaceTreeNode) => {
      const opening = !openTreePaths.has(node.path);
      setOpenTreePaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      if (opening && (!node.loaded || node.error) && !node.loading) {
        void loadTreeChildren(node.path);
      }
    },
    [loadTreeChildren, openTreePaths],
  );

  const visibleTreeRows = useMemo(
    () =>
      flattenWorkspaceTreeRows(
        treeNodes,
        openTreePaths,
        0,
        showHiddenFiles,
      ),
    [openTreePaths, showHiddenFiles, treeNodes],
  );

  useEffect(() => {
    if (treeScopeKeyRef.current === treeScopeKey) {
      return;
    }
    treeScopeKeyRef.current = treeScopeKey;
    setOpenTreePaths(new Set([treeRootPath]));
    setTreeNodes([createRootNode(treeRootPath)]);
    setTreeStatus(null);
  }, [treeRootPath, treeScopeKey]);

  useEffect(() => {
    if (browserMode !== "tree" || !workspaceTarget) {
      return;
    }
    const rootNode = treeNodes[0];
    if (!rootNode || rootNode.path !== treeRootPath) {
      void loadTreeChildren(treeRootPath, true);
      return;
    }
    if (!rootNode.loaded && !rootNode.loading) {
      void loadTreeChildren(treeRootPath, true);
    }
  }, [browserMode, loadTreeChildren, treeNodes, treeRootPath, workspaceTarget]);

  return {
    openTreePaths,
    toggleTreeDirectory,
    treeStatus,
    visibleTreeRows,
    workspaceTargetKey,
  };
}
