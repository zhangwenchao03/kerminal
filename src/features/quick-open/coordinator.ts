import { rankQuickOpenResults } from "./scoring";
import type {
  QuickOpenProvider,
  QuickOpenProviderFailure,
  QuickOpenResult,
  QuickOpenSearchState,
} from "./types";

export interface QuickOpenCoordinatorOptions {
  readonly getProviders: () => readonly QuickOpenProvider[];
  readonly limit?: number;
  readonly providerTimeoutMs?: number;
}

export interface QuickOpenSearchOptions {
  readonly context?: import("../workspace/context").WorkspaceContextProjection;
  readonly signal?: AbortSignal;
  readonly onUpdate?: (state: QuickOpenSearchState) => void;
}

function mergeResults(
  resultGroups: ReadonlyMap<string, readonly QuickOpenResult[]>,
  limit: number,
): readonly QuickOpenResult[] {
  const unique = new Map<string, QuickOpenResult>();
  for (const results of resultGroups.values()) {
    for (const result of results) {
      const key = `${result.reference.kind}:${result.reference.id}:${result.reference.targetId ?? ""}`;
      const current = unique.get(key);
      if (!current || result.score > current.score) {
        unique.set(key, result);
      }
    }
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, limit);
}

/**
 * 管理惰性并发查询。新查询会取消旧查询，且 requestId 门禁会丢弃迟到结果。
 */
export class QuickOpenCoordinator {
  readonly #getProviders: () => readonly QuickOpenProvider[];
  readonly #limit: number;
  readonly #providerTimeoutMs: number;
  #activeController?: AbortController;
  #requestId = 0;

  constructor(options: QuickOpenCoordinatorOptions) {
    this.#getProviders = options.getProviders;
    this.#limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
    this.#providerTimeoutMs = Math.max(options.providerTimeoutMs ?? 1_500, 1);
  }

  cancel(): void {
    this.#activeController?.abort();
    this.#activeController = undefined;
  }

  async search(
    query: string,
    options: QuickOpenSearchOptions = {},
  ): Promise<QuickOpenSearchState> {
    this.cancel();
    const requestId = ++this.#requestId;
    const controller = new AbortController();
    this.#activeController = controller;
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true });

    const providers = this.#getProviders();
    const groups = new Map<string, readonly QuickOpenResult[]>();
    const failures: QuickOpenProviderFailure[] = [];
    const state = (status: QuickOpenSearchState["status"]): QuickOpenSearchState => ({
      requestId,
      query,
      status,
      results: mergeResults(groups, this.#limit),
      failures: [...failures],
    });
    options.onUpdate?.(state("loading"));

    const activeTargetId = options.context?.target?.id;
    const runProvider = async (provider: QuickOpenProvider) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const providerController = new AbortController();
      const abortProvider = () => providerController.abort();
      controller.signal.addEventListener("abort", abortProvider, { once: true });
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            providerController.abort();
            reject(new Error("provider-timeout"));
          }, this.#providerTimeoutMs);
        });
        const candidates = await Promise.race([
          provider.search({
            text: query,
            limit: this.#limit,
            context: options.context,
            signal: providerController.signal,
          }),
          timeout,
        ]);
        if (controller.signal.aborted || requestId !== this.#requestId) {
          return;
        }
        groups.set(
          provider.id,
          rankQuickOpenResults(provider.id, candidates, query, activeTargetId),
        );
        options.onUpdate?.(state("partial"));
      } catch (error) {
        if (controller.signal.aborted || requestId !== this.#requestId) {
          return;
        }
        failures.push({
          providerId: provider.id,
          reason:
            error instanceof Error && error.message === "provider-timeout"
              ? "timeout"
              : "failed",
        });
        options.onUpdate?.(state("partial"));
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        controller.signal.removeEventListener("abort", abortProvider);
      }
    };

    await Promise.all(providers.map(runProvider));
    options.signal?.removeEventListener("abort", forwardAbort);
    if (controller.signal.aborted || requestId !== this.#requestId) {
      return state("idle");
    }
    this.#activeController = undefined;
    const finalStatus =
      failures.length === providers.length && providers.length > 0
        ? "error"
        : "ready";
    const finalState = state(finalStatus);
    options.onUpdate?.(finalState);
    return finalState;
  }
}
