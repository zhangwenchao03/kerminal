// @author kongweiguang

import {
  detectTerminalProtocolArtifacts,
  detectTerminalTextArtifacts,
} from "./detector";
import type {
  TerminalArtifactCandidate,
  TerminalArtifactRange,
  TerminalArtifactTargetIdentity,
} from "./types";

/** Xterm 侧只需投递这些结构化事件；adapter 不持有 terminal 或输出正文。 */
export type TerminalArtifactEvent =
  | { data: string; range?: TerminalArtifactRange; type: "output" }
  | { label?: string; range?: TerminalArtifactRange; type: "link"; uri: string }
  | { command: string; id: string; range?: TerminalArtifactRange; type: "command-block" }
  | { reason: "clear" | "restart"; revision: number; type: "invalidate" }
  | { minimumRevision: number; type: "evict-before-revision" }
  | { type: "close" };

export interface TerminalArtifactEventSink {
  accept(candidates: readonly TerminalArtifactCandidate[]): void;
  dispose(): void;
  evictBeforeRevision(minimumRevision: number): void;
  invalidate(revision: number): void;
}

export interface TerminalArtifactEventAdapter {
  dispose(): void;
  handle(event: TerminalArtifactEvent): void;
  readonly target: TerminalArtifactTargetIdentity;
}

export function createTerminalArtifactEventAdapter(
  target: TerminalArtifactTargetIdentity,
  sink: TerminalArtifactEventSink,
): TerminalArtifactEventAdapter {
  let disposed = false;
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        sink.dispose();
      }
    },
    handle(event) {
      if (disposed) {
        return;
      }
      switch (event.type) {
        case "output":
          sink.accept([
            ...detectTerminalProtocolArtifacts(event.data),
            ...detectTerminalTextArtifacts(event.data, event.range),
          ]);
          return;
        case "link":
          sink.accept([
            {
              kind: "link",
              label: event.label,
              pathStyle: "uri",
              range: event.range,
              source: "link-provider",
              value: event.uri,
            },
          ]);
          return;
        case "command-block":
          sink.accept([
            {
              kind: "command",
              label: event.command,
              range: event.range,
              source: "command-block",
              value: event.command,
            },
          ]);
          return;
        case "invalidate":
          sink.invalidate(event.revision);
          return;
        case "evict-before-revision":
          sink.evictBeforeRevision(event.minimumRevision);
          return;
        case "close":
          this.dispose();
      }
    },
    target,
  };
}
