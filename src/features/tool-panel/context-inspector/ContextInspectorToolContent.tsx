import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Clock3,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  resolveContextInspectorBoundaryFocus,
  resolveContextInspectorInitialFocus,
  type ContextInspectorFocusTarget,
} from "./contextInspectorFocusModel";
import { buildContextInspectorViewModel } from "./contextInspectorModel";
import type {
  ContextInspectorField,
  ContextInspectorToolContentProps,
} from "./contextInspectorTypes";

const toneClasses = {
  default: "text-zinc-950 dark:text-zinc-100",
  muted: "text-zinc-500 dark:text-zinc-400",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
  success: "text-emerald-700 dark:text-emerald-300",
} as const;

function StatusIcon({
  status,
}: {
  status: "ready" | "partial" | "stale" | "error";
}) {
  if (status === "error") {
    return (
      <CircleAlert
        aria-hidden
        className="h-4 w-4 text-red-600 dark:text-red-300"
      />
    );
  }
  if (status === "stale") {
    return (
      <Clock3
        aria-hidden
        className="h-4 w-4 text-amber-600 dark:text-amber-300"
      />
    );
  }
  if (status === "partial") {
    return (
      <AlertTriangle
        aria-hidden
        className="h-4 w-4 text-amber-600 dark:text-amber-300"
      />
    );
  }
  return (
    <CircleCheck
      aria-hidden
      className="h-4 w-4 text-emerald-600 dark:text-emerald-300"
    />
  );
}

function Field({
  field,
  navigationAvailable,
  onNavigate,
}: {
  field: ContextInspectorField;
  navigationAvailable: boolean;
  onNavigate?: (navigationId: string) => void;
}) {
  const content = (
    <>
      <span className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
        {field.label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-xs leading-5",
          toneClasses[field.tone ?? "default"],
        )}
        title={field.value}
      >
        {field.value}
      </span>
    </>
  );

  return field.navigationId && navigationAvailable && onNavigate ? (
    <button
      className="grid w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 rounded-md px-1 py-1.5 text-left outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-sky-500"
      data-context-focus-id={`navigation:${field.id}`}
      onClick={() => onNavigate(field.navigationId!)}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 px-1 py-1.5">
      {content}
    </div>
  );
}

/**
 * 生产级只读 Context Inspector。
 * 组件只转发 navigation id 与 action id，不解析领域对象、不直接执行副作用。
 */
export function ContextInspectorToolContent({
  context,
  actions = [],
  autoFocus = false,
  isNavigationAvailable,
  onAction,
  onNavigate,
}: ContextInspectorToolContentProps) {
  const model = useMemo(
    () => buildContextInspectorViewModel(context, actions),
    [actions, context],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const focusTargets = useMemo<readonly ContextInspectorFocusTarget[]>(
    () => [
      ...model.topActions.map((action) => ({
        id: `action:${action.id}`,
        kind: "action" as const,
        disabled: !action.available,
      })),
      ...model.sections.flatMap((section) =>
        section.fields
          .filter((field) =>
            Boolean(
              field.navigationId &&
              onNavigate &&
              isNavigationAvailable?.(field.navigationId),
            ),
          )
          .map((field) => ({
            id: `navigation:${field.id}`,
            kind: "navigation" as const,
          })),
      ),
    ],
    [isNavigationAvailable, model, onNavigate],
  );

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const targetId = resolveContextInspectorInitialFocus(focusTargets);
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-context-focus-id="${targetId}"]`)
      ?.focus();
  }, [autoFocus, focusTargets]);

  return (
    <div
      className="min-w-0 space-y-4 text-zinc-950 dark:text-zinc-100"
      onKeyDown={(event) => {
        const targetId = resolveContextInspectorBoundaryFocus(
          event.key,
          focusTargets,
        );
        if (!targetId) {
          return;
        }
        event.preventDefault();
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-context-focus-id="${targetId}"]`)
          ?.focus();
      }}
      ref={rootRef}
    >
      <header className="space-y-1 border-b border-[var(--border-subtle)] pb-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-sm font-semibold">{model.title}</h2>
            <p className="break-words text-xs text-zinc-500 dark:text-zinc-400">
              {model.subtitle}
            </p>
          </div>
          <StatusIcon status={model.status} />
        </div>
        {model.production ? (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            生产目标
          </p>
        ) : null}
      </header>

      {model.topActions.length > 0 ? (
        <section aria-labelledby="context-actions-heading">
          <h3
            className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300"
            id="context-actions-heading"
          >
            常用动作
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {model.topActions.map((action) => (
              <button
                className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-2.5 py-2 text-left text-xs outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                data-context-focus-id={`action:${action.id}`}
                disabled={!action.available}
                key={action.id}
                onClick={() => onAction?.(action.id)}
                title={action.available ? action.title : action.disabledReason}
                type="button"
              >
                <span className="min-w-0 break-words">{action.title}</span>
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="divide-y divide-[var(--border-subtle)]">
        {model.sections.map((section) => (
          <section
            aria-labelledby={`context-section-${section.id}`}
            className="py-3 first:pt-0"
            key={section.id}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3
                className="text-xs font-semibold text-zinc-600 dark:text-zinc-300"
                id={`context-section-${section.id}`}
              >
                {section.title}
              </h3>
              {section.status && section.status !== "normal" ? (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  {section.status === "error"
                    ? "错误"
                    : section.status === "stale"
                      ? "已过期"
                      : "部分可用"}
                </span>
              ) : null}
            </div>
            {section.fields.length > 0 ? (
              <div>
                {section.fields.map((field) => (
                  <Field
                    field={field}
                    key={field.id}
                    navigationAvailable={Boolean(
                      field.navigationId &&
                      isNavigationAvailable?.(field.navigationId),
                    )}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {section.emptyMessage}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
