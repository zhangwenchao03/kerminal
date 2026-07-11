// @author kongweiguang

import type { RemoteTargetRef } from "../../lib/targetModel";
import {
  createTerminalArtifactEventAdapter,
  createTerminalArtifactIndex,
  type TerminalArtifactIndexSnapshot,
  type TerminalArtifactRange,
  type TerminalArtifactTargetIdentity,
} from "./artifacts/public";
import {
  publishXtermPaneArtifactSnapshot,
  removeXtermPaneArtifactSnapshot,
} from "./XtermPane.artifactsRegistry";

const MAX_OUTPUT_EVENT_CHARS = 64 * 1024;
const MAX_PENDING_OUTPUT_CHARS = 256 * 1024;

type ArtifactTask =
  | { data: string; range?: TerminalArtifactRange; type: "output" }
  | {
      command: string;
      id: string;
      range?: TerminalArtifactRange;
      type: "command-block";
    }
  | {
      label?: string;
      range?: TerminalArtifactRange;
      type: "link";
      uri: string;
    };

export interface XtermPaneArtifactRuntime {
  close(): void;
  evictBeforeRevision(minimumRevision: number): void;
  getSnapshot(): TerminalArtifactIndexSnapshot;
  invalidate(reason: "clear" | "restart"): void;
  queueCommandBlock(
    id: string,
    command: string,
    range?: TerminalArtifactRange,
  ): void;
  queueLink(uri: string, label?: string, range?: TerminalArtifactRange): void;
  queueOutput(data: string, range?: TerminalArtifactRange): void;
}

interface XtermPaneArtifactRuntimeOptions {
  paneId: string;
  profileId?: string;
  remoteHostId?: string;
  schedule?: (work: () => void) => void;
  target?: RemoteTargetRef;
}

/**
 * 创建每 pane 易失产物运行时。
 * output 仅作为待处理事件短暂排队，处理后立即释放，不读取 history 快照或持有第二正文缓冲。
 */
export function createXtermPaneArtifactRuntime(
  options: XtermPaneArtifactRuntimeOptions,
): XtermPaneArtifactRuntime {
  const target = resolveArtifactTarget(options);
  const index = createTerminalArtifactIndex({
    paneId: options.paneId,
    target,
  });
  const adapter = createTerminalArtifactEventAdapter(target, index);
  const schedule = options.schedule ?? scheduleArtifactWork;
  let disposed = false;
  let revision = 0;
  let scheduled = false;
  let pendingOutputChars = 0;
  let tasks: ArtifactTask[] = [];

  const publish = () => publishXtermPaneArtifactSnapshot(index.getSnapshot());
  const flush = () => {
    scheduled = false;
    if (disposed) {
      tasks = [];
      pendingOutputChars = 0;
      return;
    }
    const current = tasks;
    tasks = [];
    pendingOutputChars = 0;
    for (const task of current) {
      adapter.handle(task);
    }
    publish();
  };
  const enqueue = (task: ArtifactTask) => {
    if (disposed) {
      return;
    }
    tasks.push(task);
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  };

  publish();
  return {
    close() {
      if (disposed) {
        return;
      }
      disposed = true;
      tasks = [];
      pendingOutputChars = 0;
      adapter.handle({ type: "close" });
      removeXtermPaneArtifactSnapshot(options.paneId);
    },
    evictBeforeRevision(minimumRevision) {
      if (disposed) {
        return;
      }
      adapter.handle({ minimumRevision, type: "evict-before-revision" });
      publish();
    },
    getSnapshot: () => index.getSnapshot(),
    invalidate(reason) {
      if (disposed) {
        return;
      }
      tasks = [];
      pendingOutputChars = 0;
      revision += 1;
      adapter.handle({ reason, revision, type: "invalidate" });
      publish();
    },
    queueCommandBlock(id, command, range) {
      enqueue({ command, id, range, type: "command-block" });
    },
    queueLink(uri, label, range) {
      enqueue({ label, range, type: "link", uri });
    },
    queueOutput(data, range) {
      if (!data || pendingOutputChars >= MAX_PENDING_OUTPUT_CHARS) {
        return;
      }
      const remaining = MAX_PENDING_OUTPUT_CHARS - pendingOutputChars;
      const bounded = data.slice(
        0,
        Math.min(MAX_OUTPUT_EVENT_CHARS, remaining),
      );
      if (!bounded) {
        return;
      }
      pendingOutputChars += bounded.length;
      enqueue({ data: bounded, range, type: "output" });
    },
  };
}

function scheduleArtifactWork(work: () => void): void {
  if (
    typeof window !== "undefined" &&
    typeof window.setTimeout === "function"
  ) {
    window.setTimeout(work, 0);
    return;
  }
  queueMicrotask(work);
}

function resolveArtifactTarget({
  paneId,
  profileId,
  remoteHostId,
  target,
}: XtermPaneArtifactRuntimeOptions): TerminalArtifactTargetIdentity {
  if (target?.kind === "dockerContainer") {
    return { host: target.hostId, id: target.containerId, kind: "container" };
  }
  if (target?.kind === "telnet" || target?.kind === "serial") {
    return { host: target.hostId, id: target.hostId, kind: target.kind };
  }
  if (target?.kind === "ssh" || remoteHostId) {
    const hostId = target?.kind === "ssh" ? target.hostId : remoteHostId;
    return { host: hostId, id: hostId ?? paneId, kind: "ssh" };
  }
  return {
    id: profileId ? `local:${profileId}` : `local:${paneId}`,
    kind: "local",
  };
}
