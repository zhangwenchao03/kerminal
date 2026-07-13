import { FileWarning } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type { SftpTransferConflictPolicy } from "../../lib/sftpApi";

const conflictOptions: Array<{
  description: string;
  label: string;
  policy: SftpTransferConflictPolicy;
}> = [
  {
    description: "替换目标文件。",
    label: "覆盖目标",
    policy: "overwrite",
  },
  {
    description: "生成新文件名。",
    label: "自动重命名",
    policy: "rename",
  },
  {
    description: "跳过已存在项目。",
    label: "跳过冲突",
    policy: "skip",
  },
];

export function SftpTransferConflictDialog({
  conflictCount,
  onClose,
  onConfirm,
  open,
}: {
  conflictCount: number;
  onClose: () => void;
  onConfirm: (policy: SftpTransferConflictPolicy) => void;
  open: boolean;
}) {
  return (
    <ModalShell
      description="请选择冲突处理方式。"
      footer={
        <Button onClick={onClose} size="sm" type="button" variant="ghost">
          取消
        </Button>
      }
      maxWidthClassName="max-w-2xl"
      onClose={onClose}
      open={open}
      size="small"
      title="处理传输冲突"
    >
      <div className="space-y-3">
        <div className="rounded-[var(--radius-control)] border border-amber-400/25 bg-amber-500/10 px-3 py-3 text-sm text-amber-800 dark:text-amber-100">
          <div className="flex items-center gap-2 font-medium">
            <FileWarning className="h-4 w-4" />
            检测到 {conflictCount} 个目标冲突
          </div>
          <div className="mt-1 text-xs text-amber-700/80 dark:text-amber-100/75">
            策略会应用到本次队列的所有冲突。
          </div>
        </div>

        <div className="grid gap-2">
          {conflictOptions.map((option) => (
            <button
              className="kerminal-focus-ring kerminal-pressable rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-3 text-left transition hover:border-sky-400/45 hover:bg-[var(--surface-hover)]"
              key={option.policy}
              onClick={() => onConfirm(option.policy)}
              type="button"
            >
              <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {option.label}
              </div>
              <div className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                {option.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
