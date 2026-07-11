import type { TerminalRendererFallbackReason } from "./terminalRendererPolicy";

/**
 * Renderer 生命周期的全部稳定状态。
 *
 * GPU 只是一层可替换的加速能力；状态机不拥有 terminal、buffer 或 PTY，
 * 因此 GPU 失败只能回退到 CPU，不能隐式销毁终端会话。
 */
export type TerminalRendererLifecycleState =
  | "cpu-ready"
  | "gpu-attaching"
  | "gpu-ready"
  | "suspended"
  | "recovering"
  | "cpu-cooldown"
  | "disposing"
  | "disposed";

/**
 * 生命周期迁移原因。原因只描述 renderer 控制事件，不得携带终端正文等敏感数据。
 */
export type TerminalRendererTransitionReason =
  | "request-gpu"
  | "manual-retry"
  | "gpu-attached"
  | "gpu-attach-failed"
  | "gpu-fault"
  | "recovery-succeeded"
  | "recovery-failed"
  | "suspend"
  | "resume"
  | "hidden-reaped"
  | "cooldown-expired"
  | "mode-cpu"
  | "operation-cancelled"
  | "dispose-requested"
  | "dispose-completed";

export type TerminalRendererTransitionRejection =
  "illegal-transition" | "generation-token-required" | "stale-generation";

const OPERATION_STATES = new Set<TerminalRendererLifecycleState>([
  "gpu-attaching",
  "recovering",
]);

const GENERATION_COMMIT_STATES = new Set<TerminalRendererLifecycleState>([
  "gpu-ready",
  "cpu-cooldown",
]);

export const TERMINAL_RENDERER_LIFECYCLE_STATES = Object.freeze<
  TerminalRendererLifecycleState[]
>([
  "cpu-ready",
  "gpu-attaching",
  "gpu-ready",
  "suspended",
  "recovering",
  "cpu-cooldown",
  "disposing",
  "disposed",
]);

const lifecycleTargets = (
  ...states: TerminalRendererLifecycleState[]
): readonly TerminalRendererLifecycleState[] => Object.freeze(states);

/**
 * Renderer 生命周期唯一合法迁移表。
 *
 * 表中额外保留 operation -> cpu-ready，用于模式切换、隐藏回收等外部取消；
 * 这类取消会使当前 generation 失效，迟到的异步结果不能再次安装 GPU。
 */
export const TERMINAL_RENDERER_LIFECYCLE_TRANSITIONS: Readonly<
  Record<
    TerminalRendererLifecycleState,
    readonly TerminalRendererLifecycleState[]
  >
> = Object.freeze({
  "cpu-ready": lifecycleTargets("gpu-attaching", "disposing"),
  "gpu-attaching": lifecycleTargets(
    "gpu-ready",
    "cpu-ready",
    "cpu-cooldown",
    "disposing",
  ),
  "gpu-ready": lifecycleTargets(
    "suspended",
    "recovering",
    "cpu-ready",
    "disposing",
  ),
  suspended: lifecycleTargets("gpu-ready", "cpu-ready", "disposing"),
  recovering: lifecycleTargets(
    "gpu-ready",
    "cpu-ready",
    "cpu-cooldown",
    "disposing",
  ),
  "cpu-cooldown": lifecycleTargets("gpu-attaching", "cpu-ready", "disposing"),
  disposing: lifecycleTargets("disposed"),
  disposed: lifecycleTargets(),
});

declare const generationTokenBrand: unique symbol;

/**
 * 异步 attach/recover 操作的代际令牌。
 *
 * 调用方只能从成功进入 operation 状态的迁移结果中获得令牌，并在异步结果
 * commit 时原样传回；状态机使用对象身份和 generation 双重校验迟到结果。
 */
export interface TerminalRendererGenerationToken {
  readonly generation: number;
  readonly operation: "gpu-attaching" | "recovering";
  readonly paneId: string;
  readonly [generationTokenBrand]: true;
}

export interface TerminalRendererLifecycleSnapshot {
  readonly generation: number;
  readonly paneId: string;
  readonly rejectedTransitionCount: number;
  readonly state: TerminalRendererLifecycleState;
  readonly transitionCount: number;
}

/**
 * 单条迁移账本记录。拒绝的迁移也会入账，便于定位非法调用和 stale commit。
 */
export interface TerminalRendererTransitionLedgerEntry {
  readonly attempt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly fallbackReason?: TerminalRendererFallbackReason;
  readonly from: TerminalRendererLifecycleState;
  readonly generation: number;
  readonly outcome: "committed" | "rejected";
  readonly paneId: string;
  readonly reason: TerminalRendererTransitionReason;
  readonly rejection?: TerminalRendererTransitionRejection;
  readonly requestedGeneration?: number;
  readonly sequence: number;
  readonly startedAt: number;
  readonly to: TerminalRendererLifecycleState;
}

