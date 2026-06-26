import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { shortcutPlatform } from "../features/settings/keybindingUtils";
import type { KeybindingPlatform } from "../features/settings/settingsModel";
import { cn } from "../lib/cn";

interface AppTitleBarProps {
  className?: string;
  leftPanelCollapsed?: boolean;
  resolvedTheme: "dark" | "light";
  surface?: boolean;
  onLeftPanelCollapsedChange?: (collapsed: boolean) => void;
  windowControlPlatform?: KeybindingPlatform;
}

export function AppTitleBar({
  className,
  leftPanelCollapsed = false,
  onLeftPanelCollapsedChange,
  resolvedTheme,
  surface = true,
  windowControlPlatform = shortcutPlatform(),
}: AppTitleBarProps) {
  const CollapseIcon = leftPanelCollapsed ? PanelLeftOpen : PanelLeftClose;
  const macWindowControls = windowControlPlatform === "mac";
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
        "flex h-9 shrink-0 select-none items-center justify-between px-2.5",
        surface && "kerminal-material-nav border-b",
        resolvedTheme === "dark"
          ? "text-zinc-100"
          : "text-zinc-950",
        className,
      )}
      data-tauri-drag-region
    >
      <div
        className={cn(
          "pointer-events-auto flex min-w-0 items-center gap-2",
          macWindowControls && "gap-3",
        )}
        data-tauri-drag-region
      >
        {macWindowControls ? <MacWindowControls /> : null}
        {onLeftPanelCollapsedChange ? (
          <button
            aria-label={leftPanelCollapsed ? "展开主机侧边栏" : "折叠主机侧边栏"}
            aria-pressed={leftPanelCollapsed}
            className="kerminal-pressable kerminal-focus-ring grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
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

      {macWindowControls ? null : <WindowsWindowControls />}
    </header>
  );
}

function WindowsWindowControls() {
  return (
    <div aria-label="窗口控制" className="flex items-center gap-1">
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
  );
}

function MacWindowControls() {
  return (
    <div aria-label="窗口控制" className="flex items-center gap-2">
      <MacWindowControlButton
        ariaLabel="关闭窗口"
        className="border-red-500/40 bg-red-500 text-red-950/70 hover:bg-red-400"
        icon={<X className="h-2.5 w-2.5" />}
        onClick={() => runWindowAction("close")}
      />
      <MacWindowControlButton
        ariaLabel="最小化窗口"
        className="border-yellow-500/40 bg-yellow-400 text-yellow-950/70 hover:bg-yellow-300"
        icon={<Minus className="h-2.5 w-2.5" />}
        onClick={() => runWindowAction("minimize")}
      />
      <MacWindowControlButton
        ariaLabel="最大化或还原窗口"
        className="border-emerald-500/40 bg-emerald-500 text-emerald-950/70 hover:bg-emerald-400"
        icon={<Square className="h-2 w-2" />}
        onClick={() => runWindowAction("toggleMaximize")}
      />
    </div>
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
        "kerminal-pressable kerminal-focus-ring pointer-events-auto grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50",
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

function MacWindowControlButton({
  ariaLabel,
  className,
  icon,
  onClick,
}: {
  ariaLabel: string;
  className: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "group kerminal-focus-ring pointer-events-auto grid h-3.5 w-3.5 place-items-center rounded-full border shadow-sm shadow-black/15 transition-[background-color,box-shadow,filter] duration-150",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        {icon}
      </span>
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
