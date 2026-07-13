// @author kongweiguang

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
} from "lucide-react";
import type {
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Button } from "../../components/ui/button";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import { configureKerminalMonaco } from "../../lib/monacoTheme";
import type { UserFacingMessage } from "../../lib/userFacingMessage";
import {
  MonacoTextEditor,
  type MonacoTextEditorMountHandler,
} from "./MonacoTextEditor";
import type {
  OpenFileTab,
  RemoteWorkspaceStatus,
  WorkspaceTreeNode,
} from "./remoteWorkspaceEditorModel";
import { activeTabStatus, isDirtyTab } from "./remoteWorkspaceEditorModel";

export function WorkspaceTreeRow({
  activePath,
  depth,
  isOpen,
  node,
  onContextMenu,
  onContextMenuFromPress,
  onOpenFile,
  onToggleDirectory,
}: {
  activePath: string | null;
  depth: number;
  isOpen: boolean;
  node: WorkspaceTreeNode;
  onContextMenu?: (
    event: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
    item: WorkspaceTreeNode,
  ) => void;
  onContextMenuFromPress?: (
    event: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
    item: WorkspaceTreeNode,
  ) => void;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (item: WorkspaceTreeNode) => void;
}) {
  const isDirectory = node.kind === "directory";
  const selected = activePath === node.path;
  const Icon = isDirectory ? (isOpen ? FolderOpen : Folder) : FileText;

  return (
    <button
      aria-expanded={isDirectory ? isOpen : undefined}
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex h-8 w-full items-center gap-2 px-2 text-left text-xs transition",
        selected
          ? "bg-[var(--surface-selected)] text-sky-800 dark:text-sky-100"
          : "text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
      )}
      onClick={() => {
        if (isDirectory) {
          onToggleDirectory(node);
          return;
        }
        onOpenFile(node.path);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) {
          return;
        }
        event.stopPropagation();
        onContextMenu(event, node);
      }}
      onMouseDown={(event) => {
        if (!onContextMenuFromPress) {
          return;
        }
        event.stopPropagation();
        onContextMenuFromPress(event, node);
      }}
      onPointerDown={(event) => {
        if (!onContextMenuFromPress) {
          return;
        }
        event.stopPropagation();
        onContextMenuFromPress(event, node);
      }}
      role="treeitem"
      style={{ paddingLeft: 8 + depth * 18 }}
      title={node.path}
      type="button"
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isDirectory
            ? "text-sky-600 dark:text-sky-300"
            : "text-zinc-400 dark:text-zinc-500",
          node.loading && "animate-pulse",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {node.error ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
      ) : null}
    </button>
  );
}

export function EditorToolbarButton({
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

/** 远程工作区的文档工具栏、提示态和 Monaco 展示区。 */
export function RemoteWorkspaceDocumentPane({
  activeTab,
  dirtyTabCount,
  editorFontOptions,
  expanded,
  hasConflict,
  onChange,
  onContextMenu,
  onFind,
  onMount,
  onReload,
  onReplace,
  onSave,
  tabsLength,
  unsupportedNotice,
  workspaceProtocol,
}: {
  activeTab: OpenFileTab | null;
  dirtyTabCount: number;
  editorFontOptions: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
  };
  expanded: boolean;
  hasConflict: boolean;
  onChange: (value: string) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onFind: () => void;
  onMount: MonacoTextEditorMountHandler;
  onReload: () => void;
  onReplace: () => void;
  onSave: (overwriteOnConflict: boolean) => void;
  tabsLength: number;
  unsupportedNotice: UserFacingMessage | null;
  workspaceProtocol: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {activeTab?.path ?? workspaceProtocol}
        </div>
        <EditorToolbarButton
          disabled={
            !activeTab || activeTab.loading || Boolean(unsupportedNotice)
          }
          icon={<Search className="h-3.5 w-3.5" />}
          label="查找"
          onClick={onFind}
        />
        <EditorToolbarButton
          disabled={
            !activeTab ||
            activeTab.loading ||
            activeTab.readonly ||
            Boolean(unsupportedNotice)
          }
          icon={<Search className="h-3.5 w-3.5" />}
          label="替换"
          onClick={onReplace}
        />
        <EditorToolbarButton
          disabled={
            !activeTab ||
            activeTab.loading ||
            activeTab.saving ||
            Boolean(unsupportedNotice)
          }
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label="重新加载"
          onClick={onReload}
        />
        {hasConflict ? (
          <EditorToolbarButton
            disabled={!activeTab?.error || activeTab.saving}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="覆盖保存"
            onClick={() => onSave(true)}
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
          onClick={() => onSave(false)}
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

      <div
        className={cn(
          "min-h-0 flex-1",
          unsupportedNotice ? "kerminal-muted-surface" : "bg-zinc-950",
        )}
        data-kerminal-text-editor
        onContextMenu={onContextMenu}
      >
        {unsupportedNotice ? (
          <div
            className={cn(
              "grid place-items-center p-4",
              expanded ? "h-full min-h-[360px]" : "h-[460px]",
            )}
          >
            <UserFacingNotice
              className="w-full max-w-md"
              compact
              message={unsupportedNotice}
            />
          </div>
        ) : activeTab ? (
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
            <MonacoTextEditor
              beforeMount={configureKerminalMonaco}
              height={expanded ? "100%" : "460px"}
              language={activeTab.language}
              onChange={(value) => onChange(value ?? "")}
              onMount={onMount}
              options={{
                automaticLayout: true,
                contextmenu: false,
                fontFamily: editorFontOptions.fontFamily,
                fontSize: editorFontOptions.fontSize,
                fontWeight: editorFontOptions.fontWeight,
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
        <span>{tabsLength} 标签</span>
        <span>{dirtyTabCount} 未保存</span>
        {activeTab && !unsupportedNotice ? (
          <>
            <span>{activeTab.language}</span>
            <span>{activeTab.lineEnding}</span>
            <span>{activeTab.encoding}</span>
            {activeTab.readonly ? (
              <span className="text-amber-600 dark:text-amber-300">只读</span>
            ) : null}
          </>
        ) : unsupportedNotice ? (
          <span>不可预览</span>
        ) : null}
        <WorkspaceInlineStatus status={activeTabStatus(activeTab)} />
      </div>
    </>
  );
}

export function WorkspaceInlineStatus({
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
