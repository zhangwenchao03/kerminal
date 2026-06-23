import { Check, Edit3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type { LocalDirectoryEntry } from "../../lib/fileDialogApi";

export function LocalRenameDialog({
  busy,
  entry,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  entry: LocalDirectoryEntry | null;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    setNameDraft(entry?.name ?? "");
  }, [entry?.path, entry?.name]);

  if (!entry) {
    return null;
  }

  const trimmedName = nameDraft.trim();
  const canConfirm = trimmedName.length > 0 && trimmedName !== entry.name;

  const submitRename = () => {
    if (!canConfirm || busy) {
      return;
    }
    onConfirm(trimmedName);
  };

  return (
    <ModalShell
      description="此操作会直接修改本机文件系统。"
      footer={
        <>
          <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
            取消
          </Button>
          <Button
            disabled={!canConfirm || busy}
            onClick={submitRename}
            size="sm"
            variant="primary"
          >
            <Check className="h-4 w-4" />
            确认重命名
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onClose}
      open={Boolean(entry)}
      size="small"
      title="重命名本机项目"
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submitRename();
        }}
      >
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-3 text-sm text-zinc-700 dark:text-zinc-200">
          <div className="flex items-center gap-2 font-medium">
            <Edit3 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            将重命名本机{entry.kind === "directory" ? "目录" : "文件"}：
          </div>
          <span className="mt-2 block break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {entry.path}
          </span>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            新名称
          </span>
          <input
            aria-label="新名称"
            autoFocus
            className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder={entry.name}
            spellCheck={false}
            value={nameDraft}
          />
        </label>
      </form>
    </ModalShell>
  );
}
