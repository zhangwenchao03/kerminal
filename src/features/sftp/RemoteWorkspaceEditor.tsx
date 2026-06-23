import Editor, { type OnMount } from "@monaco-editor/react";
import {
  AlertTriangle,
  Check,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X,
} from "lucide-react";
import type * as Monaco from "monaco-editor";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Tree, type NodeApi } from "react-arborist";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import { configureKerminalMonaco } from "../../lib/monacoTheme";
import "../../lib/monacoSetup";
import { targetStableId, type RemoteTargetRef } from "../../lib/targetModel";
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
  isDirtyTab,
  normalizeRemotePath,
  readonlySaveStatus,
  resolveWorkspaceTarget,
  startReloadingTab,
  startSavingTab,
  treeFileCount,
  updateTreeNode,
  type OpenFileTab,
  type RemoteWorkspaceStatus,
  type WorkspaceTreeNode,
} from "./remoteWorkspaceEditorModel";
import {
  listRemoteWorkspaceDirectory,
  readRemoteWorkspaceTextFile,
  writeRemoteWorkspaceTextFile,
} from "./remoteWorkspaceEditorTransport";

const MAX_EDITOR_BYTES = 10 * 1024 * 1024;

export type RemoteWorkspaceOpenCommand = {
  nonce: number;
  path: string;
};

export type { RemoteWorkspaceStatus } from "./remoteWorkspaceEditorModel";

