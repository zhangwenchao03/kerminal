import type { ReactNode } from "react";

import type { WorkspaceContextProjection } from "../workspace/context";

export type QuickOpenKind =
  | "host"
  | "terminal-tab"
  | "terminal-pane"
  | "workspace-file"
  | "recent-file"
  | "command-history"
  | "snippet"
  | "workflow"
  | "agent-session";

/** Quick Open 只回传对象引用，实际导航或执行由集成层解析。 */
export interface QuickOpenReference<TKind extends QuickOpenKind = QuickOpenKind> {
  readonly kind: TKind;
  readonly id: string;
  readonly targetId?: string;
}

/** Provider 返回的结构化对象，不携带危险动作回调。 */
export interface QuickOpenCandidate {
  readonly reference: QuickOpenReference;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly targetId?: string;
  readonly targetLabel?: string;
  readonly updatedAt?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
}

export interface QuickOpenQuery {
  readonly text: string;
  readonly limit: number;
  readonly context?: WorkspaceContextProjection;
  readonly signal: AbortSignal;
}

export interface QuickOpenProvider {
  readonly id: string;
  readonly kinds: readonly QuickOpenKind[];
  readonly search: (
    query: QuickOpenQuery,
  ) => Promise<readonly QuickOpenCandidate[]>;
}

export interface QuickOpenProviderFailure {
  readonly providerId: string;
  readonly reason: "failed" | "timeout";
}

export interface QuickOpenResult extends QuickOpenCandidate {
  readonly providerId: string;
  readonly score: number;
}

type QuickOpenSearchStatus =
  | "idle"
  | "loading"
  | "partial"
  | "ready"
  | "error";

export interface QuickOpenSearchState {
  readonly requestId: number;
  readonly query: string;
  readonly status: QuickOpenSearchStatus;
  readonly results: readonly QuickOpenResult[];
  readonly failures: readonly QuickOpenProviderFailure[];
}

