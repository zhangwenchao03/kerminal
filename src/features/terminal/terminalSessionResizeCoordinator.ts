export interface TerminalSessionDimensions {
  cols: number;
  rows: number;
}

export interface TerminalSessionResizeScheduler {
  cancel(handle: number): void;
  schedule(callback: () => void, delayMs: number): number;
}

export interface TerminalSessionResizeCoordinator {
  bindSession(
    sessionId: string,
    acknowledgedDimensions: TerminalSessionDimensions,
  ): void;
  clearSession(sessionId?: string): void;
  dispose(): void;
  request(dimensions: TerminalSessionDimensions): void;
}

interface CreateTerminalSessionResizeCoordinatorOptions {
  maxRetryDelayMs?: number;
  resize(
    sessionId: string,
    dimensions: TerminalSessionDimensions,
  ): Promise<unknown>;
  retryBaseDelayMs?: number;
  scheduler?: TerminalSessionResizeScheduler;
}

const DEFAULT_RESIZE_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RESIZE_RETRY_MAX_DELAY_MS = 2_000;

/**
 * 串行提交 PTY resize，并只保留最新尺寸。
 *
 * 尺寸只有在 IPC 成功后才进入 acknowledged；失败使用有上限的指数退避，
 * session 换代会使旧 Promise 失效，不能覆盖新会话状态。
 */
export function createTerminalSessionResizeCoordinator({
  maxRetryDelayMs = DEFAULT_RESIZE_RETRY_MAX_DELAY_MS,
  resize,
  retryBaseDelayMs = DEFAULT_RESIZE_RETRY_BASE_DELAY_MS,
  scheduler = browserResizeScheduler,
}: CreateTerminalSessionResizeCoordinatorOptions): TerminalSessionResizeCoordinator {
  const resolvedBaseDelayMs = positiveDelay(
    retryBaseDelayMs,
    DEFAULT_RESIZE_RETRY_BASE_DELAY_MS,
  );
  const resolvedMaxDelayMs = Math.max(
    resolvedBaseDelayMs,
    positiveDelay(maxRetryDelayMs, DEFAULT_RESIZE_RETRY_MAX_DELAY_MS),
  );
  let acknowledged:
    | (TerminalSessionDimensions & { sessionId: string })
    | undefined;
  let activeOperationToken: number | null = null;
  let disposed = false;
  let generation = 0;
  let operationCounter = 0;
  let pending:
    | (TerminalSessionDimensions & { sessionId: string })
    | undefined;
  let retryAttempt = 0;
  let retryTimer: number | null = null;
  let sessionId: string | null = null;

  const cancelRetry = () => {
    if (retryTimer === null) {
      return;
    }
    scheduler.cancel(retryTimer);
    retryTimer = null;
  };

  const sameDimensions = (
    left: TerminalSessionDimensions | undefined,
    right: TerminalSessionDimensions,
  ) => left?.cols === right.cols && left.rows === right.rows;

  const scheduleRetry = () => {
    if (disposed || retryTimer !== null || !pending) {
      return;
    }
    const delayMs = Math.min(
      resolvedMaxDelayMs,
      resolvedBaseDelayMs * 2 ** Math.min(retryAttempt, 8),
    );
    retryAttempt += 1;
    retryTimer = scheduler.schedule(() => {
      retryTimer = null;
      pump();
    }, delayMs);
  };

  const pump = () => {
    if (
      disposed ||
      activeOperationToken !== null ||
      retryTimer !== null ||
      !pending
    ) {
      return;
    }
    const request = pending;
    if (
      request.sessionId !== sessionId ||
      (acknowledged?.sessionId === request.sessionId &&
        sameDimensions(acknowledged, request))
    ) {
      pending = undefined;
      return;
    }
    pending = undefined;
    const operationGeneration = generation;
    const operationToken = ++operationCounter;
    activeOperationToken = operationToken;
    void resize(request.sessionId, {
      cols: request.cols,
      rows: request.rows,
    })
      .then(() => {
        if (
          disposed ||
          generation !== operationGeneration ||
          activeOperationToken !== operationToken ||
          sessionId !== request.sessionId
        ) {
          return;
        }
        acknowledged = request;
        retryAttempt = 0;
      })
      .catch(() => {
        if (
          disposed ||
          generation !== operationGeneration ||
          activeOperationToken !== operationToken ||
          sessionId !== request.sessionId
        ) {
          return;
        }
        pending ??= request;
        scheduleRetry();
      })
      .finally(() => {
        if (activeOperationToken !== operationToken) {
          return;
        }
        activeOperationToken = null;
        if (retryTimer === null) {
          pump();
        }
      });
  };

  const resetSessionState = () => {
    generation += 1;
    activeOperationToken = null;
    acknowledged = undefined;
    pending = undefined;
    retryAttempt = 0;
    cancelRetry();
  };

  return {
    bindSession(nextSessionId, acknowledgedDimensions) {
      if (disposed) {
        return;
      }
      resetSessionState();
      sessionId = nextSessionId;
      acknowledged = {
        ...acknowledgedDimensions,
        sessionId: nextSessionId,
      };
    },
    clearSession(expectedSessionId) {
      if (
        expectedSessionId !== undefined &&
        sessionId !== expectedSessionId
      ) {
        return;
      }
      resetSessionState();
      sessionId = null;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resetSessionState();
      sessionId = null;
    },
    request(dimensions) {
      if (disposed || !sessionId) {
        return;
      }
      if (
        acknowledged?.sessionId === sessionId &&
        sameDimensions(acknowledged, dimensions) &&
        pending === undefined
      ) {
        return;
      }
      pending = { ...dimensions, sessionId };
      if (retryTimer !== null) {
        cancelRetry();
      }
      pump();
    },
  };
}

function positiveDelay(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const browserResizeScheduler: TerminalSessionResizeScheduler = {
  cancel(handle) {
    window.clearTimeout(handle);
  },
  schedule(callback, delayMs) {
    return window.setTimeout(callback, delayMs);
  },
};
