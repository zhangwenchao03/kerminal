// @author kongweiguang

import { useSyncExternalStore } from "react";
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

  return (
    <section
      aria-labelledby="context-terminal-artifacts-heading"
      className="border-t border-[var(--border-subtle)] pt-3"
    >
      <h3
        className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300"
        id="context-terminal-artifacts-heading"
      >
        终端产物
      </h3>
      <TerminalArtifactList
        className="max-h-72"
        onActionRequest={onActionRequest}
        showActions={Boolean(onActionRequest)}
        snapshot={snapshot}
      />
    </section>
  );
}
