import { type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  className,
  disabled,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        "kerminal-focus-ring relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-0.5 outline-none transition-[background-color,border-color,box-shadow,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-[rgb(var(--app-accent)/0.4)] bg-[rgb(var(--app-accent))]"
          : "hover:bg-[var(--surface-muted)]",
        className,
      )}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}
