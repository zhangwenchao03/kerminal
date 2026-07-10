import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  X,
} from "lucide-react";
import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import {
  resolveDesktopPlatform,
  type DesktopPlatform,
} from "../lib/desktopPlatform";
import {
  resolveWindowChromeModel,
  type WindowChromeModel,
} from "../lib/windowChromeModel";
import {
  runWindowAction,
  startWindowDragging,
} from "../lib/windowActions";
import type { WindowFrameState } from "../lib/useTauriWindowFrameState";

interface AppTitleBarProps {
  className?: string;
  desktopPlatform?: DesktopPlatform;
  leftPanelCollapsed?: boolean;
  resolvedTheme: "dark" | "light";
  surface?: boolean;
  onLeftPanelCollapsedChange?: (collapsed: boolean) => void;
  windowFrameState?: WindowFrameState;
}

const MACOS_TRAFFIC_LIGHT_INSET = 72;

export function AppTitleBar({
  className,
  desktopPlatform = resolveDesktopPlatform(),
  leftPanelCollapsed = false,
  onLeftPanelCollapsedChange,
  resolvedTheme,
  surface = true,
  windowFrameState = "normal",
}: AppTitleBarProps) {
  const CollapseIcon = leftPanelCollapsed ? PanelLeftOpen : PanelLeftClose;
  const windowChrome = resolveWindowChromeModel({
    frameState: windowFrameState,
    platform: desktopPlatform,
  });
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
      data-desktop-platform={desktopPlatform}
      data-traffic-light-inset={
        windowChrome.reserveTrafficLightInset ? "true" : undefined
      }
      data-tauri-drag-region
      style={
        windowChrome.reserveTrafficLightInset
          ? { paddingLeft: MACOS_TRAFFIC_LIGHT_INSET }
          : undefined
      }
    >
      <div
        className="pointer-events-auto flex min-w-0 items-center gap-2"
        data-tauri-drag-region
      >
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

      {windowChrome.controlMode === "custom" ? (
        <CustomWindowControls windowChrome={windowChrome} />
      ) : null}
    </header>
  );
}

function CustomWindowControls({
  windowChrome,
}: {
  windowChrome: WindowChromeModel;
}) {
  const maximizeLabel = windowChrome.showRestoreIcon
    ? "还原窗口"
    : "最大化窗口";

  return (
    <div aria-label="窗口控制" className="flex items-center gap-1">
      <WindowControlButton
        ariaLabel="最小化窗口"
        icon={<Minus className="h-4 w-4" />}
        onClick={() => runWindowAction("minimize")}
      />
      {windowChrome.showMaximizeControl ? (
        <WindowControlButton
          ariaLabel={maximizeLabel}
          icon={
            windowChrome.showRestoreIcon ? (
              <Copy
                className="h-3.5 w-3.5"
                data-window-control-icon="restore"
              />
            ) : (
              <Square
                className="h-3.5 w-3.5"
                data-window-control-icon="maximize"
              />
            )
          }
          onClick={() => runWindowAction("toggleMaximize")}
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-7 w-7"
          data-window-control-placeholder="maximize"
        />
      )}
      <WindowControlButton
        ariaLabel="关闭窗口"
        danger
        icon={<X className="h-4 w-4" />}
        onClick={() => runWindowAction("close")}
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
      title={ariaLabel}
      type="button"
    >
      {icon}
    </button>
  );
}
