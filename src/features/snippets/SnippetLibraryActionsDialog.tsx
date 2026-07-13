import { useEffect, useState } from "react";
import { Clipboard, FolderOpen, History, ListRestart, ShieldCheck } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { getExternalAgentWorkspaceStatus } from "../../lib/agentLauncherApi";
import {
  listCommandHistory,
  type CommandHistoryEntry,
} from "../../lib/commandHistoryApi";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  clearSnippetUsage,
  listSnippetDocuments,
} from "../../lib/snippetApi";

interface SnippetLibraryActionsDialogProps {
  focusedPaneId?: string;
  onClose: () => void;
  onCreateFromCommand: (command: string) => void;
  onRefresh: () => void;
  onStatus: (status: string) => void;
  open: boolean;
}

/** 集中承载低频片段库管理动作，保持右栏主界面紧凑。 */
export function SnippetLibraryActionsDialog({
  focusedPaneId,
  onClose,
  onCreateFromCommand,
  onRefresh,
  onStatus,
  open,
}: SnippetLibraryActionsDialogProps) {
  const [workspaceDir, setWorkspaceDir] = useState<string | null>(null);
  const [validatorCommand, setValidatorCommand] = useState<string | null>(null);
  const [history, setHistory] = useState<CommandHistoryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setHistory(null);
    setClearConfirm(false);
    void getExternalAgentWorkspaceStatus()
      .then((status) => {
        if (!active) return;
        setWorkspaceDir(status.workspaceDir);
        setValidatorCommand(status.validator?.command ?? null);
      })
      .catch(() => {
        if (!active) return;
        setWorkspaceDir(null);
        setValidatorCommand(null);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const snippetsDirectory = workspaceDir
    ? `${workspaceDir.replace(/[\\/]+$/, "")}/snippets`
    : null;

  const copyText = async (text: string, success: string) => {
    const result = await writeDesktopClipboardText(text);
    onStatus(result.ok ? success : "剪贴板当前不可用，请稍后重试。");
  };

  return (
    <ModalShell
      footer={
        <Button onClick={onClose} type="button" variant="primary">
          完成
        </Button>
      }
      onClose={() => !busy && onClose()}
      open={open}
      size="medium"
      title="片段库管理"
    >
      <div className="divide-y divide-[var(--border-subtle)] text-sm">
        <ActionRow
          action={
            <div className="flex gap-2">
              <Button
                aria-label="复制片段配置路径"
                disabled={!snippetsDirectory}
                onClick={() =>
                  snippetsDirectory &&
                  void copyText(snippetsDirectory, "片段配置路径已复制")
                }
                size="icon"
                title="复制路径"
                type="button"
                variant="ghost"
              >
                <Clipboard className="h-4 w-4" />
              </Button>
              <Button
                disabled={!snippetsDirectory || busy}
                onClick={() => {
                  if (!snippetsDirectory) return;
                  if (!isTauri()) {
                    onStatus("请在桌面应用中打开片段配置目录。");
                    return;
                  }
                  setBusy(true);
                  void openPath(snippetsDirectory)
                    .then(() => onStatus("已打开片段配置目录"))
                    .catch(() => onStatus("配置目录暂时无法打开。"))
                    .finally(() => setBusy(false));
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <FolderOpen className="h-4 w-4" />打开目录
              </Button>
            </div>
          }
          detail={snippetsDirectory ?? "正在读取配置目录..."}
          icon={<FolderOpen className="h-4 w-4" />}
          title="文件化配置"
        />

        <ActionRow
          action={
            <div className="flex gap-2">
              {validatorCommand ? (
                <Button
                  aria-label="复制配置校验命令"
                  onClick={() =>
                    void copyText(validatorCommand, "配置校验命令已复制")
                  }
                  size="icon"
                  title="复制校验命令"
                  type="button"
                  variant="ghost"
                >
                  <Clipboard className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void listSnippetDocuments()
                    .then((result) => {
                      onStatus(
                        result.warnings.length === 0
                          ? `片段配置校验通过，共 ${result.snippets.length} 项`
                          : `发现 ${result.warnings.length} 个异常文件，其他片段仍可使用`,
                      );
                      onRefresh();
                    })
                    .catch(() => onStatus("片段配置校验失败，请检查文件权限。"))
                    .finally(() => setBusy(false));
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <ShieldCheck className="h-4 w-4" />校验配置
              </Button>
            </div>
          }
          detail={validatorCommand ?? "使用 Kerminal 配置加载器校验当前片段目录"}
          icon={<ShieldCheck className="h-4 w-4" />}
          title="配置校验"
        />

        <ActionRow
          action={
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void listCommandHistory({
                  ...(focusedPaneId ? { paneId: focusedPaneId } : {}),
                  limit: 20,
                })
                  .then((entries) => {
                    setHistory(entries.filter((entry) => entry.command.trim()));
                    if (entries.length === 0) onStatus("当前没有可保存的命令历史");
                  })
                  .catch(() => onStatus("命令历史暂时无法读取。"))
                  .finally(() => setBusy(false));
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              <History className="h-4 w-4" />选择历史命令
            </Button>
          }
          detail="从当前分屏最近命令创建可编辑副本"
          icon={<History className="h-4 w-4" />}
          title="命令历史"
        />
        {history ? (
          <div className="max-h-48 overflow-auto py-2" aria-label="最近命令历史">
            {history.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-zinc-500">
                没有可保存的命令
              </p>
            ) : (
              history.map((entry) => (
                <button
                  className="kerminal-focus-ring block w-full truncate px-2 py-2 text-left font-mono text-xs text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200"
                  key={entry.id}
                  onClick={() => onCreateFromCommand(entry.command)}
                  title={entry.command}
                  type="button"
                >
                  {entry.command}
                </button>
              ))
            )}
          </div>
        ) : null}

        <ActionRow
          action={
            clearConfirm ? (
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => setClearConfirm(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  取消
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void clearSnippetUsage()
                      .then(() => {
                        setClearConfirm(false);
                        onRefresh();
                        onStatus("最近使用和次数已清除，收藏保持不变");
                      })
                      .catch(() => onStatus("最近使用暂时无法清除。"))
                      .finally(() => setBusy(false));
                  }}
                  size="sm"
                  type="button"
                  variant="danger"
                >
                  确认清除
                </Button>
              </div>
            ) : (
              <Button
                disabled={busy}
                onClick={() => setClearConfirm(true)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ListRestart className="h-4 w-4" />清除最近
              </Button>
            )
          }
          detail="收藏项不会被移除"
          icon={<ListRestart className="h-4 w-4" />}
          title="最近使用"
        />
      </div>
    </ModalShell>
  );
}

function ActionRow({
  action,
  detail,
  icon,
  title,
}: {
  action: React.ReactNode;
  detail: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-3">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-zinc-800 dark:text-zinc-100">
          {title}
        </span>
        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={detail}>
          {detail}
        </span>
      </span>
      <span className="shrink-0">{action}</span>
    </div>
  );
}
