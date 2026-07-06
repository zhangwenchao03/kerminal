import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type * as Monaco from "monaco-editor";
import {
  AlertTriangle,
  FileText,
  RefreshCw,
  Replace,
  Save,
  Search,
} from "lucide-react";
import {
  KERMINAL_TEXT_EDIT_COMMAND_EVENT,
  type KerminalTextEditCommandEventDetail,
} from "../../app/appKeybindingPolicy";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { configureKerminalMonaco } from "../../lib/monacoTheme";
import type { RemoteTargetRef } from "../../lib/targetModel";
import { defaultTerminalAppearance } from "../settings/settingsDefaults";
import {
  terminalFontWeightValue,
  type TerminalAppearance,
} from "../settings/settingsModel";
import {
  MonacoTextEditor,
  type MonacoTextEditorMountHandler,
} from "../sftp/MonacoTextEditor";
import {
  activeTabStatus,
  applyReloadError,
  applyReloadSuccess,
  applySaveError,
  applySaveSuccess,
  cleanSaveStatus,
  createLoadedTab,
  createLoadingTab,
  errorMessage,
  isDirtyTab,
  readonlySaveStatus,
  startReloadingTab,
  startSavingTab,
  type OpenFileTab,
  type RemoteWorkspaceStatus,
} from "../sftp/remoteWorkspaceEditorModel";
import {
  buildRemoteWorkspaceEditorCommandGroups,
  isRemoteWorkspaceEditorCommandEnabled,
  resolveRemoteWorkspaceEditorContextMenuPosition,
  type RemoteWorkspaceEditorCommandId,
} from "../sftp/remoteWorkspaceEditorCommandModel";
import {
  editorShouldHandleNativeTextEdit,
  registerRemoteWorkspaceEditorKeybindings,
  runRemoteWorkspaceEditorMonacoCommand,
} from "../sftp/remoteWorkspaceEditorCommandRuntime";
import { RemoteWorkspaceEditorContextMenu } from "../sftp/RemoteWorkspaceEditorContextMenu";
import {
  readRemoteWorkspaceTextFile,
  writeRemoteWorkspaceTextFile,
  type RemoteWorkspaceReadTextFileResponse,
} from "../sftp/remoteWorkspaceEditorTransport";
import {
  WORKSPACE_FILE_TAB_COMMAND_EVENT,
  type WorkspaceFileTabCommandEventDetail,
} from "./workspaceFileTabActions";
import type { WorkspaceFileTab } from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface WorkspaceFileTabSurfaceProps {
  active: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  tab: WorkspaceFileTab;
  terminalAppearance?: TerminalAppearance;
}

