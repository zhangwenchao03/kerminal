import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

interface ModalShellProps {
  bodyClassName?: string;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  headerActions?: ReactNode;
  layout?: "default" | "fullscreen" | "workspace";
  size?: "compact" | "small" | "medium" | "large" | "wide";
  maxWidthClassName?: string;
  open: boolean;
  panelClassName?: string;
  title: string;
  onClose: () => void;
}

const modalSizeClassNames = {
  compact: {
    maxHeight: "max-h-[min(18rem,calc(100vh-48px))]",
    width: "max-w-md",
  },
  small: {
    maxHeight: "max-h-[min(24rem,calc(100vh-48px))]",
    width: "max-w-lg",
  },
  medium: {
    maxHeight: "max-h-[min(34rem,calc(100vh-48px))]",
    width: "max-w-2xl",
  },
  large: {
    maxHeight: "max-h-[min(44rem,calc(100vh-48px))]",
    width: "max-w-5xl",
  },
  wide: {
    maxHeight: "max-h-[min(780px,calc(100vh-48px))]",
    width: "max-w-6xl",
  },
} satisfies Record<
  NonNullable<ModalShellProps["size"]>,
  { maxHeight: string; width: string }
>;

function hasHeightConstraintClassName(className?: string) {
  return /(?:^|\s)(?:h-|max-h-)/.test(className ?? "");
}

export function ModalShell({
  bodyClassName,
  children,
  description,
  footer,
  headerActions,
  layout = "default",
  maxWidthClassName,
  onClose,
  open,
  panelClassName,
  size = "medium",
  title,
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const fullscreen = layout === "fullscreen";
  const workspace = layout === "workspace";
  const sizeClassNames = modalSizeClassNames[size];
  const resolvedMaxWidthClassName =
    maxWidthClassName ??
    (fullscreen || workspace ? "max-w-none" : sizeClassNames.width);
  const presetMaxHeightClassName =
    fullscreen || workspace
      ? null
      : hasHeightConstraintClassName(maxWidthClassName) ||
          hasHeightConstraintClassName(panelClassName)
        ? null
        : sizeClassNames.maxHeight;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex backdrop-blur-md",
        workspace
          ? "items-center justify-center bg-zinc-950/24 p-3 dark:bg-[rgb(9_9_11_/_0.52)] sm:p-6"
          : "bg-zinc-950/30 dark:bg-black/48",
        fullscreen
          ? "items-stretch justify-center p-1 sm:p-2"
          : !workspace && "items-center justify-center p-4",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "kerminal-floating-enter flex w-full flex-col overflow-hidden text-zinc-950 dark:text-zinc-50",
          workspace
            ? "kerminal-solid-surface rounded-[1.35rem] border bg-[var(--surface-overlay)]"
            : "kerminal-floating-surface rounded-[1.5rem] border",
          fullscreen
            ? "h-full max-h-none"
            : workspace
              ? "h-[min(700px,calc(100vh-72px))] max-h-[calc(100vh-40px)] w-[min(1100px,calc(100vw-48px))]"
              : presetMaxHeightClassName,
          resolvedMaxWidthClassName,
          panelClassName,
        )}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header
          className={cn(
            "flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)]",
            workspace ? "px-4 py-3" : "px-5 py-4",
          )}
        >
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-6" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p
                className="mt-1 text-[13px] leading-5 text-zinc-500 dark:text-zinc-400"
                id={descriptionId}
              >
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
            <Button
              aria-label="关闭弹窗"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div
          className={cn(
            fullscreen || workspace
              ? "min-h-0 flex-1 overflow-hidden p-3"
              : "scrollbar-none min-h-0 flex-auto overflow-y-auto px-5 py-4",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
