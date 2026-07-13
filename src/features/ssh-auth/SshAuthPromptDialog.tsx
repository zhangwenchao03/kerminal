import { Check, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { Switch } from "../../components/ui/switch";
import type {
  SshAuthPromptRequest,
  SshAuthPromptResponseRequest,
} from "../../lib/sshAuthApi";
import { cn } from "../../lib/cn";
import {
  buildSshAuthPromptSubmitRequest,
  createSshAuthPromptViewModel,
  validateSshAuthPromptValue,
} from "./sshAuthPromptModel";

interface SshAuthPromptDialogProps {
  busy?: boolean;
  defaultRememberInVault?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (request: SshAuthPromptResponseRequest) => void;
  open: boolean;
  persistToHostId?: string;
  prompt: SshAuthPromptRequest | null;
}

export function SshAuthPromptDialog({
  busy = false,
  defaultRememberInVault,
  error,
  onClose,
  onSubmit,
  open,
  persistToHostId,
  prompt,
}: SshAuthPromptDialogProps) {
  const [value, setValue] = useState("");
  const viewModel = useMemo(
    () =>
      prompt ? createSshAuthPromptViewModel(prompt, persistToHostId) : null,
    [persistToHostId, prompt],
  );
  const initialRememberInVault =
    viewModel?.canPersist && (defaultRememberInVault ?? true);
  const [rememberInVault, setRememberInVault] = useState(
    Boolean(initialRememberInVault),
  );
  const validationMessage =
    prompt && value ? validateSshAuthPromptValue(prompt.secretKind, value) : null;
  const disabled = busy || !prompt || !value.trim() || Boolean(validationMessage);

  useEffect(() => {
    setValue("");
    setRememberInVault(Boolean(initialRememberInVault));
  }, [initialRememberInVault, prompt?.promptId]);

  if (!prompt || !viewModel) {
    return null;
  }

  const inputId = `${prompt.promptId}-secret`;

  return (
    <ModalShell
      description={viewModel.targetLabel}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
            取消
          </Button>
          <Button disabled={disabled} form="ssh-auth-prompt-form" size="sm">
            <Check className="h-4 w-4" />
            继续
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onClose}
      open={open}
      size="small"
      title={viewModel.title}
    >
      <form
        className="space-y-3"
        id="ssh-auth-prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) {
            return;
          }
          onSubmit(
            buildSshAuthPromptSubmitRequest({
              persistToHostId,
              prompt,
              rememberInVault,
              value,
            }),
          );
        }}
      >
        <div className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)] p-3">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--app-accent))]" />
          <div className="min-w-0 text-[13px] leading-5 text-[var(--text-secondary)]">
            {viewModel.helperText}
          </div>
        </div>

        <label className="block" htmlFor={inputId}>
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {viewModel.fieldLabel}
          </span>
          {viewModel.fieldKind === "textarea" ? (
            <textarea
              aria-invalid={Boolean(validationMessage)}
              autoFocus
              className="kerminal-field-surface mt-1 min-h-40 w-full resize-none rounded-[var(--radius-control)] border px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
              id={inputId}
              onChange={(event) => setValue(event.target.value)}
              spellCheck={false}
              value={value}
            />
          ) : (
            <input
              aria-invalid={Boolean(validationMessage)}
              autoFocus
              className="kerminal-field-surface mt-1 h-9 w-full rounded-[var(--radius-control)] border px-3 text-sm text-[var(--text-primary)] placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
              id={inputId}
              onChange={(event) => setValue(event.target.value)}
              spellCheck={false}
              type="password"
              value={value}
            />
          )}
        </label>

        {viewModel.canPersist ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--text-primary)]">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="truncate">{viewModel.persistLabel}</span>
            </div>
            <Switch
              aria-label={viewModel.persistLabel}
              checked={rememberInVault}
              disabled={busy}
              onCheckedChange={setRememberInVault}
            />
          </div>
        ) : null}

        {validationMessage || error ? (
          <p
            className={cn(
              "text-xs leading-5",
              error
                ? "text-rose-600 dark:text-rose-300"
                : "text-amber-600 dark:text-amber-300",
            )}
            role="alert"
          >
            {error ?? validationMessage}
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}
