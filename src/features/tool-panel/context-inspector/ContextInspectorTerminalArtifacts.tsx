// @author kongweiguang

import { useSyncExternalStore } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import {
  getXtermPaneArtifactSnapshot,
  subscribeXtermPaneArtifactSnapshot,
} from "../../terminal/XtermPane.artifactsRegistry";
import {
  TerminalArtifactList,
  type TerminalArtifactActionRequest,
} from "../../terminal/artifacts/public";

interface ContextInspectorTerminalArtifactsProps {
  readonly onActionRequest?: (request: TerminalArtifactActionRequest) => void;
  readonly paneId: string;
}

/** 订阅当前 pane 的易失产物快照；不持有正文，也不直接执行产物动作。 */
export function ContextInspectorTerminalArtifacts({
  onActionRequest,
  paneId,
}: ContextInspectorTerminalArtifactsProps) {
  const snapshot = useSyncExternalStore(
    (listener) => subscribeXtermPaneArtifactSnapshot(paneId, listener),
    () => getXtermPaneArtifactSnapshot(paneId),
    () => undefined,
  );
  const artifactCount = snapshot?.artifacts.length ?? 0;

  return (
    <details className="group border-t border-[var(--border-subtle)] pt-1">
      <summary className="kerminal-focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200 [&::-webkit-details-marker]:hidden">
        <Sparkles aria-hidden className="h-3.5 w-3.5" />
        终端发现
        <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">
          {artifactCount > 0 ? `${artifactCount} 项` : "暂无"}
        </span>
        <ChevronRight
          aria-hidden
          className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <TerminalArtifactList
        className="mt-2 max-h-64 overflow-hidden rounded-lg border border-[var(--border-subtle)]"
        onActionRequest={onActionRequest}
        showActions={Boolean(onActionRequest)}
        snapshot={snapshot}
      />
    </details>
  );
}
