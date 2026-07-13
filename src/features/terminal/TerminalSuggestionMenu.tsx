// @author kongweiguang

import { AlertTriangle, Clock3 } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import {
  terminalSuggestionMenuCandidateView,
  terminalSuggestionMenuCandidateIntent,
  type TerminalSuggestionMenuIntent,
  type TerminalSuggestionMenuState,
} from "./terminalSuggestionMenuModel";
import {
  resolveTerminalSuggestionMenuPosition,
  type TerminalSuggestionMenuAnchor,
  type TerminalSuggestionMenuPosition,
  type TerminalSuggestionPaneSize,
} from "./terminalSuggestionMenuPosition";

export interface TerminalSuggestionMenuProps {
  anchor: TerminalSuggestionMenuAnchor;
  ariaLabel?: string;
  devicePixelRatio?: number;
  onIntent: (intent: TerminalSuggestionMenuIntent) => void;
  paneSize: TerminalSuggestionPaneSize;
  state: TerminalSuggestionMenuState;
}

const initialPosition: TerminalSuggestionMenuPosition = {
  left: 8,
  maxHeight: 320,
  placement: "below",
  top: 8,
  width: 420,
};

/**
 * 终端 pane 内候选列表。组件不请求数据、不修改输入，只渲染状态并上报用户意图。
 */
export function TerminalSuggestionMenu({
  anchor,
  ariaLabel = "终端命令候选",
  devicePixelRatio,
  onIntent,
  paneSize,
  state,
}: TerminalSuggestionMenuProps) {
  const listboxId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(initialPosition);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!state.open || !menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    const next = resolveTerminalSuggestionMenuPosition({
      anchor,
      devicePixelRatio:
        devicePixelRatio ??
        (typeof window === "undefined" ? 1 : window.devicePixelRatio),
      menuSize: {
        height: menu.scrollHeight || menu.offsetHeight || rect.height,
        width: menu.offsetWidth || rect.width || initialPosition.width,
      },
      paneSize,
    });
    setPosition((current) =>
      samePosition(current, next) ? current : next,
    );
  }, [
    anchor.height,
    anchor.x,
    anchor.y,
    devicePixelRatio,
    paneSize.height,
    paneSize.width,
    state.candidates.length,
    state.open,
  ]);

  if (!state.open || state.candidates.length === 0) {
    return null;
  }

  const activeOptionId = `${listboxId}-option-${state.selectedIndex}`;
  const activeView = terminalSuggestionMenuCandidateView(
    state.candidates[state.selectedIndex],
    state.stale,
  );

  return (
    <div
      aria-activedescendant={activeOptionId}
      aria-label={ariaLabel}
      className="kerminal-floating-enter absolute z-40 overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--surface-overlay)] p-1 text-[var(--foreground)] shadow-[var(--shadow-floating)] backdrop-blur-xl outline-none"
      data-placement={position.placement}
      id={listboxId}
      onMouseDown={(event) => event.preventDefault()}
      ref={menuRef}
      role="listbox"
      style={{
        left: position.left,
        maxHeight: position.maxHeight,
        top: position.top,
        width: position.width,
      }}
      tabIndex={-1}
    >
      <span aria-live="polite" className="sr-only">
        {candidateAriaLabel(activeView)}
      </span>
      {state.candidates.map((candidate, index) => {
        const selected = index === state.selectedIndex;
        const view = terminalSuggestionMenuCandidateView(
          candidate,
          state.stale,
        );
        return (
          <div
            aria-label={candidateAriaLabel(view)}
            aria-selected={selected}
            className={cn(
              "flex min-h-12 cursor-default items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
              selected
                ? "bg-[var(--surface-selected)]"
                : "hover:bg-[var(--surface-hover)]",
              view.dangerous
                ? "text-rose-700 dark:text-rose-200"
                : "text-[var(--foreground)]",
            )}
            data-dangerous={view.dangerous ? "true" : undefined}
            data-provider={candidate.provider}
            data-stale={view.stale ? "true" : undefined}
            id={`${listboxId}-option-${index}`}
            key={candidate.id}
            onClick={() =>
              onIntent(terminalSuggestionMenuCandidateIntent(candidate))
            }
            onMouseEnter={() => onIntent({ index, type: "move" })}
            role="option"
          >
            {view.dangerous ? (
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-rose-500 dark:text-rose-300"
              />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px] leading-5">
                {candidate.displayText}
              </span>
              {view.description ? (
                <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--muted-foreground)]">
                  {view.description}
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[10px] leading-4 text-[var(--muted-foreground)]">
              {view.stale ? (
                <Clock3 aria-label="缓存结果" className="h-3 w-3" />
              ) : null}
              {view.dangerous ? (
                <span className="font-medium text-rose-600 dark:text-rose-300">
                  危险
                </span>
              ) : null}
              <span>{view.providerLabel}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function candidateAriaLabel(
  view: ReturnType<typeof terminalSuggestionMenuCandidateView>,
) {
  return [
    view.candidate.displayText,
    view.description,
    view.providerLabel,
    view.dangerous ? "危险命令" : undefined,
    view.stale ? "缓存结果" : undefined,
  ]
    .filter(Boolean)
    .join("，");
}

function samePosition(
  left: TerminalSuggestionMenuPosition,
  right: TerminalSuggestionMenuPosition,
) {
  return (
    left.left === right.left &&
    left.maxHeight === right.maxHeight &&
    left.placement === right.placement &&
    left.top === right.top &&
    left.width === right.width
  );
}
