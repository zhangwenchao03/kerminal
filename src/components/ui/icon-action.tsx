import { LoaderCircle, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "../../lib/cn";
import type { ButtonProps } from "./button";
import { Button } from "./button";

export interface IconActionProps
  extends Omit<ButtonProps, "aria-label" | "children" | "title"> {
  disabledReason?: string;
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  loading?: boolean;
  tooltip?: string;
}

/**
 * 统一常用图标操作的命中区域、可访问名称、加载态和禁用原因。
 */
export function IconAction({
  "aria-describedby": ariaDescribedBy,
  className,
  disabled,
  disabledReason,
  icon: Icon,
  iconClassName = "h-4 w-4",
  label,
  loading = false,
  onClick,
  tooltip,
  ...props
}: IconActionProps) {
  const disabledReasonId = useId();
  const blocked = Boolean(disabled || loading);
  const title = disabledReason ?? tooltip ?? label;
  const describedBy = [
    ariaDescribedBy,
    blocked && disabledReason ? disabledReasonId : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <Button
        aria-busy={loading || undefined}
        aria-describedby={describedBy || undefined}
        aria-disabled={blocked || undefined}
        aria-label={label}
        className={cn(
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
          className,
        )}
        onClick={(event) => {
          if (blocked) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onClick?.(event);
        }}
        size="icon"
        title={title}
        {...props}
      >
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className={`${iconClassName} animate-spin`}
          />
        ) : (
          <Icon aria-hidden="true" className={iconClassName} />
        )}
      </Button>
      {blocked && disabledReason ? (
        <span className="sr-only" id={disabledReasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