export function RemoteWorkspaceEditor({
  hostId,
  onDirtyStateChange,
  onOpenDirectory,
  onStatus,
  openCommand,
  rootPath,
  target,
  variant = "embedded",
}: {
  hostId?: string;
  onDirtyStateChange?: (dirty: boolean) => void;
  onOpenDirectory?: (path: string) => Promise<void> | void;
  onStatus?: (status: RemoteWorkspaceStatus) => void;
  openCommand?: RemoteWorkspaceOpenCommand | null;
  rootPath: string;
  target?: RemoteTargetRef;
  variant?: "embedded" | "fullscreen" | "workspace";
}) {
  const expanded = variant !== "embedded";
  const workspaceTarget = useMemo(
    () => resolveWorkspaceTarget(target, hostId),
    [hostId, target],
  );
  const workspaceTargetKey = workspaceTarget
    ? targetStableId(workspaceTarget)
    : "none";
  const workspaceProtocol =
    workspaceTarget?.kind === "dockerContainer" ? "container://" : "sftp://";
  const normalizedRootPath = normalizeRemotePath(rootPath);
  const [workspaceRoot, setWorkspaceRoot] = useState(normalizedRootPath);
  const [rootDraft, setRootDraft] = useState(normalizedRootPath);
  const [treeNodes, setTreeNodes] = useState<WorkspaceTreeNode[]>(() => [
    createRootNode(normalizedRootPath),
  ]);
  const [treeStatus, setTreeStatus] = useState<RemoteWorkspaceStatus | null>(
    null,
  );
  const [tabs, setTabs] = useState<OpenFileTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null);
  const [treeHeight, setTreeHeight] = useState(expanded ? 640 : 456);
  const editorRef =
    useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const saveActiveRef = useRef<() => void>(() => undefined);
  const tabsRef = useRef<OpenFileTab[]>([]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  );
  const pendingCloseTab = useMemo(
    () => tabs.find((tab) => tab.path === pendingClosePath) ?? null,
    [pendingClosePath, tabs],
  );
  const dirtyTabCount = tabs.filter(isDirtyTab).length;
  const hasConflict =
    activeTab?.error?.includes("远端文件已变更") ||
    activeTab?.error?.includes("conflict");

  const setTab = useCallback(
    (path: string, updater: (tab: OpenFileTab) => OpenFileTab) => {
      setTabs((current) =>
        current.map((tab) => (tab.path === path ? updater(tab) : tab)),
      );
    },
    [],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    onDirtyStateChange?.(dirtyTabCount > 0);
  }, [dirtyTabCount, onDirtyStateChange]);

  useEffect(() => {
    if (!expanded) {
      setTreeHeight(456);
      return undefined;
    }

    const element = treeViewportRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const updateTreeHeight = () => {
      const height = Math.floor(
        element.getBoundingClientRect().height || element.clientHeight,
      );
      if (height > 0) {
        setTreeHeight(Math.max(360, height));
      }
    };

    updateTreeHeight();
    const observer = new ResizeObserver(updateTreeHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded]);

  const loadChildren = useCallback(
    async (path: string, replaceRoot = false) => {
      const normalizedPath = normalizeRemotePath(path);
      setTreeStatus(null);
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
        const children = listing.entries.map(entryToTreeNode);
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
        setTreeStatus({ kind: "error", message });
      }
    },
    [workspaceTarget],
  );

  useEffect(() => {
    setWorkspaceRoot(normalizedRootPath);
    setRootDraft(normalizedRootPath);
    setTreeNodes([{ ...createRootNode(normalizedRootPath), loading: true }]);
    void loadChildren(normalizedRootPath, true);
  }, [loadChildren, normalizedRootPath, workspaceTargetKey]);

  useEffect(() => {
    setTabs([]);
    setActivePath(null);
  }, [workspaceTargetKey]);

  const openFile = useCallback(
    async (path: string) => {
      const normalizedPath = normalizeRemotePath(path);
      setActivePath(normalizedPath);
      if (tabsRef.current.some((tab) => tab.path === normalizedPath)) {
        return;
      }
      setTabs((current) => {
        if (current.some((tab) => tab.path === normalizedPath)) {
          return current;
        }
        return [...current, createLoadingTab(normalizedPath)];
      });

      try {
        const response = await readRemoteWorkspaceTextFile({
          maxBytes: MAX_EDITOR_BYTES,
          path: normalizedPath,
          target: workspaceTarget,
        });
        const nextTab = createLoadedTab(normalizedPath, response);
        setTabs((current) =>
          current.map((tab) =>
            tab.path === normalizedPath ? nextTab : tab,
          ),
        );
        onStatus?.({
          kind: "info",
          message: `已打开远程文件：${normalizedPath}`,
        });
      } catch (error) {
        const message = errorMessage(error);
        setTabs((current) =>
          current.map((tab) =>
            tab.path === normalizedPath
              ? applyOpenTabError(tab, message)
              : tab,
          ),
        );
        onStatus?.({ kind: "error", message });
      }
    },
    [onStatus, workspaceTarget],
  );

  useEffect(() => {
    if (!openCommand?.path) {
      return;
    }
    void openFile(openCommand.path);
  }, [openCommand?.nonce, openCommand?.path, openFile]);

  const saveFile = useCallback(
    async (path: string, overwriteOnConflict = false): Promise<boolean> => {
      const tab = tabs.find((item) => item.path === path);
      if (!tab || tab.loading || tab.saving) {
        return false;
      }
      const readonlyStatus = readonlySaveStatus(tab);
      if (readonlyStatus) {
        setTab(path, (current) => ({
          ...current,
          error: readonlyStatus.message,
        }));
        onStatus?.(readonlyStatus);
        return false;
      }
      const cleanStatus = cleanSaveStatus(tab, overwriteOnConflict);
      if (cleanStatus) {
        onStatus?.(cleanStatus);
        return true;
      }

      setTab(path, startSavingTab);
      try {
        const response = await writeRemoteWorkspaceTextFile({
          content: tab.content,
          expectedRevision: tab.revision,
          overwriteOnConflict,
          path,
          target: workspaceTarget,
        });
        setTab(path, (current) => applySaveSuccess(current, response));
        onStatus?.({ kind: "success", message: `已保存：${path}` });
        return true;
      } catch (error) {
        const message = errorMessage(error);
        setTab(path, (current) => applySaveError(current, message));
        onStatus?.({ kind: "error", message });
        return false;
      }
    },
    [onStatus, setTab, tabs, workspaceTarget],
  );

  const reloadFile = useCallback(
    async (path: string) => {
      setTab(path, startReloadingTab);
      try {
        const response = await readRemoteWorkspaceTextFile({
          maxBytes: MAX_EDITOR_BYTES,
          path,
          target: workspaceTarget,
        });
        setTab(path, (tab) => applyReloadSuccess(tab, response));
        onStatus?.({ kind: "info", message: `已重新加载：${path}` });
      } catch (error) {
        const message = errorMessage(error);
        setTab(path, (tab) => applyReloadError(tab, message));
        onStatus?.({ kind: "error", message });
      }
    },
    [onStatus, setTab, workspaceTarget],
  );

  const closeTabNow = useCallback(
    (path: string) => {
      setTabs((current) => {
        const nextState = closeFileTabState(current, activePath, path);
        setActivePath(nextState.activePath);
        return nextState.tabs;
      });
    },
    [activePath],
  );

  const requestCloseTab = useCallback(
    (path: string) => {
      const tab = tabsRef.current.find((item) => item.path === path);
      if (tab && isDirtyTab(tab)) {
        setPendingClosePath(path);
        return;
      }
      closeTabNow(path);
    },
    [closeTabNow],
  );

  const openWorkspaceFolder = useCallback(async () => {
    const nextRoot = normalizeRemotePath(rootDraft);
    setWorkspaceRoot(nextRoot);
    setRootDraft(nextRoot);
    await onOpenDirectory?.(nextRoot);
    await loadChildren(nextRoot, true);
  }, [loadChildren, onOpenDirectory, rootDraft]);

  const runEditorAction = useCallback((actionId: string) => {
    const action = editorRef.current?.getAction(actionId);
    void action?.run();
    editorRef.current?.focus();
  }, []);

  useEffect(() => {
    saveActiveRef.current = () => {
      if (activePath) {
        void saveFile(activePath);
      }
    };
  }, [activePath, saveFile]);

  const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => saveActiveRef.current(),
    );
  }, []);

  return (
    <>
    <section
      className={cn(
        "kerminal-solid-surface overflow-hidden rounded-2xl border",
        expanded && "flex h-full min-h-0 flex-col rounded-xl",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FolderOpen className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
          <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            工作区
          </span>
          <input
            aria-label="远程工作区路径"
            className="kerminal-field-surface h-8 min-w-0 flex-1 rounded-lg border px-2 font-mono text-xs text-zinc-900 dark:text-zinc-100"
            onChange={(event) => setRootDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void openWorkspaceFolder();
              }
            }}
            spellCheck={false}
            value={rootDraft}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            className="h-8 rounded-md px-2 text-xs"
            onClick={() => void openWorkspaceFolder()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            打开文件夹
          </Button>
          <Button
            aria-label="刷新工作区树"
            className="h-8 w-8 rounded-md px-0"
            onClick={() => void loadChildren(workspaceRoot, true)}
            size="sm"
            title="刷新工作区树"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
          className={cn(
            "grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]",
            expanded ? "min-h-0 flex-1" : "min-h-[560px]",
          )}
      >
        <aside
          className={cn(
            "kerminal-muted-surface min-h-0 border-b border-[var(--border-subtle)] lg:border-b-0 lg:border-r",
            expanded && "flex flex-col",
          )}
        >
          <div className="flex h-9 items-center justify-between border-b border-[var(--border-subtle)] px-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="truncate font-mono">{workspaceRoot}</span>
            <span>{treeFileCount(treeNodes)} 文件</span>
          </div>
          <div
            className={cn(
              "overflow-hidden py-1",
              expanded ? "min-h-0 flex-1" : "h-[460px]",
            )}
            ref={treeViewportRef}
          >
            <Tree<WorkspaceTreeNode>
              data={treeNodes}
              height={treeHeight}
              indent={18}
              openByDefault
              overscanCount={8}
              rowHeight={32}
              width="100%"
            >
              {({ node, style }) => (
                <WorkspaceTreeRow
                  activePath={activePath}
                  node={node}
                  onLoadChildren={(path) => void loadChildren(path)}
                  onOpenFile={(path) => void openFile(path)}
                  style={style}
                />
              )}
            </Tree>
          </div>
          <WorkspaceInlineStatus status={treeStatus} />
        </aside>

        <div className="flex min-h-0 flex-col">
          <div className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] px-2">
            {tabs.length === 0 ? (
              <div className="px-2 text-xs text-zinc-500 dark:text-zinc-400">
                未打开文件
              </div>
            ) : (
              tabs.map((tab) => (
                <button
                  className={cn(
                    "kerminal-focus-ring kerminal-pressable flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs transition",
                    activePath === tab.path
                      ? "border-sky-400/35 bg-[var(--surface-selected)] text-sky-800 dark:text-sky-100"
                      : "border-transparent text-zinc-600 hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] dark:text-zinc-300",
                  )}
                  key={tab.path}
                  onClick={() => setActivePath(tab.path)}
                  title={tab.path}
                  type="button"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.name}</span>
                  {isDirtyTab(tab) ? (
                    <span
                      aria-label={`${tab.name} 未保存`}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    />
                  ) : null}
                  <span
                    aria-label={`关闭 ${tab.name}`}
                    className="kerminal-focus-ring kerminal-pressable rounded p-0.5 text-zinc-400 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:hover:text-zinc-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestCloseTab(tab.path);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {activeTab?.path ?? workspaceProtocol}
            </div>
            <EditorToolbarButton
              disabled={!activeTab}
              icon={<Search className="h-3.5 w-3.5" />}
              label="查找"
              onClick={() => runEditorAction("actions.find")}
            />
            <EditorToolbarButton
              disabled={!activeTab}
              icon={<Search className="h-3.5 w-3.5" />}
              label="替换"
              onClick={() =>
                runEditorAction("editor.action.startFindReplaceAction")
              }
            />
            <EditorToolbarButton
              disabled={!activeTab || activeTab.loading}
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="重新加载"
              onClick={() => activePath && void reloadFile(activePath)}
            />
            {hasConflict ? (
              <EditorToolbarButton
                disabled={!activeTab?.error || activeTab.saving}
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                label="覆盖保存"
                onClick={() => activePath && void saveFile(activePath, true)}
              />
            ) : null}
            <Button
              className="h-8 rounded-md px-2 text-xs"
              disabled={
                !activeTab ||
                activeTab.loading ||
                activeTab.saving ||
                activeTab.readonly ||
                !isDirtyTab(activeTab)
              }
              onClick={() => activePath && void saveFile(activePath)}
              size="sm"
              type="button"
              variant="primary"
            >
              {activeTab?.saving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              保存
            </Button>
          </div>

          <div className="min-h-0 flex-1 bg-zinc-950">
            {activeTab ? (
              activeTab.loading ? (
                <div
                  className={cn(
                    "flex items-center justify-center text-sm text-zinc-400",
                    expanded ? "h-full min-h-[360px]" : "h-[460px]",
                  )}
                >
                  正在打开 {activeTab.name}...
                </div>
              ) : (
                <Editor
                  beforeMount={configureKerminalMonaco}
                  height={expanded ? "100%" : "460px"}
                  language={activeTab.language}
                  onChange={(value) => {
                    if (!activePath) {
                      return;
                    }
                    setTab(activePath, (tab) => ({
                      ...tab,
                      content: value ?? "",
                      error: null,
                    }));
                  }}
                  onMount={handleEditorMount}
                  options={{
                    automaticLayout: true,
                    fontFamily:
                      "JetBrains Mono, SFMono-Regular, Consolas, monospace",
                    fontSize: 13,
                    minimap: { enabled: true },
                    padding: { bottom: 12, top: 12 },
                    readOnly: activeTab.readonly,
                    renderLineHighlight: "all",
                    renderWhitespace: "selection",
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    tabSize: 2,
                    wordWrap: "on",
                  }}
                  path={activeTab.path}
                  theme="kerminal-dark"
                  value={activeTab.content}
                />
              )
            ) : (
              <div
                className={cn(
                  "flex items-center justify-center text-sm text-zinc-400",
                  expanded ? "h-full min-h-[360px]" : "h-[460px]",
                )}
              >
                从左侧选择文件
              </div>
            )}
          </div>

          <div className="flex min-h-9 flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{tabs.length} 标签</span>
            <span>{dirtyTabCount} 未保存</span>
            {activeTab ? (
              <>
                <span>{activeTab.language}</span>
                <span>{activeTab.lineEnding}</span>
                <span>{activeTab.encoding}</span>
                {activeTab.readonly ? (
                  <span className="text-amber-600 dark:text-amber-300">
                    只读
                  </span>
                ) : null}
              </>
            ) : null}
            <WorkspaceInlineStatus status={activeTabStatus(activeTab)} />
          </div>
        </div>
      </div>
    </section>

    <ModalShell
      description={pendingCloseTab?.path}
      footer={
        <>
          <Button
            onClick={() => setPendingClosePath(null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            取消
          </Button>
          <Button
            onClick={() => {
              if (pendingClosePath) {
                closeTabNow(pendingClosePath);
              }
              setPendingClosePath(null);
            }}
            size="sm"
            type="button"
            variant="danger"
          >
            放弃修改
          </Button>
          <Button
            onClick={async () => {
              if (!pendingClosePath) {
                return;
              }
              const saved = await saveFile(pendingClosePath);
              if (saved) {
                closeTabNow(pendingClosePath);
                setPendingClosePath(null);
              }
            }}
            size="sm"
            type="button"
            variant="primary"
          >
            <Save className="h-4 w-4" />
            保存后关闭
          </Button>
        </>
      }
      onClose={() => setPendingClosePath(null)}
      open={Boolean(pendingCloseTab)}
      size="small"
      title="关闭未保存文件"
    >
      <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
        当前文件有未保存修改。
      </div>
    </ModalShell>
    </>
  );
}

function WorkspaceTreeRow({
  activePath,
  node,
  onLoadChildren,
  onOpenFile,
  style,
}: {
  activePath: string | null;
  node: NodeApi<WorkspaceTreeNode>;
  onLoadChildren: (path: string) => void;
  onOpenFile: (path: string) => void;
  style: CSSProperties;
}) {
  const item = node.data;
  const isDirectory = item.kind === "directory";
  const selected = activePath === item.path;
  const Icon = isDirectory ? (node.isOpen ? FolderOpen : Folder) : FileText;

  return (
    <button
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 px-2 text-left text-xs transition",
        selected
          ? "bg-[var(--surface-selected)] text-sky-800 dark:text-sky-100"
          : "text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
      )}
      onClick={() => {
        if (isDirectory) {
          node.toggle();
          if (!item.loaded && !item.loading) {
            onLoadChildren(item.path);
          }
          return;
        }
        onOpenFile(item.path);
      }}
      style={style}
      title={item.path}
      type="button"
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isDirectory
            ? "text-sky-600 dark:text-sky-300"
            : "text-zinc-400 dark:text-zinc-500",
          item.loading && "animate-pulse",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {item.error ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
      ) : null}
    </button>
  );
}

function EditorToolbarButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-8 rounded-md px-2 text-xs"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {icon}
      {label}
    </Button>
  );
}

function WorkspaceInlineStatus({
  status,
}: {
  status: RemoteWorkspaceStatus | null;
}) {
  if (!status) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 truncate rounded-md border px-2 py-0.5",
        status.kind === "success" &&
          "border-emerald-300/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
        status.kind === "error" &&
          "border-rose-300/35 bg-rose-500/10 text-rose-700 dark:text-rose-100",
        status.kind === "info" &&
          "border-sky-300/35 bg-sky-500/10 text-sky-700 dark:text-sky-100",
      )}
      role={status.kind === "error" ? "alert" : "status"}
    >
      {status.kind === "success" ? <Check className="h-3 w-3" /> : null}
      {status.kind === "error" ? <AlertTriangle className="h-3 w-3" /> : null}
      <span className="truncate">{status.message}</span>
    </span>
  );
}