export interface TerminalRendererTransitionRequest {
  readonly attempt?: number;
  readonly durationMs?: number;
  readonly fallbackReason?: TerminalRendererFallbackReason;
  readonly reason: TerminalRendererTransitionReason;
  readonly startedAt?: number;
  readonly to: TerminalRendererLifecycleState;
  readonly token?: TerminalRendererGenerationToken;
}

export interface TerminalRendererAcceptedTransition {
  readonly accepted: true;
  readonly generationToken?: TerminalRendererGenerationToken;
  readonly snapshot: TerminalRendererLifecycleSnapshot;
  readonly transition: TerminalRendererTransitionLedgerEntry;
}

export interface TerminalRendererRejectedTransition {
  readonly accepted: false;
  readonly rejection: TerminalRendererTransitionRejection;
  readonly snapshot: TerminalRendererLifecycleSnapshot;
  readonly transition: TerminalRendererTransitionLedgerEntry;
}

export type TerminalRendererTransitionResult =
  TerminalRendererAcceptedTransition | TerminalRendererRejectedTransition;

export interface TerminalRendererDisposeResult {
  readonly snapshot: TerminalRendererLifecycleSnapshot;
  readonly transitions: readonly TerminalRendererTransitionLedgerEntry[];
}

/**
 * 纯 renderer 生命周期状态机。
 *
 * 该接口只负责状态、generation 和账本，不执行 import、定时器、addon dispose
 * 等副作用；后续 controller 必须先通过状态机取得提交许可，再操作实际资源。
 */
export interface TerminalRendererLifecycle {
  canCommitGeneration(token: TerminalRendererGenerationToken): boolean;
  dispose(): TerminalRendererDisposeResult;
  getLedger(): readonly TerminalRendererTransitionLedgerEntry[];
  getSnapshot(): TerminalRendererLifecycleSnapshot;
  transition(
    request: TerminalRendererTransitionRequest,
  ): TerminalRendererTransitionResult;
}

export interface CreateTerminalRendererLifecycleOptions {
  readonly ledgerLimit?: number;
  readonly now?: () => number;
  readonly paneId: string;
}

const DEFAULT_LEDGER_LIMIT = 128;

/**
 * 创建一个初始处于 cpu-ready 的 renderer 生命周期状态机。
 */
