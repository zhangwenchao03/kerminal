import {
  ArrowDownToLine,
  Bell,
  CircleAlert,
  CircleDot,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { TerminalPaneAttention } from "./terminalPaneActivityModel";
import {
  buildTerminalTabAttentionLabel,
  buildTerminalTabProgressLabel,
  type TerminalTabConnectionProgress,
} from "./terminalTabPresentationModel";

/** 终端 Tab attention 图标的展示参数。 */
export interface TerminalTabAttentionProps {
  attention: TerminalPaneAttention;
  className?: string;
  count?: number;
  label?: string;
  progress?: TerminalTabConnectionProgress;
}

interface AttentionVisual {
  className: string;
  icon: LucideIcon;
}

const ATTENTION_VISUALS: Record<
  Exclude<TerminalPaneAttention, "none">,
  AttentionVisual
> = {
  bell: {
    className: "text-amber-600 dark:text-amber-400",
    icon: Bell,
  },
  disconnected: {
    className: "text-red-600 dark:text-red-400",
    icon: WifiOff,
  },
  error: {
    className: "text-red-600 dark:text-red-400",
    icon: CircleAlert,
  },
  followPaused: {
    className: "text-sky-600 dark:text-sky-400",
    icon: ArrowDownToLine,
  },
  unread: {
    className: "text-sky-600 dark:text-sky-400",
    icon: CircleDot,
  },
  warning: {
    className: "text-amber-600 dark:text-amber-400",
    icon: TriangleAlert,
  },
};

const PROGRESS_VISUALS: Record<
  Exclude<TerminalTabConnectionProgress, "none">,
  AttentionVisual
> = {
  connecting: {
    className: "text-[var(--text-secondary)]",
    icon: LoaderCircle,
  },
  reconnecting: {
    className: "text-[var(--text-secondary)]",
    icon: RefreshCw,
  },
};

/** 用图标、短标签和可选计数表达 Tab attention 或低干扰连接进度。 */
export function TerminalTabAttention({
  attention,
  className,
  count = 1,
  label,
  progress = "none",
}: TerminalTabAttentionProps) {
  const visual =
    attention !== "none"
      ? ATTENTION_VISUALS[attention]
      : progress !== "none"
        ? PROGRESS_VISUALS[progress]
        : null;
  if (!visual) {
    return null;
  }

  const statusLabel =
    label ||
    (attention !== "none"
      ? buildTerminalTabAttentionLabel(attention, count)
      : buildTerminalTabProgressLabel(progress, count));
  const Icon = visual.icon;
  const announce =
    attention === "error" || attention === "disconnected"
      ? { "aria-live": "polite" as const, role: "status" as const }
      : {};

  return (
    <span
      {...announce}
      aria-label={statusLabel}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5",
        visual.className,
        className,
      )}
      title={statusLabel}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      {count > 1 ? (
        <span aria-hidden="true" className="text-[10px] font-semibold tabular-nums">
          {count}
        </span>
      ) : null}
      <span className="sr-only">{statusLabel}</span>
    </span>
  );
}
