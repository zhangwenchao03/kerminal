import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

interface AppTitleBarProps {
  className?: string;
  leftPanelCollapsed?: boolean;
  resolvedTheme: "dark" | "light";
  onLeftPanelCollapsedChange?: (collapsed: boolean) => void;
}

export function AppTitleBar({
  className,
  leftPanelCollapsed = false,
  onLeftPanelCollapsedChange,
  resolvedTheme,
}: AppTitleBarProps) {
  const CollapseIcon = leftPanelCollapsed ? PanelLeftOpen : PanelLeftClose;
  const collapseDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressCollapseClickRef = useRef(false);

  const beginCollapseButtonPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }

    suppressCollapseClickRef.current = false;
    collapseDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const updateCollapseButtonPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const dragState = collapseDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY,
    );
    if (distance < 4) {
      return;
    }

    suppressCollapseClickRef.current = true;
    collapseDragRef.current = null;
    if (!isTauri()) {
      return;
    }

    event.preventDefault();
    void startWindowDragging();
  };
  const endCollapseButtonPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    collapseDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const toggleLeftPanelCollapsed = () => {
    if (suppressCollapseClickRef.current) {
      suppressCollapseClickRef.current = false;
      return;
    }

    onLeftPanelCollapsedChange?.(!leftPanelCollapsed);
  };

  return (
    <header
      className={cn(
        "flex h-11 shrink-0 select-none items-center justify-between border-b px-3",
        resolvedTheme === "dark"
          ? "border-white/8 bg-[#111113]/92 text-zinc-100"
          : "border-black/8 bg-white/78 text-zinc-950",
        className,
      )}
      data-tauri-drag-region
    >
      <div
        className="pointer-events-auto flex min-w-0 items-center gap-2"
        data-tauri-drag-region
      >
        {onLeftPanelCollapsedChange ? (
          <button
            aria-label={leftPanelCollapsed ? "展开主机侧边栏" : "折叠主机侧边栏"}
            aria-pressed={leftPanelCollapsed}
            className="grid h-8 w-8 place-items-center rounded-xl text-zinc-500 transition hover:bg-black/6 hover:text-zinc-950 active:scale-[0.98] dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-50"
            onClick={toggleLeftPanelCollapsed}
            onPointerCancel={endCollapseButtonPointer}
            onPointerDown={beginCollapseButtonPointer}
            onPointerMove={updateCollapseButtonPointer}
            onPointerUp={endCollapseButtonPointer}
            title={leftPanelCollapsed ? "展开主机侧边栏" : "折叠主机侧边栏"}
            type="button"
          >
            <CollapseIcon className="h-4 w-4" />
          </button>
        ) : null}
        <div
          className="min-w-2 flex-1 self-stretch"
          data-tauri-drag-region
        >
        </div>
      </div>

      <div className="min-w-4 flex-1 self-stretch" data-tauri-drag-region />

      <div className="flex items-center gap-1">
        <WindowControlButton
          ariaLabel="最小化窗口"
          icon={<Minus className="h-4 w-4" />}
          onClick={() => runWindowAction("minimize")}
        />
        <WindowControlButton
          ariaLabel="最大化或还原窗口"
          icon={<Square className="h-3.5 w-3.5" />}
          onClick={() => runWindowAction("toggleMaximize")}
        />
        <WindowControlButton
          ariaLabel="关闭窗口"
          danger
          icon={<X className="h-4 w-4" />}
          onClick={() => runWindowAction("close")}
        />
      </div>
    </header>
  );
}

function WindowControlButton({
  ariaLabel,
  danger = false,
  icon,
  onClick,
}: {
  ariaLabel: string;
  danger?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "pointer-events-auto grid h-8 w-8 place-items-center rounded-xl text-zinc-500 transition hover:bg-black/6 hover:text-zinc-950 active:scale-[0.98] dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-50",
        danger &&
          "hover:bg-red-500/12 hover:text-red-600 dark:hover:text-red-300",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );
}

async function runWindowAction(
  action: "close" | "minimize" | "toggleMaximize",
) {
  if (!isTauri()) {
    return;
  }

  const appWindow = getCurrentWindow();
  if (action === "minimize") {
    await appWindow.minimize();
  } else if (action === "toggleMaximize") {
    await appWindow.toggleMaximize();
  } else {
    await appWindow.close();
  }
}

async function startWindowDragging() {
  const appWindow = getCurrentWindow();
  await appWindow.startDragging();
}