export function createTerminalRendererLifecycle({
  ledgerLimit = DEFAULT_LEDGER_LIMIT,
  now = () => Date.now(),
  paneId,
}: CreateTerminalRendererLifecycleOptions): TerminalRendererLifecycle {
  if (!Number.isInteger(ledgerLimit) || ledgerLimit <= 0) {
    throw new RangeError("ledgerLimit must be a positive integer");
  }

  let state: TerminalRendererLifecycleState = "cpu-ready";
  let generation = 0;
  let sequence = 0;
  let transitionCount = 0;
  let rejectedTransitionCount = 0;
  let activeGenerationToken: TerminalRendererGenerationToken | null = null;
  let disposeResult: TerminalRendererDisposeResult | null = null;
  const ledger: TerminalRendererTransitionLedgerEntry[] = [];

  const snapshot = (): TerminalRendererLifecycleSnapshot =>
    Object.freeze({
      generation,
      paneId,
      rejectedTransitionCount,
      state,
      transitionCount,
    });

  const appendLedger = (
    entry: TerminalRendererTransitionLedgerEntry,
  ): TerminalRendererTransitionLedgerEntry => {
    ledger.push(entry);
    if (ledger.length > ledgerLimit) {
      ledger.splice(0, ledger.length - ledgerLimit);
    }
    return entry;
  };

  const createLedgerEntry = ({
    attempt = 0,
    durationMs = 0,
    fallbackReason,
    from,
    outcome,
    reason,
    rejection,
    requestedGeneration,
    startedAt,
    to,
  }: {
    attempt?: number;
    durationMs?: number;
    fallbackReason?: TerminalRendererFallbackReason;
    from: TerminalRendererLifecycleState;
    outcome: "committed" | "rejected";
    reason: TerminalRendererTransitionReason;
    rejection?: TerminalRendererTransitionRejection;
    requestedGeneration?: number;
    startedAt?: number;
    to: TerminalRendererLifecycleState;
  }): TerminalRendererTransitionLedgerEntry => {
    const completedAt = now();
    return Object.freeze({
      attempt,
      completedAt,
      durationMs,
      fallbackReason,
      from,
      generation,
      outcome,
      paneId,
      reason,
      rejection,
      requestedGeneration,
      sequence: ++sequence,
      startedAt: startedAt ?? completedAt - durationMs,
      to,
    });
  };

  const rejectTransition = (
    request: TerminalRendererTransitionRequest,
    rejection: TerminalRendererTransitionRejection,
  ): TerminalRendererRejectedTransition => {
    rejectedTransitionCount += 1;
    const transition = appendLedger(
      createLedgerEntry({
        ...request,
        from: state,
        outcome: "rejected",
        rejection,
        requestedGeneration: request.token?.generation,
      }),
    );
    return Object.freeze({
      accepted: false,
      rejection,
      snapshot: snapshot(),
      transition,
    });
  };

  /**
   * 迁移分三步校验：先拒绝 stale token，再检查显式迁移表，最后检查
   * operation commit 是否携带 token。顺序固定可保证迟到结果被准确归类。
   */
  const transition = (
    request: TerminalRendererTransitionRequest,
  ): TerminalRendererTransitionResult => {
    validateTransitionMetadata(request);

    if (
      request.token &&
      (request.token !== activeGenerationToken ||
        request.token.paneId !== paneId ||
        request.token.generation !== generation)
    ) {
      return rejectTransition(request, "stale-generation");
    }

    if (!isTerminalRendererLifecycleTransitionAllowed(state, request.to)) {
      return rejectTransition(request, "illegal-transition");
    }

    if (
      OPERATION_STATES.has(state) &&
      GENERATION_COMMIT_STATES.has(request.to) &&
      !request.token
    ) {
      return rejectTransition(request, "generation-token-required");
    }

    const from = state;
    let generationToken: TerminalRendererGenerationToken | undefined;

    if (OPERATION_STATES.has(request.to)) {
      generation += 1;
      generationToken = createGenerationToken(
        paneId,
        generation,
        request.to as "gpu-attaching" | "recovering",
      );
      activeGenerationToken = generationToken;
    } else if (activeGenerationToken) {
      // 无 token 离开 operation 表示外部取消，必须推进 generation 使旧结果失效。
      if (!request.token) {
        generation += 1;
      }
      activeGenerationToken = null;
    } else if (request.to === "disposing") {
      // 即使当前没有异步任务，dispose 也建立新的终止代际，阻断旧引用提交。
      generation += 1;
    }

    state = request.to;
    transitionCount += 1;
    const transitionEntry = appendLedger(
      createLedgerEntry({
        ...request,
        from,
        outcome: "committed",
        requestedGeneration: request.token?.generation,
      }),
    );

    return Object.freeze({
      accepted: true,
      generationToken,
      snapshot: snapshot(),
      transition: transitionEntry,
    });
  };

  const canCommitGeneration = (
    token: TerminalRendererGenerationToken,
  ): boolean =>
    token === activeGenerationToken &&
    token.paneId === paneId &&
    token.generation === generation &&
    token.operation === state;

  /**
   * dispose 同步走完 disposing -> disposed，并缓存第一次结果。
   * 后续调用返回同一对象，不增加 generation，也不重复写 transition ledger。
   */
  const dispose = (): TerminalRendererDisposeResult => {
    if (disposeResult) {
      return disposeResult;
    }

    const transitions: TerminalRendererTransitionLedgerEntry[] = [];
    if (state !== "disposing" && state !== "disposed") {
      const disposingResult = transition({
        reason: "dispose-requested",
        to: "disposing",
      });
      if (disposingResult.accepted) {
        transitions.push(disposingResult.transition);
      }
    }
    if (state === "disposing") {
      const disposedResult = transition({
        reason: "dispose-completed",
        to: "disposed",
      });
      if (disposedResult.accepted) {
        transitions.push(disposedResult.transition);
      }
    }

    disposeResult = Object.freeze({
      snapshot: snapshot(),
      transitions: Object.freeze(transitions),
    });
    return disposeResult;
  };

  return Object.freeze({
    canCommitGeneration,
    dispose,
    getLedger: () => Object.freeze([...ledger]),
    getSnapshot: snapshot,
    transition,
  });
}

export function isTerminalRendererLifecycleTransitionAllowed(
  from: TerminalRendererLifecycleState,
  to: TerminalRendererLifecycleState,
): boolean {
  return TERMINAL_RENDERER_LIFECYCLE_TRANSITIONS[from].includes(to);
}

function createGenerationToken(
  paneId: string,
  generation: number,
  operation: "gpu-attaching" | "recovering",
): TerminalRendererGenerationToken {
  return Object.freeze({
    generation,
    operation,
    paneId,
  }) as TerminalRendererGenerationToken;
}

function validateTransitionMetadata(
  request: TerminalRendererTransitionRequest,
): void {
  if (
    request.attempt !== undefined &&
    (!Number.isInteger(request.attempt) || request.attempt < 0)
  ) {
    throw new RangeError("attempt must be a non-negative integer");
  }
  if (
    request.durationMs !== undefined &&
    (!Number.isFinite(request.durationMs) || request.durationMs < 0)
  ) {
    throw new RangeError("durationMs must be a non-negative finite number");
  }
  if (request.startedAt !== undefined && !Number.isFinite(request.startedAt)) {
    throw new RangeError("startedAt must be a finite number");
  }
}
