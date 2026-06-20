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
  maxWidthClassName?: string;
  open: boolean;
  panelClassName?: string;
  title: string;
  onClose: () => void;
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
  title,
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const fullscreen = layout === "fullscreen";
  const workspace = layout === "workspace";
  const resolvedMaxWidthClassName =
    maxWidthClassName ??
    (fullscreen || workspace ? "max-w-none" : "max-w-3xl");

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
          ? "items-center justify-center bg-zinc-950/24 p-3 dark:bg-black/52 sm:p-6"
          : "bg-black/32 dark:bg-black/48",
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
          "flex w-full flex-col overflow-hidden text-zinc-950 shadow-2xl backdrop-blur-2xl dark:text-zinc-50",
          workspace
            ? "rounded-2xl border border-black/8 bg-[#f5f5f7]/95 shadow-black/20 dark:border-white/10 dark:bg-[#111113]/95 dark:shadow-black/50"
            : "rounded-[1.5rem] border border-white/40 bg-white/86 shadow-black/20 dark:border-white/10 dark:bg-zinc-950/86 dark:shadow-black/50",
          fullscreen
            ? "h-full max-h-none"
            : workspace
              ? "h-[min(700px,calc(100vh-72px))] max-h-[calc(100vh-40px)] w-[min(1100px,calc(100vw-48px))]"
            : "max-h-[min(780px,calc(100vh-48px))]",
          resolvedMaxWidthClassName,
          panelClassName,
        )}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header
          className={cn(
            "flex shrink-0 items-start justify-between gap-4 border-b border-black/8 dark:border-white/8",
            workspace ? "px-4 py-3" : "px-5 py-4",
          )}
        >
          <div className="min-w-0">
            <h2 className="text-base font-semibold" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p
                className="mt-1 text-sm leading-5 text-zinc-500 dark:text-zinc-400"
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
              : "scrollbar-none min-h-0 flex-1 overflow-y-auto px-5 py-4",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-black/8 px-5 py-4 dark:border-white/8">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
