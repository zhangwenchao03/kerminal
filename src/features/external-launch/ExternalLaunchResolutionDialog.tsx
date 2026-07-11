import { Check, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import type { ExternalSshLaunchRequest } from "../../lib/externalLaunchApi";
import { cn } from "../../lib/cn";
import type { UserFacingMessage } from "../../lib/userFacingMessage";
import {
  externalSshLaunchSourceLabel,
  resolveExternalSshLaunchUsername,
} from "./externalSshLaunchModel";

interface ExternalLaunchResolutionDialogProps {
  busy?: boolean;
  error?: UserFacingMessage | null;
  launch: ExternalSshLaunchRequest | null;
  onCancel: () => void;
  onResolve: (
    launch: ReturnType<typeof resolveExternalSshLaunchUsername>,
  ) => void;
  open: boolean;
}

export function ExternalLaunchResolutionDialog({
  busy = false,
  error,
  launch,
  onCancel,
  onResolve,
  open,
}: ExternalLaunchResolutionDialogProps) {
  const [username, setUsername] = useState("");
  const validationMessage =
    launch && username ? validateUsername(username) : null;
  const disabled =
    busy || !launch || !username.trim() || Boolean(validationMessage);
  const targetLabel = useMemo(
    () => (launch ? `${launch.target.host}:${launch.target.port}` : ""),
    [launch],
  );

  useEffect(() => {
    setUsername("");
  }, [launch?.id]);

  if (!launch) {
    return null;
  }

  const inputId = `${launch.id}-username`;

  return (
    <ModalShell
      description={targetLabel}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
            取消
          </Button>
          <Button
            disabled={disabled}
            form="external-launch-resolution-form"
            size="sm"
          >
            <Check className="h-4 w-4" />
            打开
          </Button>
        </>
      }
      maxWidthClassName="max-w-lg"
      onClose={onCancel}
      open={open}
      size="small"
      title="补全 SSH 用户名"
    >
      <form
        className="space-y-4"
        id="external-launch-resolution-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) {
            return;
          }
          onResolve(resolveExternalSshLaunchUsername(launch, username));
        }}
      >
        <div className="flex gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-3">
          <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-300" />
          <div className="min-w-0 text-sm leading-5 text-zinc-600 dark:text-zinc-300">
            {externalSshLaunchSourceLabel(launch)} 没有提供用户名，Kerminal
            需要用户名来创建临时 SSH 目标。
          </div>
        </div>

        <label className="block" htmlFor={inputId}>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            用户名
          </span>
          <input
            aria-invalid={Boolean(validationMessage)}
            autoFocus
            className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
            id={inputId}
            onChange={(event) => setUsername(event.target.value)}
            spellCheck={false}
            value={username}
          />
        </label>

        {error ? (
          <UserFacingNotice compact message={error} />
        ) : validationMessage ? (
          <p
            className={cn(
              "text-xs leading-5",
              "text-amber-600 dark:text-amber-300",
            )}
            role="alert"
          >
            {validationMessage}
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}

function validateUsername(value: string): string | null {
  if (!value.trim()) {
    return "SSH 用户名不能为空";
  }
  if (value.includes("\n") || value.includes("\r")) {
    return "SSH 用户名不能包含换行";
  }
  return null;
}
