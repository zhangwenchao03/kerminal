import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";

export function ToolbarButton({
  ariaExpanded,
  ariaHaspopup,
  ariaLabel,
  disabled,
  icon,
  label,
  onClick,
  pressed,
}: {
  ariaExpanded?: boolean;
  ariaHaspopup?: "menu";
  ariaLabel: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <Button
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      className={cn(
        "kerminal-focus-ring kerminal-pressable h-8 w-8 rounded-md border px-0 transition disabled:cursor-not-allowed disabled:opacity-45",
        pressed
          ? "border-sky-400/45 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100"
          : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
      )}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {icon}
    </Button>
  );
}
