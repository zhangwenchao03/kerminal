import { FileText, FolderOpen, RefreshCw, Save, X } from "lucide-react";
import type { Dispatch, MouseEvent, SetStateAction } from "react";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import { cn } from "../../../lib/cn";
import type { MonacoTextEditorMountHandler } from "../MonacoTextEditor";
import { RemoteWorkspaceEditorContextMenu } from "../RemoteWorkspaceEditorContextMenu";
import {
  RemoteWorkspaceDocumentPane,
  WorkspaceInlineStatus,
  WorkspaceTreeRow,
} from "../RemoteWorkspaceEditorParts";
import type {
  OpenFileTab,
  RemoteWorkspaceStatus,
  WorkspaceTreeNode,
} from "../remoteWorkspaceEditorModel";
import { isDirtyTab, treeFileCount } from "../remoteWorkspaceEditorModel";
import type {
  RemoteWorkspaceEditorCommandId,
  RemoteWorkspaceEditorCommandItem,
} from "../remoteWorkspaceEditorCommandModel";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";

type RemoteWorkspaceEditorViewProps = {
  activePath: string | null;
  activeTab: OpenFileTab | null;
  dirtyTabCount: number;
  closeTabNow: (path: string) => void;
  editorCommandGroups: RemoteWorkspaceEditorCommandItem[][];
  editorContextMenu: { x: number; y: number } | null;
  editorFontOptions: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
  };
  expanded: boolean;
  hasConflict: boolean;
  handleEditorMount: MonacoTextEditorMountHandler;
  loadChildren: (path: string, replaceRoot?: boolean) => Promise<void>;
  onEditorContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  openFile: (path: string) => Promise<void>;
  openTreePaths: Set<string>;
  openWorkspaceFolder: () => Promise<void>;
  pendingClosePath: string | null;
  pendingCloseTab: OpenFileTab | null;
  reloadFile: (path: string) => Promise<void>;
  requestCloseTab: (path: string) => void;
  rootDraft: string;
  runEditorAction: (actionId: string) => void;
  runWorkspaceEditorCommand: (
    command: RemoteWorkspaceEditorCommandId,
  ) => Promise<void>;
  saveFile: (path: string, overwriteOnConflict?: boolean) => Promise<boolean>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setEditorContextMenu: Dispatch<
    SetStateAction<{ x: number; y: number } | null>
  >;
  setPendingClosePath: Dispatch<SetStateAction<string | null>>;
  setRootDraft: Dispatch<SetStateAction<string>>;
  setTab: (path: string, updater: (tab: OpenFileTab) => OpenFileTab) => void;
  tabs: OpenFileTab[];
  toggleTreeDirectory: (item: WorkspaceTreeNode) => void;
  treeNodes: WorkspaceTreeNode[];
  treeStatus: RemoteWorkspaceStatus | null;
  unsupportedNotice: UserFacingMessage | null;
  workspaceProtocol: string;
  workspaceRoot: string;
};

