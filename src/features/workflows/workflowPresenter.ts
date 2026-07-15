import { cn } from "../../lib/cn";
import type { WorkflowScope } from "../../lib/workflowApi";

export const workflowScopeFilterOptions = [
  { label: "全部", value: "" },
  { label: "通用", value: "any" },
  { label: "本地", value: "local" },
  { label: "SSH", value: "ssh" },
];

export const workflowScopeOptions = workflowScopeFilterOptions.slice(1);

export const workflowStepScopeOptions = [
  { label: "继承", value: "" },
  ...workflowScopeOptions,
];

export const workflowPanelClassName =
  "kerminal-solid-surface rounded-[var(--radius-card)] border p-4";
export const workflowMutedPanelClassName =
  "rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-4 text-sm text-zinc-500 dark:text-zinc-400";
export const workflowInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border px-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";
export const workflowSearchInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";
export const workflowMonoInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border px-3 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";
export const workflowTextareaClassName =
  "kerminal-field-surface min-h-20 w-full resize-y rounded-xl border px-3 py-2 font-mono text-xs leading-5 text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

export function workflowNoticeClassName(
  kind: "error" | "success" | "warning",
  className?: string,
) {
  return cn(
    "rounded-xl border px-3 py-2 text-sm",
    kind === "error" &&
      "border-rose-300/25 bg-rose-500/10 text-rose-700 dark:text-rose-100",
    kind === "success" &&
      "border-emerald-300/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100",
    kind === "warning" &&
      "border-amber-300/20 bg-amber-400/10 text-amber-700 dark:text-amber-100",
    className,
  );
}

export function workflowScopeLabel(scope: WorkflowScope) {
  const labels: Record<WorkflowScope, string> = {
    any: "通用",
    local: "本地终端",
    ssh: "SSH 远程",
  };
  return labels[scope];
}
