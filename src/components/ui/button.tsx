import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "kerminal-pressable kerminal-focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "bg-[#0A84FF] text-white shadow-sm shadow-[#0A84FF]/20 hover:brightness-105",
        secondary:
          "kerminal-solid-surface border text-zinc-800 hover:bg-[var(--surface-field-hover)] dark:text-zinc-100",
        ghost:
          "text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
        danger:
          "text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-3.5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  asChild = false,
  className,
  size,
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