/** 远程工作区编辑器的纯视图层；状态与异步资源生命周期仍由入口控制器持有。 */
export function RemoteWorkspaceEditorView({
  activePath,
  activeTab,
  closeTabNow,
  dirtyTabCount,
  editorCommandGroups,
  editorContextMenu,
  editorFontOptions,
  expanded,
  handleEditorMount,
  hasConflict,
  loadChildren,
  onEditorContextMenu,
  openFile,
  openTreePaths,
  openWorkspaceFolder,
  pendingClosePath,
  pendingCloseTab,
  reloadFile,
  requestCloseTab,
  rootDraft,
  runEditorAction,
  runWorkspaceEditorCommand,
  saveFile,
  setActivePath,
  setEditorContextMenu,
  setPendingClosePath,
  setRootDraft,
  setTab,
  tabs,
  toggleTreeDirectory,
  treeNodes,
  treeStatus,
  unsupportedNotice,
  workspaceProtocol,
  workspaceRoot,
}: RemoteWorkspaceEditorViewProps) {
  const visibleTreeRows = flattenWorkspaceTreeRows(treeNodes, openTreePaths);

  return (
    <>
      <section
        className={cn(
          "kerminal-solid-surface overflow-hidden rounded-[var(--radius-card)] border",
          expanded && "flex h-full min-h-0 flex-col",
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
            <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">工作区</span>
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
            <Button className="h-8 rounded-md px-2 text-xs" onClick={() => void openWorkspaceFolder()} size="sm" type="button" variant="ghost">
              <FolderOpen className="h-3.5 w-3.5" />打开文件夹
            </Button>
            <Button aria-label="刷新工作区树" className="h-8 w-8 rounded-md px-0" onClick={() => void loadChildren(workspaceRoot, true)} size="sm" title="刷新工作区树" type="button" variant="ghost">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className={cn("grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]", expanded ? "min-h-0 flex-1" : "min-h-[560px]")}>
          <aside className={cn("kerminal-muted-surface min-h-0 border-b border-[var(--border-subtle)] lg:border-b-0 lg:border-r", expanded && "flex flex-col")}>
            <div className="flex h-9 items-center justify-between border-b border-[var(--border-subtle)] px-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="truncate font-mono">{workspaceRoot}</span>
              <span>{treeFileCount(treeNodes)} 文件</span>
            </div>
            <div className={cn("overflow-y-auto py-1", expanded ? "min-h-0 flex-1" : "h-[460px]")} role="tree" aria-label="远程工作区树">
              {visibleTreeRows.map(({ depth, node }) => (
                <WorkspaceTreeRow activePath={activePath} depth={depth} isOpen={depth === 0 || openTreePaths.has(node.path)} key={node.path} node={node} onOpenFile={(path) => void openFile(path)} onToggleDirectory={toggleTreeDirectory} />
              ))}
            </div>
            <WorkspaceInlineStatus status={treeStatus} />
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="flex min-h-10 items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] px-2">
              {tabs.length === 0 ? <div className="px-2 text-xs text-zinc-500 dark:text-zinc-400">未打开文件</div> : tabs.map((tab) => (
                <button className={cn("kerminal-focus-ring kerminal-pressable flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs transition", activePath === tab.path ? "border-sky-400/35 bg-[var(--surface-selected)] text-sky-800 dark:text-sky-100" : "border-transparent text-zinc-600 hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] dark:text-zinc-300")} key={tab.path} onClick={() => setActivePath(tab.path)} title={tab.path} type="button">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.name}</span>
                  {isDirtyTab(tab) ? <span aria-label={`${tab.name} 未保存`} className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" /> : null}
                  <span aria-label={`关闭 ${tab.name}`} className="kerminal-focus-ring kerminal-pressable rounded p-0.5 text-zinc-400 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:hover:text-zinc-100" onClick={(event) => { event.stopPropagation(); requestCloseTab(tab.path); }} role="button" tabIndex={0}>
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>

            <RemoteWorkspaceDocumentPane
              activeTab={activeTab}
              dirtyTabCount={dirtyTabCount}
              editorFontOptions={editorFontOptions}
              expanded={expanded}
              hasConflict={hasConflict}
              onChange={(value) => {
                if (activePath) setTab(activePath, (tab) => ({ ...tab, content: value, error: null }));
              }}
              onContextMenu={onEditorContextMenu}
              onFind={() => runEditorAction("actions.find")}
              onMount={handleEditorMount}
              onReload={() => activePath && void reloadFile(activePath)}
              onReplace={() => runEditorAction("editor.action.startFindReplaceAction")}
              onSave={(overwriteOnConflict) => activePath && void saveFile(activePath, overwriteOnConflict)}
              tabsLength={tabs.length}
              unsupportedNotice={unsupportedNotice}
              workspaceProtocol={workspaceProtocol}
            />
          </div>
        </div>
      </section>

      {editorContextMenu && activeTab && !unsupportedNotice ? (
        <RemoteWorkspaceEditorContextMenu groups={editorCommandGroups} onAction={(command) => void runWorkspaceEditorCommand(command)} onClose={() => setEditorContextMenu(null)} position={editorContextMenu} title={activeTab.name} />
      ) : null}

      <ModalShell
        description={pendingCloseTab?.path}
        footer={<>
          <Button onClick={() => setPendingClosePath(null)} size="sm" type="button" variant="ghost">取消</Button>
          <Button onClick={() => { if (pendingClosePath) closeTabImmediately(pendingClosePath); }} size="sm" type="button" variant="danger">放弃修改</Button>
          <Button onClick={() => void saveAndClosePendingTab()} size="sm" type="button" variant="primary"><Save className="h-4 w-4" />保存后关闭</Button>
        </>}
        onClose={() => setPendingClosePath(null)} open={Boolean(pendingCloseTab)} size="small" title="关闭未保存文件"
      >
        <div className="rounded-[var(--radius-control)] border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">当前文件有未保存修改。</div>
      </ModalShell>
    </>
  );

  function closeTabImmediately(path: string) {
    closeTabNow(path);
    setPendingClosePath(null);
  }

  async function saveAndClosePendingTab() {
    if (!pendingClosePath) return;
    if (await saveFile(pendingClosePath)) {
      closeTabNow(pendingClosePath);
      setPendingClosePath(null);
    }
  }
}

type WorkspaceTreeRenderRow = { depth: number; node: WorkspaceTreeNode };

function flattenWorkspaceTreeRows(nodes: WorkspaceTreeNode[], openPaths: Set<string>, depth = 0): WorkspaceTreeRenderRow[] {
  return nodes.flatMap((node) => {
    const row = { depth, node };
    if (node.kind !== "directory" || (depth !== 0 && !openPaths.has(node.path)) || !node.children?.length) return [row];
    return [row, ...flattenWorkspaceTreeRows(node.children, openPaths, depth + 1)];
  });
}
