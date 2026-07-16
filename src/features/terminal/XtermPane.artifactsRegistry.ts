// @author kongweiguang

import type { TerminalArtifactIndexSnapshot } from "./artifacts/public";

export type XtermPaneArtifactSnapshotListener = (
  snapshot: TerminalArtifactIndexSnapshot | undefined,
) => void;

const snapshots = new Map<string, TerminalArtifactIndexSnapshot>();
const listeners = new Map<string, Set<XtermPaneArtifactSnapshotListener>>();

/** 返回指定 pane 当前的易失产物快照；pane 关闭后返回 undefined。 */
export function getXtermPaneArtifactSnapshot(
  paneId: string,
): TerminalArtifactIndexSnapshot | undefined {
  return snapshots.get(paneId);
}

/** 订阅指定 pane 的产物变化，供 Context Inspector 或菜单按需消费。 */
export function subscribeXtermPaneArtifactSnapshot(
  paneId: string,
  listener: XtermPaneArtifactSnapshotListener,
): () => void {
  const paneListeners = listeners.get(paneId) ?? new Set();
  paneListeners.add(listener);
  listeners.set(paneId, paneListeners);
  listener(snapshots.get(paneId));
  return () => {
    paneListeners.delete(listener);
    if (paneListeners.size === 0) {
      listeners.delete(paneId);
    }
  };
}

export function publishXtermPaneArtifactSnapshot(
  snapshot: TerminalArtifactIndexSnapshot,
): void {
  snapshots.set(snapshot.paneId, snapshot);
  notify(snapshot.paneId, snapshot);
}

export function removeXtermPaneArtifactSnapshot(paneId: string): void {
  snapshots.delete(paneId);
  notify(paneId, undefined);
}

function notify(
  paneId: string,
  snapshot: TerminalArtifactIndexSnapshot | undefined,
): void {
  for (const listener of listeners.get(paneId) ?? []) {
    listener(snapshot);
  }
}
