import { ChevronDown, RefreshCw, Timer, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";

interface SystemMetricCardProps {
  children?: ReactNode;
  expanded: boolean;
  helper: string;
  icon: LucideIcon;
  onToggle: () => void;
  summary?: ReactNode;
  title: string;
  value?: ReactNode;
  withoutToggle?: boolean;
}

export function SystemMetricCard({
  children,
  expanded,
  helper,
  icon: Icon,
  onToggle,
  summary,
  title,
  value,
  withoutToggle = false,
}: SystemMetricCardProps) {
  const hasValue = value !== undefined && value !== null && value !== false;

  return (
    <section className="kerminal-solid-surface overflow-hidden rounded-[var(--radius-card)] border">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--app-accent))]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              {title}
            </div>
            <div className="mt-0.5 break-words text-xs leading-4 text-zinc-500 dark:text-zinc-400">
              {helper}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasValue ? (
            <span className="max-w-40 break-words text-right text-sm font-semibold text-[rgb(var(--app-accent))]">
              {value}
            </span>
          ) : null}
          {withoutToggle ? null : (
            <Button
              aria-expanded={expanded}
              aria-label={`${expanded ? "收起" : "展开"}${title}详情`}
              className="h-8 w-8 rounded-[var(--radius-control)]"
              onClick={onToggle}
              size="icon"
              title={`${expanded ? "收起" : "展开"}${title}详情`}
              variant="ghost"
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  !expanded && "-rotate-90",
                )}
              />
            </Button>
          )}
        </div>
      </div>
      {summary || (expanded && children) ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-3">
          {summary}
          {expanded && children ? (
            <div className={summary ? "mt-3" : undefined}>{children}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function SystemOverviewCard({
  badge,
  children,
  footer,
  icon: Icon,
  onRefresh,
  refreshAriaLabel = "刷新系统信息",
  refreshing = false,
  subtitle,
  title,
}: {
  badge?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  icon: LucideIcon;
  onRefresh?: () => void;
  refreshAriaLabel?: string;
  refreshing?: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="kerminal-solid-surface overflow-hidden rounded-[var(--radius-card)] border">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--app-accent))]" />
            <span className="truncate">{title}</span>
          </div>
          <p className="mt-1 break-all text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {onRefresh ? (
            <Button
              aria-label={refreshAriaLabel}
              onClick={onRefresh}
              size="icon"
              variant="ghost"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </Button>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="grid grid-cols-2 gap-px border-y border-[var(--border-subtle)] bg-[var(--border-subtle)] text-sm">
          {children}
        </div>
      ) : null}
      {footer ? <div className="px-3 py-2.5">{footer}</div> : null}
    </section>
  );
}

export function SystemOverviewTile({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
}) {
  return (
    <div className="kerminal-solid-surface min-w-0 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        <span>{label}</span>
      </div>
      <div className="mt-1 break-words text-sm leading-5 text-zinc-950 dark:text-zinc-100">
        {value || "-"}
      </div>
    </div>
  );
}

export function SystemMeterBar({ value }: { value: number }) {
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
      <div
        className="h-full rounded-full bg-[rgb(var(--app-accent))]"
        style={{ width: `${clampPercent(value)}%` }}
      />
    </div>
  );
}

export function SystemInfoRows({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-3 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)] text-xs">
      {children}
    </dl>
  );
}

export function SystemInfoRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 py-2">
      <dt className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
        {label === "运行时长" ||
        label === "系统运行" ||
        label === "运行时间" ? (
          <Timer className="h-3 w-3" />
        ) : null}
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 leading-5 text-zinc-700 dark:text-zinc-200",
          wide ? "break-all font-mono" : "break-words",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 100));
}
