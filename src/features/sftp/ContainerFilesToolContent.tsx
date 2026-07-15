import {
  ChevronUp,
  Download,
  Edit3,
  File,
  Folder,
  FolderPlus,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import { PromptDialog } from "../../components/ui/prompt-dialog";
import { cn } from "../../lib/cn";
import {
  chmodDockerContainerPath,
  createDockerContainerDirectory,
  deleteDockerContainerPath,
  downloadDockerContainerPath,
  fileNameFromPath,
  joinRemotePath,
  listDockerContainerDirectory,
  normalizeRemotePath,
  parentRemotePath,
  previewDockerContainerFile,
  renameDockerContainerPath,
  uploadDockerContainerPath,
} from "../../lib/containerFilesApi";
import {
  selectLocalDirectory,
  selectLocalFile,
  selectSaveFile,
} from "../../lib/fileDialogApi";
import type { SftpEntry, SftpTransferKind } from "../../lib/sftpApi";
import type { RemoteTargetRef } from "../../lib/targetModel";
import type { Machine } from "../workspace/contracts/index";

const LazyRemoteFilePreviewEditor = lazy(async () => {
  const module = await import("./RemoteFilePreviewEditor");
  return { default: module.RemoteFilePreviewEditor };
});

interface ContainerFilesToolContentProps {
  followedRemotePath?: string;
  selectedMachine?: Machine;
}

type OperationState = {
  kind: "idle" | "loading" | "running";
  message?: string;
};

type ContainerFileDialog =
  | {
      kind: "mkdir";
      value: string;
    }
  | {
      entry: SftpEntry;
      kind: "rename";
      value: string;
    }
  | {
      entry: SftpEntry;
      kind: "chmod";
      value: string;
    }
  | {
      entry: SftpEntry;
      kind: "delete";
    };

export function ContainerFilesToolContent({
  followedRemotePath,
  selectedMachine,
}: ContainerFilesToolContentProps) {
  const target = useMemo(
    () => resolveContainerTarget(selectedMachine),
    [selectedMachine],
  );
  const initialPath =
    isFollowableRemotePath(followedRemotePath)
      ? followedRemotePath
      : target?.workdir || "/";
  const [path, setPath] = useState(() => normalizeRemotePath(initialPath));
  const [pathInput, setPathInput] = useState(() => normalizeRemotePath(path));
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<SftpEntry | null>(null);
  const [preview, setPreview] = useState<{
    entry: SftpEntry;
    content: string;
    truncated: boolean;
  } | null>(null);
  const [operation, setOperation] = useState<OperationState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [containerDialog, setContainerDialog] =
    useState<ContainerFileDialog | null>(null);

  useEffect(() => {
    if (target) {
      const nextPath = normalizeRemotePath(initialPath);
      setPath(nextPath);
      setPathInput(nextPath);
      setSelectedEntry(null);
      setPreview(null);
    }
  }, [initialPath, target]);

  const loadDirectory = useCallback(
    async (nextPath = path) => {
      if (!target) {
        return;
      }
      const normalizedPath = normalizeRemotePath(nextPath);
      setOperation({ kind: "loading" });
      setError(null);
      try {
        const listing = await listDockerContainerDirectory({
          containerId: target.containerId,
          hostId: target.hostId,
          path: normalizedPath,
          runtime: target.runtime,
        });
        setPath(listing.path);
        setPathInput(listing.path);
        setEntries(sortEntries(listing.entries));
        setSelectedEntry(null);
        setPreview(null);
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        setOperation({ kind: "idle" });
      }
    },
    [path, target],
  );

  useEffect(() => {
    void loadDirectory(path);
  }, [loadDirectory, path]);

  const runOperation = async (
    message: string,
    operation: () => Promise<void>,
  ) => {
    setOperation({ kind: "running", message });
    setError(null);
    try {
      await operation();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally {
      setOperation({ kind: "idle" });
    }
  };

  const openEntry = (entry: SftpEntry) => {
    if (entry.kind === "directory") {
      void loadDirectory(entry.path);
      return;
    }
    if (entry.kind === "file" || entry.kind === "symlink") {
      void previewEntry(entry);
    }
  };

  const previewEntry = async (entry: SftpEntry) => {
    if (!target) {
      return;
    }
    await runOperation("正在读取文件", async () => {
      const nextPreview = await previewDockerContainerFile({
        containerId: target.containerId,
        hostId: target.hostId,
        maxBytes: 128 * 1024,
        path: entry.path,
        runtime: target.runtime,
      });
      setPreview({
        content: nextPreview.content,
        entry,
        truncated: nextPreview.truncated,
      });
    });
  };

  const createDirectory = () => {
    if (!target) {
      return;
    }
    setContainerDialog({ kind: "mkdir", value: "" });
  };

  const confirmContainerDialog = async (value: string) => {
    if (!target || !containerDialog) {
      return;
    }

    if (containerDialog.kind === "mkdir") {
      const name = value.trim();
      if (!name) {
        return;
      }
      setContainerDialog(null);
      await runOperation("正在创建目录", async () => {
        await createDockerContainerDirectory({
          containerId: target.containerId,
          hostId: target.hostId,
          path: joinRemotePath(path, name),
          runtime: target.runtime,
        });
        await loadDirectory(path);
      });
      return;
    }

    if (containerDialog.kind === "rename") {
      const nextPath = value.trim();
      if (!nextPath) {
        return;
      }
      setContainerDialog(null);
      await runOperation("正在重命名", async () => {
        await renameDockerContainerPath({
          containerId: target.containerId,
          fromPath: containerDialog.entry.path,
          hostId: target.hostId,
          runtime: target.runtime,
          toPath: nextPath,
        });
        await loadDirectory(path);
      });
      return;
    }

    if (containerDialog.kind === "chmod") {
      const mode = value.trim();
      if (!mode) {
        return;
      }
      setContainerDialog(null);
      await runOperation("正在修改权限", async () => {
        await chmodDockerContainerPath({
          containerId: target.containerId,
          hostId: target.hostId,
          mode,
          path: containerDialog.entry.path,
          runtime: target.runtime,
        });
        await loadDirectory(path);
      });
      return;
    }

    setContainerDialog(null);
    await runOperation("正在删除", async () => {
      await deleteDockerContainerPath({
        containerId: target.containerId,
        directory: containerDialog.entry.kind === "directory",
        hostId: target.hostId,
        path: containerDialog.entry.path,
        runtime: target.runtime,
      });
      await loadDirectory(path);
    });
  };

  const uploadPath = async (kind: SftpTransferKind) => {
    if (!target) {
      return;
    }
    const localPath =
      kind === "file" ? await selectLocalFile() : await selectLocalDirectory();
    if (!localPath) {
      return;
    }
    await runOperation("正在上传", async () => {
      await uploadDockerContainerPath({
        containerId: target.containerId,
        hostId: target.hostId,
        kind,
        localPath,
        remotePath: joinRemotePath(path, fileNameFromPath(localPath, "upload")),
        runtime: target.runtime,
      });
      await loadDirectory(path);
    });
  };

  const downloadEntry = async (entry: SftpEntry) => {
    if (!target) {
      return;
    }
    const kind = transferKindFromEntry(entry);
    if (!kind) {
      return;
    }
    const localPath =
      kind === "file"
        ? await selectSaveFile(entry.name)
        : appendLocalPath(await selectLocalDirectory(), entry.name);
    if (!localPath) {
      return;
    }
    await runOperation("正在下载", async () => {
      await downloadDockerContainerPath({
        containerId: target.containerId,
        hostId: target.hostId,
        kind,
        localPath,
        remotePath: entry.path,
        runtime: target.runtime,
      });
    });
  };

  const renameEntry = (entry: SftpEntry) => {
    if (!target) {
      return;
    }
    setContainerDialog({ entry, kind: "rename", value: entry.path });
  };

  const chmodEntry = (entry: SftpEntry) => {
    if (!target) {
      return;
    }
    setContainerDialog({ entry, kind: "chmod", value: "0644" });
  };

  const deleteEntry = (entry: SftpEntry) => {
    if (!target) {
      return;
    }
    setContainerDialog({ entry, kind: "delete" });
  };

  if (!target) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="容器文件" subtitle="请选择一个容器" />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          当前目标不是容器。
        </div>
      </div>
    );
  }

  const busy = operation.kind !== "idle";
  const parentPath = parentRemotePath(path);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="容器文件"
        subtitle={`${selectedMachine?.name ?? target.containerName ?? target.containerId} · ${target.runtime ?? "docker"}`}
      />
      <div className="border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            disabled={!parentPath || busy}
            onClick={() => parentPath && void loadDirectory(parentPath)}
            size="icon"
            title="上级目录"
            variant="ghost"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              void loadDirectory(pathInput);
            }}
          >
            <input
              aria-label="容器路径"
              className="kerminal-field-surface h-9 w-full min-w-0 rounded-md border px-2 font-mono text-xs text-zinc-800 dark:text-zinc-100"
              onChange={(event) => setPathInput(event.target.value)}
              value={pathInput}
            />
          </form>
          <Button
            disabled={busy}
            onClick={() => void loadDirectory(path)}
            size="icon"
            title="刷新"
            variant="ghost"
          >
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            onClick={() => void uploadPath("file")}
            size="sm"
            title="上传文件"
            variant="secondary"
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            文件
          </Button>
          <Button
            disabled={busy}
            onClick={() => void uploadPath("directory")}
            size="sm"
            title="上传目录"
            variant="secondary"
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            目录
          </Button>
          <Button
            disabled={busy}
            onClick={() => void createDirectory()}
            size="sm"
            title="创建目录"
            variant="secondary"
          >
            <FolderPlus className="mr-1 h-3.5 w-3.5" />
            新建
          </Button>
          {selectedEntry ? (
            <EntryActionBar
              busy={busy}
              entry={selectedEntry}
              onChmod={chmodEntry}
              onDelete={deleteEntry}
              onDownload={downloadEntry}
              onRename={renameEntry}
            />
          ) : null}
        </div>
        {operation.message ? (
          <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {operation.message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-2 rounded-md border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-100">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(120px,32%)]">
        <div className="min-h-0 overflow-auto">
          {entries.length === 0 && operation.kind !== "loading" ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              空目录
            </div>
          ) : null}
          {entries.map((entry) => (
            <button
              className={cn(
                "kerminal-focus-ring kerminal-pressable grid w-full grid-cols-[24px_minmax(0,1fr)_78px] items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-hover)]",
                selectedEntry?.path === entry.path &&
                  "bg-[var(--surface-selected)] text-sky-800 dark:text-sky-100",
              )}
              key={entry.path}
              onClick={() => setSelectedEntry(entry)}
              onDoubleClick={() => openEntry(entry)}
              type="button"
            >
              {entry.kind === "directory" ? (
                <Folder className="h-4 w-4 text-amber-500" />
              ) : (
                <File className="h-4 w-4 text-zinc-500" />
              )}
              <span className="min-w-0 truncate">{entry.name}</span>
              <span className="text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatEntrySize(entry)}
              </span>
            </button>
          ))}
        </div>
        <div className="min-h-0 border-t border-[var(--border-subtle)]">
          {preview ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2 text-xs">
                <span className="min-w-0 truncate font-medium text-zinc-700 dark:text-zinc-200">
                  {preview.entry.path}
                </span>
                {preview.truncated ? (
                  <span className="shrink-0 text-amber-600 dark:text-amber-300">
                    已截断
                  </span>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 bg-zinc-950">
                <Suspense fallback={<PlainPreview content={preview.content} />}>
                  <LazyRemoteFilePreviewEditor
                    content={preview.content}
                    path={preview.entry.path}
                  />
                </Suspense>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {selectedEntry?.kind === "directory"
                ? selectedEntry.path
                : "未选择文件预览"}
            </div>
          )}
        </div>
      </div>

      <PromptDialog
        busy={busy}
        confirmLabel={containerDialogConfirmLabel(containerDialog)}
        confirmVariant={containerDialog?.kind === "delete" ? "danger" : "primary"}
        description={containerDialogDescription(containerDialog, path)}
        inputLabel={containerDialogInputLabel(containerDialog)}
        onClose={() => setContainerDialog(null)}
        onConfirm={(value) => {
          void confirmContainerDialog(value);
        }}
        onValueChange={(value) =>
          setContainerDialog((current) =>
            current && current.kind !== "delete" ? { ...current, value } : current,
          )
        }
        open={Boolean(containerDialog)}
        placeholder={containerDialogPlaceholder(containerDialog)}
        title={containerDialogTitle(containerDialog)}
        validate={
          containerDialog?.kind === "delete"
            ? undefined
            : (value) =>
                value.trim()
                  ? null
                  : `${containerDialogInputLabel(containerDialog) ?? "内容"}不能为空。`
        }
        value={containerDialogValue(containerDialog)}
      >
        {containerDialog?.kind === "delete" ? (
          <div className="rounded-[var(--radius-control)] border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-700 dark:text-red-100">
            将删除容器{containerDialog.entry.kind === "directory" ? "目录" : "项目"}：
            <span className="mt-1 block break-all font-mono text-xs">
              {containerDialog.entry.path}
            </span>
            {containerDialog.entry.kind === "directory" ? (
              <span className="mt-2 block text-xs text-red-600/80 dark:text-red-100/80">
                目录会递归删除，包含其中所有文件和子目录。
              </span>
            ) : null}
          </div>
        ) : null}
      </PromptDialog>
    </div>
  );
}

function containerDialogTitle(dialog: ContainerFileDialog | null) {
  if (!dialog) {
    return "";
  }
  if (dialog.kind === "mkdir") {
    return "新建目录";
  }
  if (dialog.kind === "rename") {
    return "重命名";
  }
  if (dialog.kind === "chmod") {
    return "修改权限";
  }
  return "删除";
}

function containerDialogDescription(
  dialog: ContainerFileDialog | null,
  currentPath: string,
) {
  if (!dialog) {
    return undefined;
  }
  if (dialog.kind === "mkdir") {
    return currentPath;
  }
  if (dialog.kind === "delete") {
    return "此操作会直接修改容器文件系统。";
  }
  return dialog.entry.path;
}

function containerDialogInputLabel(dialog: ContainerFileDialog | null) {
  if (!dialog || dialog.kind === "delete") {
    return undefined;
  }
  if (dialog.kind === "mkdir") {
    return "目录名";
  }
  if (dialog.kind === "rename") {
    return "新路径";
  }
  return "权限模式";
}

function containerDialogPlaceholder(dialog: ContainerFileDialog | null) {
  if (!dialog || dialog.kind === "delete") {
    return undefined;
  }
  if (dialog.kind === "mkdir") {
    return "new-folder";
  }
  if (dialog.kind === "rename") {
    return dialog.entry.path;
  }
  return "0644";
}

function containerDialogConfirmLabel(dialog: ContainerFileDialog | null) {
  if (!dialog) {
    return "确认";
  }
  if (dialog.kind === "mkdir") {
    return "创建";
  }
  if (dialog.kind === "rename") {
    return "重命名";
  }
  if (dialog.kind === "chmod") {
    return "保存权限";
  }
  return "确认删除";
}

function containerDialogValue(dialog: ContainerFileDialog | null) {
  if (!dialog || dialog.kind === "delete") {
    return "";
  }
  return dialog.value;
}

function PanelHeader({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <header className="border-b border-[var(--border-subtle)] px-4 py-3">
      <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        {title}
      </div>
      <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </div>
    </header>
  );
}

function EntryActionBar({
  busy,
  entry,
  onChmod,
  onDelete,
  onDownload,
  onRename,
}: {
  busy: boolean;
  entry: SftpEntry;
  onChmod: (entry: SftpEntry) => void | Promise<void>;
  onDelete: (entry: SftpEntry) => void | Promise<void>;
  onDownload: (entry: SftpEntry) => void | Promise<void>;
  onRename: (entry: SftpEntry) => void | Promise<void>;
}) {
  const downloadable = Boolean(transferKindFromEntry(entry));
  return (
    <div className="flex items-center gap-1">
      <Button
        disabled={busy || !downloadable}
        onClick={() => void onDownload(entry)}
        size="icon"
        title="下载"
        variant="ghost"
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        disabled={busy}
        onClick={() => void onRename(entry)}
        size="icon"
        title="重命名"
        variant="ghost"
      >
        <Edit3 className="h-4 w-4" />
      </Button>
      <Button
        disabled={busy}
        onClick={() => void onChmod(entry)}
        size="icon"
        title="chmod"
        variant="ghost"
      >
        <Shield className="h-4 w-4" />
      </Button>
      <Button
        className="text-rose-600 hover:text-rose-700 dark:text-rose-300"
        disabled={busy}
        onClick={() => void onDelete(entry)}
        size="icon"
        title="删除"
        variant="ghost"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function PlainPreview({ content }: { content: string }) {
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-zinc-200">
      {content}
    </pre>
  );
}

function resolveContainerTarget(machine?: Machine): Extract<
  RemoteTargetRef,
  { kind: "dockerContainer" }
> | null {
  if (machine?.target?.kind === "dockerContainer") {
    return machine.target;
  }
  return null;
}

function isFollowableRemotePath(path: string | undefined): path is string {
  return Boolean(path?.trim().startsWith("/"));
}

function transferKindFromEntry(entry: SftpEntry): SftpTransferKind | null {
  if (entry.kind === "directory") {
    return "directory";
  }
  if (entry.kind === "file" || entry.kind === "symlink") {
    return "file";
  }
  return null;
}

function appendLocalPath(parent: string | null, child: string) {
  if (!parent) {
    return null;
  }
  return `${parent.replace(/[\\/]+$/g, "")}/${child}`;
}

function formatEntrySize(entry: SftpEntry) {
  if (entry.kind === "directory") {
    return "-";
  }
  if (entry.size === undefined) {
    return "-";
  }
  if (entry.size < 1024) {
    return `${entry.size} B`;
  }
  if (entry.size < 1024 * 1024) {
    return `${(entry.size / 1024).toFixed(1)} KB`;
  }
  return `${(entry.size / 1024 / 1024).toFixed(1)} MB`;
}

function sortEntries(entries: SftpEntry[]) {
  return [...entries].sort((left, right) => {
    const leftRank = left.kind === "directory" ? 0 : 1;
    const rightRank = right.kind === "directory" ? 0 : 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
