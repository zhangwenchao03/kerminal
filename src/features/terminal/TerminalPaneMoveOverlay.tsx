import { GripVertical } from "lucide-react";
import { cn } from "../../lib/cn";
import type { TerminalPaneMoveDropZone } from "./terminalPaneMoveDropZones";

export interface TerminalPaneMoveIndicator {
  targetTitle: string;
  zone: TerminalPaneMoveDropZone;
}

const moveZoneLabels: Record<TerminalPaneMoveDropZone, string> = {
  bottom: "下方",
  center: "中央",
  left: "左侧",
  right: "右侧",
  top: "上方",
};

const baseZoneClassName =
  "absolute rounded-xl border border-amber-300/40 bg-amber-500/10 transition-[opacity,background-color,box-shadow] duration-150 dark:border-amber-200/30 dark:bg-amber-300/10";
const idleZoneClassName = "opacity-30";
const activeZoneClassName =
  "opacity-100 shadow-[inset_0_0_0_2px_rgba(245,158,11,0.44),0_18px_55px_rgba(245,158,11,0.18)]";
const dragPreviewSurfaceClassName =
  "pointer-events-none fixed z-[1000] w-64 select-none rounded-2xl border border-amber-300/60 bg-[var(--surface-overlay)] p-3 text-sm text-zinc-950 shadow-2xl shadow-amber-900/20 ring-4 ring-amber-400/18 backdrop-blur-xl dark:border-amber-200/35 dark:text-zinc-50 dark:shadow-black/50";
const dragPreviewHintClassName =
  "mt-2 rounded-xl bg-amber-400/12 px-3 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-300/12 dark:text-amber-100";

export function terminalPaneMoveIndicatorLabel(
  indicator: TerminalPaneMoveIndicator,
) {
  return indicator.zone === "center"
    ? `交换位置 · ${indicator.targetTitle}`
    : `移动到${moveZoneLabels[indicator.zone]} · ${indicator.targetTitle}`;
}

export function TerminalPaneMoveOverlay({
  indicator,
}: {
  indicator: TerminalPaneMoveIndicator;
}) {
  const label = terminalPaneMoveIndicatorLabel(indicator);

  return (
    <div
      aria-label={`终端分屏移动目标：${label}`}
      className="pointer-events-none absolute inset-0 z-40 rounded-2xl ring-2 ring-amber-400/30"
      role="status"
    >
      <div className="absolute left-1/2 top-4 z-10 max-w-[calc(100%-32px)] -translate-x-1/2 truncate rounded-full border border-amber-300/40 bg-[var(--surface-overlay)] px-3 py-1.5 text-xs font-medium text-amber-700 shadow-lg shadow-amber-950/10 backdrop-blur-xl dark:border-amber-200/25 dark:text-amber-100 dark:shadow-black/40">
        {label}
      </div>
      <DropZone active={indicator.zone === "left"} className="bottom-4 left-4 top-4 w-[18%]" />
      <DropZone active={indicator.zone === "right"} className="bottom-4 right-4 top-4 w-[18%]" />
      <DropZone active={indicator.zone === "top"} className="left-4 right-4 top-4 h-[22%]" />
      <DropZone active={indicator.zone === "bottom"} className="bottom-4 left-4 right-4 h-[22%]" />
      <DropZone active={indicator.zone === "center"} className="inset-[28%]" />
    </div>
  );
}

export function TerminalPaneMoveDragPreview({
  hint,
  title,
  x,
  y,
}: {
  hint?: string;
  title: string;
  x: number;
  y: number;
}) {
  return (
    <div
      aria-label="正在拖动终端分屏"
      className={dragPreviewSurfaceClassName}
      role="status"
      style={terminalPaneMovePreviewPosition(x, y)}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/12 text-amber-700 dark:bg-amber-300/14 dark:text-amber-100">
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            终端分屏
          </span>
        </span>
      </div>
      <div className={dragPreviewHintClassName}>
        {hint ? `松开：${hint}` : "拖到其它分屏后松开"}
      </div>
    </div>
  );
}

export function terminalPaneMovePreviewPosition(x: number, y: number) {
  const width = 264;
  const height = 88;
  if (typeof window === "undefined") {
    return {
      left: x + 16,
      top: y + 12,
      transform: "rotate(1deg)",
    };
  }
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - height - 8);
  return {
    left: Math.min(Math.max(x + 16, 8), maxLeft),
    top: Math.min(Math.max(y + 12, 8), maxTop),
    transform: "rotate(1deg)",
  };
}

function DropZone({ active, className }: { active: boolean; className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        baseZoneClassName,
        active ? activeZoneClassName : idleZoneClassName,
        className,
      )}
    />
  );
}
