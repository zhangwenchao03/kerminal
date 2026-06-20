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
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-black/10 bg-black/10 p-0.5 outline-none transition-[background-color,border-color,box-shadow,opacity] duration-150 focus-visible:ring-4 focus-visible:ring-[#0A84FF]/18 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/12",
        checked
          ? "border-[#0A84FF]/40 bg-[#0A84FF]"
          : "hover:bg-black/15 dark:hover:bg-white/18",
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
          "h-5 w-5 rounded-full bg-white shadow-sm shadow-black/20 transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}
