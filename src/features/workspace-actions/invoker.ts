import { availableWorkspaceAction } from "./availabilityPolicy";
import { classifyWorkspaceActionError } from "./errorClassification";
import { WorkspaceActionRegistry } from "./registry";
import type {
  WorkspaceActionCatalog,
  WorkspaceActionExecutor,
  WorkspaceActionInvocation,
  WorkspaceActionInvocationResult,
} from "./types";

/** Workspace Action 的安全编排入口。 */
export class WorkspaceActionInvoker<
  TCatalog extends WorkspaceActionCatalog = WorkspaceActionCatalog,
> {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly registry: WorkspaceActionRegistry<TCatalog>,
    private readonly executor: WorkspaceActionExecutor,
  ) {}

  /**
   * 校验 revision、可用性和副作用等级后执行动作。
   *
   * remote/write/destructive 只生成确认请求，确认后的真实执行由主集成层现有
   * controller/facade 承担，避免本模块绕过既有安全边界。
   */
  async invoke<TId extends keyof TCatalog & string>(
    invocation: WorkspaceActionInvocation<TId, TCatalog[TId]>,
  ): Promise<WorkspaceActionInvocationResult> {
    if (invocation.signal?.aborted) {
      return { kind: "cancelled" };
    }
    if (invocation.context.revision !== invocation.expectedContextRevision) {
      return {
        kind: "stale-context",
        actualRevision: invocation.context.revision,
        expectedRevision: invocation.expectedContextRevision,
      };
    }

    let descriptor;
    try {
      descriptor = this.registry.get(invocation.actionId);
    } catch (error) {
      return classifyWorkspaceActionError(error);
    }

    const availability = (descriptor.availability ?? availableWorkspaceAction)(
      invocation.context,
      invocation.payload,
    );
    if (!availability.available) {
      return {
        kind: "unavailable",
        code: availability.code,
        reason: availability.reason,
      };
    }

    if (
      descriptor.effect === "write" ||
      descriptor.effect === "remote" ||
      descriptor.effect === "destructive"
    ) {
      return {
        kind: "confirmation-required",
        confirmation: {
          actionId: descriptor.id,
          effect: descriptor.effect,
          title: descriptor.title,
          detail: descriptor.confirmationDetail?.(
            invocation.context,
            invocation.payload,
          ),
        },
      };
    }

    const invocationKey =
      invocation.invocationKey ?? String(invocation.actionId);
    if (this.inFlight.has(invocationKey)) {
      return { kind: "duplicate", invocationKey };
    }

    this.inFlight.add(invocationKey);
    let execution;
    try {
      execution = this.executor.execute(descriptor, invocation);
    } catch (error) {
      this.inFlight.delete(invocationKey);
      return classifyWorkspaceActionError(error);
    }
    // 调用方取消等待不代表底层副作用已经停止；锁必须等 executor 真正收口后释放。
    void execution.then(
      () => this.inFlight.delete(invocationKey),
      () => this.inFlight.delete(invocationKey),
    );
    try {
      return await this.waitWithCancellation(execution, invocation.signal);
    } catch (error) {
      return invocation.signal?.aborted
        ? { kind: "cancelled" }
        : classifyWorkspaceActionError(error);
    }
  }

  private async waitWithCancellation(
    execution: Promise<WorkspaceActionInvocationResult>,
    signal?: AbortSignal,
  ): Promise<WorkspaceActionInvocationResult> {
    if (!signal) {
      return execution;
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => resolve({ kind: "cancelled" });
      signal.addEventListener("abort", onAbort, { once: true });
      execution.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  }
}
