import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import { cn } from "../../../lib/cn";
import { buildUserFacingError } from "../../../lib/userFacingMessage";
import type { KeybindingScope } from "../settingsModel";
import type { SettingsSaveState } from "./types";

/**
 * 设置页的本地渐进披露容器；搜索命中时可展开，但不改变配置状态。
 */
export function SettingsDisclosure({
  children,
  reveal = false,
  summary,
  targetId,
  title,
}: {
  children: ReactNode;
  reveal?: boolean;
  summary?: ReactNode;
  targetId?: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (reveal) {
      setOpen(true);
    }
  }, [reveal]);

  return (
    <details
      className="group overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)]"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary
        className="kerminal-focus-ring kerminal-pressable flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-left text-[13px] text-[var(--text-primary)] marker:hidden hover:bg-[var(--surface-hover)]"
        id={targetId}
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150 group-open:rotate-90" />
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        {summary ? (
          <span className="min-w-0 max-w-[55%] truncate text-xs text-zinc-500 dark:text-zinc-400">
            {summary}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-[var(--border-subtle)] p-3">{children}</div>
    </details>
  );
}

export function PolicyToggle({
  checked,
  icon: Icon,
  label,
  onChange,
}: {
  checked: boolean;
  icon?: LucideIcon;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "group kerminal-focus-ring kerminal-pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2 text-left text-[13px] text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]",
        checked &&
          "border-sky-400/30 bg-[var(--surface-selected)] text-zinc-950 dark:text-zinc-100",
      )}
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-zinc-400" /> : null}
        <span className="min-w-0 text-left leading-5">{label}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-hover)] p-0.5 transition-[background-color,border-color,box-shadow,opacity] duration-150",
          checked
            ? "border-[rgb(var(--app-accent)/0.4)] bg-[rgb(var(--app-accent))]"
            : "group-hover:bg-[var(--surface-muted)]",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow-sm shadow-black/20 transition-transform duration-150",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

export function NumberSetting({
  displayScale = 1,
  help,
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  displayScale?: number;
  help?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  const displayValue = scaledDisplayValue(value, displayScale);

  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="kerminal-field-surface mt-1 flex h-9 items-center rounded-[var(--radius-control)] border px-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent px-1 text-sm text-zinc-950 outline-none dark:text-zinc-100"
          max={scaledDisplayValue(max, displayScale)}
          min={scaledDisplayValue(min, displayScale)}
          onChange={(event) =>
            onChange(
              scaledStorageValue(
                Number(event.currentTarget.value),
                displayScale,
              ),
            )
          }
          step={scaledDisplayValue(step, displayScale)}
          type="number"
          value={displayValue}
        />
        {suffix ? (
          <span className="shrink-0 text-xs text-zinc-500">{suffix}</span>
        ) : null}
      </div>
      {help ? (
        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {help}
        </p>
      ) : null}
    </label>
  );
}

function scaledDisplayValue(value: number, scale: number) {
  const normalized = value / scale;
  return Number(normalized.toFixed(4));
}

function scaledStorageValue(value: number, scale: number) {
  return scale === 1 ? value : Math.round(value * scale);
}

export function KeybindingCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 lg:text-right">
      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <kbd className="mt-1 inline-flex max-w-full rounded-md border border-sky-400/30 bg-[var(--surface-selected)] px-2 py-1 font-mono text-xs text-sky-700 dark:text-sky-100 lg:ml-auto">
        <span className="truncate">{value || "未设置"}</span>
      </kbd>
    </div>
  );
}

export function SettingsSaveNotice({
  saveError,
  saveState,
}: {
  saveError?: string | null;
  saveState: SettingsSaveState;
}) {
  if (saveState === "idle") {
    return null;
  }

  if (saveState === "error") {
    return (
      <UserFacingNotice
        compact
        message={
          saveError
            ? buildUserFacingError(saveError, {
                detail: "刚才的更改可能尚未写入本地配置。",
                recoveryAction: "请检查配置目录权限后重试。",
                title: "设置未保存",
              })
            : {
                detail: "刚才的更改可能尚未写入本地配置。",
                recoveryAction: "请稍后重试。",
                severity: "error",
                title: "设置未保存",
              }
        }
      />
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-100"
      role="status"
    >
      {saveState === "saved" ? <Check className="h-4 w-4" /> : null}
      {saveState === "saving" ? "正在保存设置..." : "设置已保存"}
    </div>
  );
}
export function scopeLabel(scope: KeybindingScope) {
  if (scope === "global") {
    return "全局";
  }
  if (scope === "terminal") {
    return "终端";
  }
  return "工作区";
}
