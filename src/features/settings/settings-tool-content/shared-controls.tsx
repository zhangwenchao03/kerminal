import { Check, type LucideIcon } from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import type { KeybindingScope } from "../settingsModel";
import type { SettingsSaveState } from "./types";

export function TextSetting({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <input
        aria-label={label}
        className="mt-1 h-9 w-full rounded-xl border border-black/10 bg-white/80 px-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

export function TextAreaSetting({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="mt-3 block">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <textarea
        aria-label={label}
        className="mt-1 min-h-20 w-full resize-y rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-black/20 dark:text-zinc-100"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}
export function SettingsMetricItem({
  description,
  icon: Icon,
  label,
  value,
}: {
  description: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-black/8 bg-black/[0.025] p-3 dark:border-white/8 dark:bg-black/20">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
    </div>
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
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-black/8 bg-black/[0.03] px-3 py-2 text-sm text-zinc-700 dark:border-white/8 dark:bg-black/20 dark:text-zinc-300">
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-zinc-400" /> : null}
        <span className="min-w-0 text-left leading-5">{label}</span>
      </span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </div>
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
      <div className="mt-1 flex h-9 items-center rounded-xl border border-black/10 bg-white/80 px-2 focus-within:border-sky-500/50 focus-within:ring-4 focus-within:ring-sky-500/15 dark:border-white/10 dark:bg-black/20">
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

export function KeybindingCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 lg:text-right">
      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <kbd className="mt-1 inline-flex max-w-full rounded-lg border border-sky-400/35 bg-sky-400/10 px-2 py-1 font-mono text-xs text-sky-700 dark:text-sky-100 lg:ml-auto">
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
      <div
        className="rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100"
        role="alert"
      >
        {saveError ?? "设置保存失败，请稍后重试。"}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-100"
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
