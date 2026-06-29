import { cn } from "../../lib/cn";
import type {
  TerminalPaneMoveDropZone,
  TerminalPaneMoveScope,
} from "./terminalPaneMoveDropZones";

export interface TerminalPaneMoveIndicator {
  scope: TerminalPaneMoveScope;
  targetTitle?: string;
  zone: TerminalPaneMoveDropZone;
}

const moveZoneLabels: Record<TerminalPaneMoveDropZone, string> = {
  bottom: "下方",
  center: "中央",
  left: "左侧",
  right: "右侧",
  top: "上方",
};

const activeZoneClassName =
  "absolute rounded-xl border border-sky-300/55 bg-sky-300/10 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.58),0_18px_70px_rgba(8,47,73,0.18)] transition-[opacity,background-color,box-shadow] duration-150 dark:border-sky-200/35 dark:bg-sky-300/12 dark:shadow-black/30";
const dragPreviewSurfaceClassName =
  "pointer-events-none fixed z-[1000] aspect-[16/10] w-72 max-w-[calc(100vw-16px)] select-none overflow-hidden rounded-[4px] border border-sky-200/45 bg-[var(--surface-panel)]/92 text-zinc-800 shadow-2xl shadow-sky-950/20 ring-1 ring-white/35 backdrop-blur-[2px] dark:border-zinc-500/55 dark:text-zinc-200 dark:shadow-black/55 dark:ring-white/10";
const previewFallbackLineClasses = [
  "w-10/12 bg-sky-400/28",
  "w-8/12 bg-zinc-400/35 dark:bg-zinc-600/55",
  "w-11/12 bg-zinc-400/30 dark:bg-zinc-600/45",
  "w-7/12 bg-zinc-400/25 dark:bg-zinc-600/35",
];

export function terminalPaneMoveIndicatorLabel(
  indicator: TerminalPaneMoveIndicator,
) {
  if (indicator.scope === "workspace") {
    if (indicator.zone === "left" || indicator.zone === "right") {
      return `停靠到${moveZoneLabels[indicator.zone]}整列`;
    }
    if (indicator.zone === "top" || indicator.zone === "bottom") {
      return `停靠到${moveZoneLabels[indicator.zone]}整行`;
    }
  }
  return indicator.zone === "center"
    ? `交换位置 · ${indicator.targetTitle ?? "目标分屏"}`
    : `停靠到${moveZoneLabels[indicator.zone]} · ${indicator.targetTitle ?? "目标分屏"}`;
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
      className="pointer-events-none absolute inset-0 z-40"
      role="status"
    >
      <DropZone
        active={indicator.zone === "left"}
        zone="left"
        className={
          indicator.scope === "workspace"
            ? "bottom-3 left-3 top-3 w-[calc(50%-8px)]"
            : "bottom-4 left-4 top-4 w-[18%]"
        }
      />
      <DropZone
        active={indicator.zone === "right"}
        zone="right"
        className={
          indicator.scope === "workspace"
            ? "bottom-3 right-3 top-3 w-[calc(50%-8px)]"
            : "bottom-4 right-4 top-4 w-[18%]"
        }
      />
      <DropZone
        active={indicator.zone === "top"}
        zone="top"
        className={
          indicator.scope === "workspace"
            ? "left-3 right-3 top-3 h-[calc(50%-8px)]"
            : "left-4 right-4 top-4 h-[22%]"
        }
      />
      <DropZone
        active={indicator.zone === "bottom"}
        zone="bottom"
        className={
          indicator.scope === "workspace"
            ? "bottom-3 left-3 right-3 h-[calc(50%-8px)]"
            : "bottom-4 left-4 right-4 h-[22%]"
        }
      />
      {indicator.scope === "pane" ? (
        <DropZone
          active={indicator.zone === "center"}
          className="inset-[14%]"
          zone="center"
        />
      ) : null}
    </div>
  );
}

export function TerminalPaneMoveDragPreview({
  hint,
  lines = [],
  title,
  x,
  y,
}: {
  hint?: string;
  lines?: string[];
  title: string;
  x: number;
  y: number;
}) {
  const previewLines = terminalPaneMovePreviewLines(lines);

  return (
    <div
      aria-label={hint ? `正在拖动终端分屏：${hint}` : "正在拖动终端分屏"}
      className={dragPreviewSurfaceClassName}
      role="status"
      style={terminalPaneMovePreviewPosition(x, y)}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-overlay)]/78 px-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="min-w-0 truncate text-[10px] font-semibold leading-none">
            {title}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2 font-mono text-[10px] leading-[1.35] text-zinc-600 dark:text-zinc-300">
          {previewLines.length > 0 ? (
            previewLines.map((line, index) => (
              <div className="truncate" key={`${index}-${line}`}>
                {line}
              </div>
            ))
          ) : (
            <div className="space-y-1.5 pt-1">
              {previewFallbackLineClasses.map((className, index) => (
                <div
                  aria-hidden="true"
                  className={cn("h-1.5 rounded-full", className)}
                  key={index}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function terminalPaneMovePreviewPosition(x: number, y: number) {
  const width = 288;
  const height = 180;
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

export function terminalPaneMovePreviewLines(lines: string[]) {
  return lines
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-8);
}

function DropZone({
  active,
  className,
  zone,
}: {
  active: boolean;
  className: string;
  zone: TerminalPaneMoveDropZone;
}) {
  if (!active) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={cn(activeZoneClassName, className)}
      data-terminal-pane-move-drop-zone={zone}
    />
  );
}
