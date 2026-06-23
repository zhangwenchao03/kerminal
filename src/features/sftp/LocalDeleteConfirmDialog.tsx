import { Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type { LocalDirectoryEntry } from "../../lib/fileDialogApi";

export function LocalDeleteConfirmDialog({
  busy,
  entry,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  entry: LocalDirectoryEntry | null;
  onClose: () => void;
  onConfirm: (confirmName: string) => void;
}) {
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    setConfirmName("");
  }, [entry?.path]);

  if (!entry) {
    return null;
  }

  const confirmed = confirmName === entry.name;

  return (
    <ModalShell
      description="此操作会直接修改本机文件系统。"
      footer={
        <>
          <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
            取消
          </Button>
          <Button
            disabled={busy || !confirmed}
            onClick={() => onConfirm(confirmName)}
            size="sm"
            variant="danger"
          >
            <Check className="h-4 w-4" />
            确认删除
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onClose}
      open={Boolean(entry)}
      size="small"
      title="删除本机项目"
    >
      <div className="space-y-3">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-700 dark:text-red-100">
          <div className="flex items-center gap-2 font-medium">
            <Trash2 className="h-4 w-4" />
            将删除本机{entry.kind === "directory" ? "目录" : "文件"}：
          </div>
          <span className="mt-2 block break-all font-mono text-xs">
            {entry.path}
          </span>
          {entry.kind === "directory" ? (
            <span className="mt-2 block text-xs text-red-600/80 dark:text-red-100/80">
              目录会递归删除，包含其中所有文件和子目录。
            </span>
          ) : null}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            输入名称确认删除
          </span>
          <input
            aria-label="输入名称确认删除"
            autoFocus
            className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={entry.name}
            spellCheck={false}
            value={confirmName}
          />
        </label>
      </div>
    </ModalShell>
  );
}
