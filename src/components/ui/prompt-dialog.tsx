import { Check } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "./button";
import { ModalShell } from "./modal-shell";

type PromptDialogProps = {
  busy?: boolean;
  cancelLabel?: string;
  children?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  description?: string;
  helperText?: string;
  inputLabel?: string;
  inputMono?: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  onValueChange?: (value: string) => void;
  open: boolean;
  placeholder?: string;
  title: string;
  validate?: (value: string) => string | null;
  value?: string;
};

export function PromptDialog({
  busy = false,
  cancelLabel = "取消",
  children,
  confirmDisabled = false,
  confirmLabel,
  confirmVariant = "primary",
  description,
  helperText,
  inputLabel,
  inputMono = true,
  onClose,
  onConfirm,
  onValueChange,
  open,
  placeholder,
  title,
  validate,
  value = "",
}: PromptDialogProps) {
  const formId = useId();
  const validationMessage = validate?.(value) ?? null;
  const inputId = useId();
  const disabled = busy || confirmDisabled || Boolean(validationMessage);

  return (
    <ModalShell
      description={description}
      footer={
        <>
          <Button
            disabled={busy}
            onClick={onClose}
            size="sm"
            type="button"
            variant="ghost"
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={disabled}
            form={formId}
            size="sm"
            type="submit"
            variant={confirmVariant}
          >
            <Check className="h-4 w-4" />
            {confirmLabel}
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onClose}
      open={open}
      size="small"
      title={title}
    >
      <form
        className="space-y-3"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) {
            onConfirm(value);
          }
        }}
      >
        {children}

        {inputLabel ? (
          <label className="block" htmlFor={inputId}>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {inputLabel}
            </span>
            <input
              aria-invalid={Boolean(validationMessage)}
              autoFocus
              className={[
                "kerminal-field-surface mt-1 h-9 w-full rounded-[var(--radius-control)] border px-3 text-[13px] text-[var(--text-primary)] placeholder:text-zinc-400 dark:placeholder:text-zinc-600",
                inputMono ? "font-mono text-xs" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              id={inputId}
              onChange={(event) => onValueChange?.(event.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              value={value}
            />
          </label>
        ) : null}

        {validationMessage || helperText ? (
          <p
            className={
              validationMessage
                ? "text-xs leading-5 text-rose-600 dark:text-rose-300"
                : "text-xs leading-5 text-zinc-500 dark:text-zinc-400"
            }
            role={validationMessage ? "alert" : undefined}
          >
            {validationMessage ?? helperText}
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}
