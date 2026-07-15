import { PromptDialog } from "../../../components/ui/prompt-dialog";
import type { TmuxDialogState } from "./useTmuxToolLifecycle";

export function TmuxDialog({ busy, dialog, onClose, onCreate, onKill, onRename, onUpdateName }: {
  busy: boolean;
  dialog: TmuxDialogState;
  onClose: () => void;
  onCreate: () => void;
  onKill: () => void;
  onRename: () => void;
  onUpdateName: (name: string) => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === "kill") {
    return (
      <PromptDialog
        busy={busy}
        cancelLabel="取消"
        confirmLabel="结束会话"
        confirmVariant="danger"
        description={`将结束会话“${dialog.session.name || dialog.session.id}”。`}
        onClose={onClose}
        onConfirm={onKill}
        open
        title="结束 tmux 会话"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          会话中的运行任务会一并停止，且无法从 Kerminal 恢复。
        </p>
      </PromptDialog>
    );
  }
  const title = dialog.kind === "create" ? "新建 tmux 会话" : "重命名 tmux 会话";
  const action = dialog.kind === "create" ? onCreate : onRename;
  return (
    <PromptDialog
      busy={busy}
      cancelLabel="取消"
      confirmDisabled={!dialog.name.trim()}
      confirmLabel={dialog.kind === "create" ? "创建" : "保存"}
      inputLabel="会话名称"
      inputMono={false}
      onClose={onClose}
      onConfirm={action}
      onValueChange={onUpdateName}
      open
      title={title}
      value={dialog.name}
    />
  );
}

export function TmuxEmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-3 py-5 text-center font-mono">
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{body}</p>
    </div>
  );
}
