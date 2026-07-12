import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import type { AgentWorkflowSessionSnapshot } from "../../agent-workflow";

interface AgentSessionDeleteConfirmDialogProps {
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  session: AgentWorkflowSessionSnapshot | null;
}

/** 删除仅归档 Kerminal 的会话记录，不宣称删除外部 Agent 服务商的数据。 */
export function AgentSessionDeleteConfirmDialog({
  busy,
  onClose,
  onConfirm,
  session,
}: AgentSessionDeleteConfirmDialogProps) {
  if (!session) {
    return null;
  }

  const runtimeActive =
    session.runtimeStatus === "running" ||
    session.runtimeStatus === "waitingForUser";

  return (
    <ModalShell
      description="会从 Kerminal 的对话列表中移除这条记录。"
      footer={
        <>
          <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
            取消
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            size="sm"
            variant="danger"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? "正在删除" : "删除记录"}
          </Button>
        </>
      }
      onClose={onClose}
      open={Boolean(session)}
      size="compact"
      title="删除会话记录？"
    >
      <div className="space-y-3 text-sm">
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-solid)] text-zinc-500 dark:text-zinc-400">
            <MessageSquare className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate font-medium" title={session.title}>
            {session.title}
          </span>
        </div>
        <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
          {runtimeActive
            ? "该会话当前仍在 Kerminal 中运行，删除记录后会同时关闭这里的 Agent 终端。"
            : "删除后，这条会话将不再出现在 Kerminal 的历史列表中。"}
        </p>
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          Codex、Claude 或其他 Agent 服务商自身保存的历史不会被删除。
        </p>
      </div>
    </ModalShell>
  );
}