export function WorkspaceFileTabSurface({
  active,
  onDirtyChange,
  tab,
  terminalAppearance = defaultTerminalAppearance,
}: WorkspaceFileTabSurfaceProps) {
  const [fileTab, setFileTab] = useState<OpenFileTab | null>(null);
  const [status, setStatus] = useState<RemoteWorkspaceStatus | null>(null);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const requestIdRef = useRef(0);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const runEditorCommandRef = useRef<
    (command: RemoteWorkspaceEditorCommandId) => void
  >(() => undefined);
  const targetLabel = useMemo(
    () => labelForWorkspaceFileTarget(tab.target),
    [tab.target],
  );
  const dirty = fileTab ? isDirtyTab(fileTab) : false;
  const hasConflict =
    fileTab?.error?.includes("远端文件已变更") ||
    fileTab?.error?.includes("conflict");
  const readonly = fileTab?.readonly ?? tab.access === "readonly";
  const editorCommandState = useMemo(
    () => ({
      dirty,
      hasConflict: Boolean(hasConflict),
      hasEditor: Boolean(fileTab && !fileTab.loading),
      loading: Boolean(fileTab?.loading),
      readOnly: readonly,
      saving: Boolean(fileTab?.saving),
    }),
    [dirty, fileTab, hasConflict, readonly],
  );
  const editorCommandGroups = useMemo(
    () => buildRemoteWorkspaceEditorCommandGroups(editorCommandState),
    [editorCommandState],
  );
  const editorFontOptions = useMemo(
    () => ({
      fontFamily: terminalAppearance.fontFamily,
      fontSize: terminalAppearance.fontSize,
      fontWeight: String(terminalFontWeightValue(terminalAppearance.fontWeight)),
    }),
    [
      terminalAppearance.fontFamily,
      terminalAppearance.fontSize,
      terminalAppearance.fontWeight,
    ],
  );

  const loadFile = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus(null);
    setFileTab(createLoadingTab(tab.path));
    try {
      const response = await readRemoteWorkspaceTextFile({
        maxBytes: MAX_FILE_BYTES,
        path: tab.path,
        target: tab.target,
      });
      if (requestIdRef.current !== requestId) {
        return;
      }
      setFileTab(createWorkspaceLoadedTab(tab, response));
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      const message = errorMessage(error);
      setFileTab({
        ...createLoadingTab(tab.path),
        error: message,
        loading: false,
        readonly: true,
      });
      setStatus({ kind: "error", message });
    }
  }, [tab.path, tab.target]);

  const saveFile = useCallback(
    async (overwriteOnConflict = false) => {
      if (!fileTab || fileTab.loading || fileTab.saving) {
        return false;
      }
      const readonlyStatus = readonlySaveStatus(fileTab);
      if (readonlyStatus) {
        setFileTab((current) =>
          current ? { ...current, error: readonlyStatus.message } : current,
        );
        setStatus(readonlyStatus);
        return false;
      }
      const cleanStatus = cleanSaveStatus(fileTab, overwriteOnConflict);
      if (cleanStatus) {
        setStatus(cleanStatus);
        return true;
      }

      setFileTab(startSavingTab(fileTab));
      try {
        const response = await writeRemoteWorkspaceTextFile({
          content: fileTab.content,
          expectedRevision: fileTab.revision,
          overwriteOnConflict,
          path: tab.path,
          target: tab.target,
        });
        setFileTab((current) =>
          current ? applySaveSuccess(current, response) : current,
        );
        setStatus({ kind: "success", message: `已保存：${tab.path}` });
        return true;
      } catch (error) {
        const message = errorMessage(error);
        setFileTab((current) =>
          current ? applySaveError(current, message) : current,
        );
        setStatus({ kind: "error", message });
        return false;
      }
    },
    [fileTab, tab.path, tab.target],
  );

  const reloadFile = useCallback(async () => {
    if (!fileTab || fileTab.loading) {
      await loadFile();
      return;
    }
    setStatus(null);
    setFileTab(startReloadingTab(fileTab));
    try {
      const response = await readRemoteWorkspaceTextFile({
        maxBytes: MAX_FILE_BYTES,
        path: tab.path,
        target: tab.target,
      });
      setFileTab((current) =>
        current
          ? normalizeLoadedAccess(tab, applyReloadSuccess(current, response))
          : current,
      );
      setStatus({ kind: "info", message: `已重新加载：${tab.path}` });
    } catch (error) {
      const message = errorMessage(error);
      setFileTab((current) =>
        current ? applyReloadError(current, message) : current,
      );
      setStatus({ kind: "error", message });
    }
  }, [fileTab, loadFile, tab]);

  const runEditorCommand = useCallback(
    async (command: RemoteWorkspaceEditorCommandId) => {
      setEditorContextMenu(null);
      if (
        !isRemoteWorkspaceEditorCommandEnabled(command, editorCommandState)
      ) {
        return;
      }

      if (command === "save") {
        await saveFile(Boolean(hasConflict));
        return;
      }
      if (command === "reload") {
        await reloadFile();
        return;
      }
      await runRemoteWorkspaceEditorMonacoCommand(editorRef.current, command);
    },
    [editorCommandState, hasConflict, reloadFile, saveFile],
  );

  const handleEditorMount = useCallback<MonacoTextEditorMountHandler>(
    (editor, monaco) => {
      editorRef.current = editor;
      registerRemoteWorkspaceEditorKeybindings({
        editor,
        monaco,
        runCommand: (command) => runEditorCommandRef.current(command),
      });
    },
    [],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    void loadFile();
  }, [active, loadFile]);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    setFileTab(null);
    setStatus(null);
    onDirtyChangeRef.current?.(false);
  }, [tab.id, tab.path]);

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => () => onDirtyChangeRef.current?.(false), []);

  useEffect(() => {
    runEditorCommandRef.current = (command) => {
      void runEditorCommand(command);
    };
  }, [runEditorCommand]);

  useEffect(() => {
    const handleTextEditCommand = (event: Event) => {
      const detail = (event as CustomEvent<KerminalTextEditCommandEventDetail>)
        .detail;
      if (!detail || !editorShouldHandleNativeTextEdit(editorRef.current)) {
        return;
      }

      detail.handled = true;
      runEditorCommandRef.current(detail.command);
    };

    window.addEventListener(
      KERMINAL_TEXT_EDIT_COMMAND_EVENT,
      handleTextEditCommand,
    );
    return () => {
      window.removeEventListener(
        KERMINAL_TEXT_EDIT_COMMAND_EVENT,
        handleTextEditCommand,
      );
    };
  }, []);

  useEffect(() => {
    const handleWorkspaceFileCommand = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceFileTabCommandEventDetail>)
        .detail;
      if (!detail || detail.tabId !== tab.id) {
        return;
      }
      if (detail.command === "reload") {
        void reloadFile();
      }
    };

    window.addEventListener(
      WORKSPACE_FILE_TAB_COMMAND_EVENT,
      handleWorkspaceFileCommand,
    );
    return () => {
      window.removeEventListener(
        WORKSPACE_FILE_TAB_COMMAND_EVENT,
        handleWorkspaceFileCommand,
      );
    };
  }, [reloadFile, tab.id]);

  const inlineStatus = activeTabStatus(fileTab) ?? status;
  const openEditorContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!fileTab || fileTab.loading) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setEditorContextMenu(
        resolveRemoteWorkspaceEditorContextMenuPosition({
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          x: event.clientX,
          y: event.clientY,
        }),
      );
    },
    [fileTab],
  );

  return (
    <>
      <section
        aria-label={`文件 ${tab.title}`}
        className="kerminal-solid-surface flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border text-zinc-900 dark:text-zinc-100"
        data-testid="workspace-file-tab-surface"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-300">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{tab.title}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {targetLabel} · {tab.path}
            </div>
          </div>
          <Button
            aria-label="重新加载文件"
            className="h-8 rounded-md px-2 text-xs"
            disabled={fileTab?.loading || fileTab?.saving}
            onClick={() => void reloadFile()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", fileTab?.loading && "animate-spin")}
            />
            重新加载
          </Button>
          {hasConflict ? (
            <Button
              className="h-8 rounded-md px-2 text-xs"
              disabled={!fileTab || fileTab.saving}
              onClick={() => void saveFile(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              覆盖保存
            </Button>
          ) : null}
          <Button
            className="h-8 rounded-md px-2 text-xs"
            disabled={
              !fileTab || fileTab.loading || fileTab.saving || readonly || !dirty
            }
            onClick={() => void saveFile()}
            size="sm"
            type="button"
            variant="primary"
          >
            {fileTab?.saving ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            保存
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {!fileTab || fileTab.loading ? (
            <WorkspaceFileMessage
              icon={<RefreshCw className="h-4 w-4 animate-spin" />}
              message="正在读取文件..."
            />
          ) : fileTab.error && !fileTab.content ? (
            <WorkspaceFileMessage
              action={
                <Button
                  className="h-8 rounded-md px-2 text-xs"
                  onClick={() => void loadFile()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  重试
                </Button>
              }
              icon={<AlertTriangle className="h-4 w-4" />}
              message={fileTab.error}
              tone="danger"
            />
          ) : (
            <WorkspaceFileEditorContent
              editorFontOptions={editorFontOptions}
              inlineStatus={inlineStatus}
              onChange={(value) =>
                setFileTab((current) =>
                  current
                    ? { ...current, content: value, error: null }
                    : current,
                )
              }
              onContextMenu={openEditorContextMenu}
              onFind={() => runEditorCommandRef.current("find")}
              onMount={handleEditorMount}
              onReplace={() => runEditorCommandRef.current("replace")}
              tab={fileTab}
            />
          )}
        </div>
      </section>
      {editorContextMenu && fileTab ? (
        <RemoteWorkspaceEditorContextMenu
          groups={editorCommandGroups}
          onAction={(command) => void runEditorCommand(command)}
          onClose={() => setEditorContextMenu(null)}
          position={editorContextMenu}
          title={fileTab.name}
        />
      ) : null}
    </>
  );
}

function WorkspaceFileEditorContent({
  editorFontOptions,
  inlineStatus,
  onChange,
  onContextMenu,
  onFind,
  onMount,
  onReplace,
  tab,
}: {
  editorFontOptions: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
  };
  inlineStatus: RemoteWorkspaceStatus | null;
  onChange: (value: string) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onFind: () => void;
  onMount: MonacoTextEditorMountHandler;
  onReplace: () => void;
  tab: OpenFileTab;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="kerminal-muted-surface flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>{tab.language}</span>
        <span>{tab.lineEnding}</span>
        <span>{tab.encoding}</span>
        {tab.truncated ? <span>已截断</span> : null}
        {tab.readonly ? <span>只读</span> : null}
        <span>{isDirtyTab(tab) ? "未保存" : "已保存"}</span>
        {inlineStatus ? (
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-1 truncate rounded-md border px-2 py-0.5",
              inlineStatus.kind === "success" &&
                "border-emerald-300/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
              inlineStatus.kind === "error" &&
                "border-rose-300/35 bg-rose-500/10 text-rose-700 dark:text-rose-100",
              inlineStatus.kind === "info" &&
                "border-sky-300/35 bg-sky-500/10 text-sky-700 dark:text-sky-100",
            )}
            role={inlineStatus.kind === "error" ? "alert" : "status"}
          >
            {inlineStatus.message}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <Button
            className="h-7 rounded-md px-2 text-[11px]"
            onClick={onFind}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Search className="h-3 w-3" />
            查找
          </Button>
          <Button
            className="h-7 rounded-md px-2 text-[11px]"
            disabled={tab.readonly}
            onClick={onReplace}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Replace className="h-3 w-3" />
            替换
          </Button>
        </span>
      </div>
      <div
        className="min-h-0 flex-1 bg-zinc-950"
        data-kerminal-text-editor
        onContextMenu={onContextMenu}
      >
        <MonacoTextEditor
          beforeMount={configureKerminalMonaco}
          height="100%"
          language={tab.language}
          onChange={onChange}
          onMount={onMount}
          options={{
            automaticLayout: true,
            contextmenu: false,
            fontFamily: editorFontOptions.fontFamily,
            fontSize: editorFontOptions.fontSize,
            fontWeight: editorFontOptions.fontWeight,
            minimap: { enabled: true },
            padding: { bottom: 12, top: 12 },
            readOnly: tab.readonly,
            renderLineHighlight: "all",
            renderWhitespace: "selection",
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            tabSize: 2,
            wordWrap: "on",
          }}
          path={tab.path}
          theme="kerminal-dark"
          value={tab.content}
        />
      </div>
    </div>
  );
}

function WorkspaceFileMessage({
  action,
  icon,
  message,
  tone = "muted",
}: {
  action?: ReactNode;
  icon: ReactNode;
  message: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 items-center justify-center gap-3 px-4 text-sm",
        tone === "danger"
          ? "text-rose-700 dark:text-rose-300"
          : "text-zinc-500 dark:text-zinc-400",
      )}
    >
      {icon}
      <span>{message}</span>
      {action}
    </div>
  );
}

function labelForWorkspaceFileTarget(target: RemoteTargetRef): string {
  if (target.kind === "dockerContainer") {
    return `${target.runtime ?? "docker"}:${target.hostId}:${target.containerName ?? target.containerId}`;
  }
  if (target.kind === "ssh") {
    return `ssh:${target.hostId}`;
  }
  if (target.kind === "local") {
    return target.profileId ? `local:${target.profileId}` : "local";
  }
  return `${target.kind}:${target.hostId}`;
}

function createWorkspaceLoadedTab(
  workspaceTab: WorkspaceFileTab,
  response: RemoteWorkspaceReadTextFileResponse,
) {
  return normalizeLoadedAccess(
    workspaceTab,
    createLoadedTab(workspaceTab.path, response),
  );
}

function normalizeLoadedAccess(
  workspaceTab: WorkspaceFileTab,
  fileTab: OpenFileTab,
): OpenFileTab {
  if (workspaceTab.access === "editable") {
    return fileTab;
  }
  return {
    ...fileTab,
    readonly: true,
  };
}
