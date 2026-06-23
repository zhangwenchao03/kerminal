import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Settings, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import type { SectionTab } from "./model";

export function DeferredSection({
  modeLabel,
  section,
}: {
  modeLabel: string;
  section?: SectionTab;
}) {
  const Icon = section?.Icon ?? Settings;
  return (
    <div className="kerminal-muted-surface flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed p-6 text-center">
      <div className="max-w-sm">
        <Icon className="mx-auto h-8 w-8 text-zinc-400" />
        <h3 className="mt-3 text-sm font-semibold">
          {section?.label ?? "配置"}后续接入
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          {section?.description ??
            `${modeLabel} 的这一组高级配置会在后续迭代接入。`}
        </p>
      </div>
    </div>
  );
}

export function FieldRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-[84px_minmax(0,1fr)] md:items-start">
      <span className="pt-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {label}:
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const inputClassName =
  "kerminal-field-surface h-10 w-full rounded-xl border px-3 text-sm text-zinc-950 placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-100 dark:placeholder:text-zinc-600";

export function HelpCard({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="kerminal-solid-surface rounded-2xl border p-4">
      <div className="flex items-start gap-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        {icon}
        <p className="min-w-0 flex-1">{text}</p>
      </div>
    </div>
  );
}

export function ToggleRow({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="kerminal-field-surface flex h-10 items-center justify-between gap-3 rounded-xl border px-3 text-sm text-zinc-600 dark:text-zinc-300">
      <span className="truncate">{label}</span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function EmptyConfigState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="kerminal-muted-surface flex items-center gap-3 rounded-2xl border border-dashed px-4 py-5 text-sm text-zinc-500 dark:text-zinc-400">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-hover)] text-zinc-500 dark:text-zinc-300">
        {icon}
      </div>
      <p className="min-w-0 flex-1 leading-6">{text}</p>
    </div>
  );
}

export function ConfigList({ children }: { children: ReactNode }) {
  return <div className="grid gap-2">{children}</div>;
}

export function ConfigListItem({
  actions,
  meta,
  title,
}: {
  actions: ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <div className="kerminal-solid-surface grid gap-3 rounded-2xl border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {title}
        </p>
        <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {meta}
        </p>
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

export function ListReorderActions({
  canMoveDown,
  canMoveUp,
  onDelete,
  onMoveDown,
  onMoveUp,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  onDelete: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
}) {
  return (
    <>
      <Button
        aria-label="上移"
        disabled={!canMoveUp}
        onClick={onMoveUp}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        aria-label="下移"
        disabled={!canMoveDown}
        onClick={onMoveDown}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        aria-label="删除"
        onClick={onDelete}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  );
}

export function protocolButtonClassName(selected: boolean, disabled: boolean) {
  return [
    "flex h-16 min-w-[72px] flex-col items-center justify-center gap-1 rounded-xl px-3 text-sm font-medium transition",
    selected
      ? "bg-[var(--surface-selected)] text-sky-700 shadow-sm dark:text-sky-100"
      : "text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
    disabled ? "cursor-not-allowed opacity-42 hover:bg-transparent" : "",
  ].join(" ");
}

export function sectionButtonClassName(selected: boolean) {
  return [
    "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition",
    selected
      ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
      : "text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
  ].join(" ");
}
