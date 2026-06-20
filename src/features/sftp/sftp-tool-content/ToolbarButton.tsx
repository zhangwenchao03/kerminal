import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";

export function ToolbarButton({
  ariaExpanded,
  ariaHaspopup,
  ariaLabel,
  disabled,
  icon,
  label,
  onClick,
}: {
  ariaExpanded?: boolean;
  ariaHaspopup?: "menu";
  ariaLabel: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-label={ariaLabel}
      className="h-8 w-8 rounded-md border border-black/8 bg-white/60 px-0 text-zinc-600 hover:bg-black/5 hover:text-zinc-950 dark:border-white/8 dark:bg-white/6 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-zinc-50"
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
