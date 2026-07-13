import { cn } from "../../lib/cn";
import type { TerminalSplitDropZone } from "./terminalSplitDropZones";

export type TerminalSplitDropIndicator = {
  machineName: string;
  zone: TerminalSplitDropZone;
};

const dropZoneLabels: Record<TerminalSplitDropZone, string> = {
  bottom: "下方",
  left: "左侧",
  right: "右侧",
  top: "上方",
};

const baseZoneClassName =
  "absolute rounded-[var(--radius-panel)] border border-sky-300/35 bg-sky-500/10 transition-[opacity,background-color,box-shadow] duration-150 dark:border-sky-300/25 dark:bg-sky-300/10";
const idleZoneClassName = "opacity-45";
const activeZoneClassName =
  "opacity-100 shadow-[inset_0_0_0_2px_rgba(14,165,233,0.42),0_18px_55px_rgba(14,165,233,0.18)]";

export function TerminalSplitDropOverlay({
  indicator,
}: {
  indicator: TerminalSplitDropIndicator;
}) {
  const label = dropZoneLabels[indicator.zone];

  return (
    <div
      aria-label={`主机分屏拖放目标：${label}`}
      className="pointer-events-none absolute inset-0 z-30 rounded-[var(--radius-panel)] ring-2 ring-sky-400/30"
      role="status"
    >
      <div className="absolute left-1/2 top-4 z-10 max-w-[calc(100%-32px)] -translate-x-1/2 truncate rounded-full border border-sky-300/35 bg-[var(--surface-overlay)] px-3 py-1.5 text-xs font-medium text-sky-700 shadow-lg shadow-sky-950/10 backdrop-blur-xl dark:border-sky-300/20 dark:text-sky-100 dark:shadow-black/40">
        分屏到{label} · {indicator.machineName}
      </div>
      <DropZone active={indicator.zone === "left"} className="bottom-4 left-4 top-4 w-[18%]" />
      <DropZone active={indicator.zone === "right"} className="bottom-4 right-4 top-4 w-[18%]" />
      <DropZone active={indicator.zone === "top"} className="left-4 right-4 top-4 h-[22%]" />
      <DropZone active={indicator.zone === "bottom"} className="bottom-4 left-4 right-4 h-[22%]" />
    </div>
  );
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
