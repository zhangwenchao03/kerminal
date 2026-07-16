// @author kongweiguang

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Copy,
  ExternalLink,
  FolderSearch,
} from "lucide-react";
import { cn } from "../../../../lib/cn";
import {
  createTerminalArtifactViewModel,
  type TerminalArtifactActionRequest,
  type TerminalArtifactUiAction,
} from "../actions";
import type { TerminalArtifact, TerminalArtifactIndexSnapshot } from "../types";
import { resolveTerminalArtifactListKeyboardCommand } from "./terminalArtifactListModel";

type TerminalArtifactListStatus = "ready" | "partial";

/** Terminal Artifacts 独立列表入口；调用方负责动作执行、确认和 Agent preview。 */
export interface TerminalArtifactListProps {
  artifacts?: readonly TerminalArtifact[];
  className?: string;
  onActionRequest?: (request: TerminalArtifactActionRequest) => void;
  /** 只读消费方关闭动作区时，不保留任何无效按钮或键盘执行入口。 */
  showActions?: boolean;
  snapshot?: TerminalArtifactIndexSnapshot;
  status?: TerminalArtifactListStatus;
}

const ACTION_ICONS = {
  copy: Copy,
  open: ExternalLink,
  reveal: FolderSearch,
  "send-to-agent": Bot,
} as const;
const EMPTY_ARTIFACTS: readonly TerminalArtifact[] = [];

export function TerminalArtifactList({
  artifacts,
  className,
  onActionRequest,
  showActions = true,
  snapshot,
  status = "ready",
}: TerminalArtifactListProps) {
  const items = artifacts ?? snapshot?.artifacts ?? EMPTY_ARTIFACTS;
  const viewModels = useMemo(
    () => items.map(createTerminalArtifactViewModel),
    [items],
  );
  const listId = useId();
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const degraded = snapshot?.degraded ?? false;

  useEffect(() => {
    setActiveIndex((current) =>
      viewModels.length === 0 ? 0 : Math.min(current, viewModels.length - 1),
    );
  }, [viewModels.length]);

  const invokePrimaryAction = (index: number) => {
    const artifact = items[index];
    const action = viewModels[index]?.actions.find(
      (candidate) => candidate.enabled,
    );
    if (artifact && action && showActions && onActionRequest) {
      onActionRequest({ actionId: action.id, artifact, route: action.route });
    }
  };

  return (
    <section
      aria-busy={status === "partial"}
      aria-label="终端产物"
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-[var(--surface-panel)] text-zinc-900 dark:text-zinc-100",
        className,
      )}
    >
      {(status === "partial" || degraded) && (
        <div
          className="flex min-h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          role="status"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            {degraded ? "检测已降级，部分产物可能未显示" : "产物仍在更新"}
          </span>
        </div>
      )}
      {viewModels.length === 0 ? (
        <div className="flex min-h-32 flex-1 items-center justify-center px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          当前终端尚未检测到可用产物
        </div>
      ) : (
        <ul
          aria-label="检测到的终端产物"
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          id={listId}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            const command = resolveTerminalArtifactListKeyboardCommand({
              currentIndex: activeIndex,
              itemCount: viewModels.length,
              key: event.key,
            });
            if (command.type === "none") {
              return;
            }
            event.preventDefault();
            if (command.type === "invoke") {
              invokePrimaryAction(command.index);
              return;
            }
            setActiveIndex(command.index);
            itemRefs.current[command.index]?.focus();
          }}
          role="list"
        >
          {viewModels.map((item, index) => {
            const artifact = items[index];
            return (
              <li
                aria-label={`${item.kindLabel}：${item.label}`}
                className={cn(
                  "mx-1 min-w-0 rounded-md border border-transparent px-2 py-2 outline-none",
                  index === activeIndex &&
                    "border-[var(--border-subtle)] bg-[var(--surface-hover)]",
                )}
                id={`${listId}-item-${index}`}
                key={item.id}
                onClick={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                role="listitem"
                tabIndex={index === activeIndex ? 0 : -1}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{item.kindLabel}</span>
                      <span>{item.sourceLabel}</span>
                      <span className="truncate">{item.targetLabel}</span>
                      {item.sensitivity !== "normal" && (
                        <span className="text-amber-700 dark:text-amber-300">
                          {item.sensitivityLabel}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {showActions && onActionRequest ? (
                  <div
                    aria-label={`${item.label}可用动作`}
                    className="mt-2 flex min-w-0 flex-wrap gap-1"
                    role="group"
                  >
                    {item.actions.map((action) => (
                      <ArtifactActionButton
                        action={action}
                        key={action.id}
                        onRequest={() => {
                          if (artifact) {
                            onActionRequest({
                              actionId: action.id,
                              artifact,
                              route: action.route,
                            });
                          }
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ArtifactActionButton({
  action,
  onRequest,
}: {
  action: TerminalArtifactUiAction;
  onRequest: () => void;
}) {
  const Icon = ACTION_ICONS[action.id];
  return (
    <button
      aria-label={action.label}
      className="kerminal-focus-ring inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs text-zinc-600 hover:bg-[var(--surface-field-hover)] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:text-zinc-50"
      disabled={!action.enabled}
      onClick={onRequest}
      title={!action.enabled ? action.disabledReason : action.label}
      type="button"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden min-[320px]:inline">{action.label}</span>
    </button>
  );
}
