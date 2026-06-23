import { Check } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import { cn } from "../../../lib/cn";
import { entryKindLabel } from "./sftpEntryModel";
import {
  dialogActionConfirmLabel,
  dialogActionDescription,
  dialogActionTitle,
} from "./sftpDialogModel";
import { defaultRenamePath, joinRemotePath } from "./sftpPathModel";
import type { SftpDialogAction, SftpStatus } from "./types";

export function SftpActionDialog({
  action,
  busy,
  currentPath,
  onActionChange,
  onClose,
  onSubmit,
  status,
}: {
  action: SftpDialogAction | null;
  busy: boolean;
  currentPath: string;
  onActionChange: (action: SftpDialogAction) => void;
  onClose: () => void;
  onSubmit: () => void;
  status: SftpStatus | null;
}) {
  if (!action) {
    return null;
  }

  return (
    <ModalShell
      description={dialogActionDescription(action, currentPath)}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
            取消
          </Button>
          <Button
            disabled={busy}
            onClick={onSubmit}
            size="sm"
            variant={action.kind === "delete" ? "danger" : "primary"}
          >
            <Check className="h-4 w-4" />
            {dialogActionConfirmLabel(action)}
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onClose}
      open={Boolean(action)}
      size="small"
      title={dialogActionTitle(action)}
    >
      {action.kind === "mkdir" ? (
        <PathInput
          label="新目录路径"
          onChange={(value) => onActionChange({ ...action, path: value })}
          placeholder={joinRemotePath(currentPath, "new-folder")}
          value={action.path}
        />
      ) : null}

      {action.kind === "rename" ? (
        <div className="space-y-3">
          <ReadonlyPath label="原路径" value={action.entry.path} />
          <PathInput
            label="目标路径"
            onChange={(value) => onActionChange({ ...action, toPath: value })}
            placeholder={defaultRenamePath(action.entry)}
            value={action.toPath}
          />
        </div>
      ) : null}

      {action.kind === "chmod" ? (
        <div className="space-y-3">
          <ReadonlyPath label="远程路径" value={action.entry.path} />
          <ReadonlyPath
            label="当前权限"
            value={action.entry.permissions ?? "-"}
          />
          <PathInput
            label="权限模式"
            onChange={(value) => onActionChange({ ...action, mode: value })}
            placeholder="644"
            value={action.mode}
          />
        </div>
      ) : null}

      {action.kind === "delete" ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-700 dark:text-red-100">
          将删除 {entryKindLabel(action.entry.kind)}：
          <span className="mt-1 block break-all font-mono text-xs">
            {action.entry.path}
          </span>
          {action.entry.kind === "directory" ? (
            <span className="mt-2 block text-xs text-red-600/80 dark:text-red-100/80">
              目录会递归删除，包含其中所有文件和子目录。
            </span>
          ) : null}
        </div>
      ) : null}

      <StatusMessage status={status} />
    </ModalShell>
  );
}

function PathInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <input
        aria-label={label}
        className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
      />
    </label>
  );
}

function ReadonlyPath({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="kerminal-muted-surface mt-1 break-all rounded-xl border px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {value}
      </div>
    </div>
  );
}

export function StatusMessage({
  className,
  status,
}: {
  className?: string;
  status: SftpStatus | null;
}) {
  if (!status) {
    return null;
  }

  return (
    <div
      className={cn(
        "mt-3 rounded-xl border px-3 py-2 text-sm",
        status.kind === "error" &&
          "border-rose-300/30 bg-rose-500/10 text-rose-700 dark:text-rose-100",
        status.kind === "success" &&
          "border-emerald-300/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
        status.kind === "info" &&
          "border-sky-300/30 bg-sky-500/10 text-sky-700 dark:text-sky-100",
        className,
      )}
      role={status.kind === "error" ? "alert" : "status"}
    >
      {status.message}
    </div>
  );
}
