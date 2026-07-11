import type {
  WorkspaceActionCatalog,
  WorkspaceActionDescriptor,
} from "./types";

/** 重复 action id 属于启动期配置错误，必须立即失败而不是静默覆盖。 */
export class DuplicateWorkspaceActionError extends Error {
  constructor(actionId: string) {
    super(`Workspace action 已注册：${actionId}`);
    this.name = "DuplicateWorkspaceActionError";
  }
}

/** 未注册动作错误由 invoker 统一转换为用户可见 failure。 */
export class WorkspaceActionNotFoundError extends Error {
  constructor(actionId: string) {
    super(`Workspace action 不存在：${actionId}`);
    this.name = "WorkspaceActionNotFoundError";
  }
}

/**
 * Workspace Action 描述注册表。
 *
 * 注册表只保存静态描述和 policy，不持有 workspace 状态，也不执行副作用。
 */
export class WorkspaceActionRegistry<
  TCatalog extends WorkspaceActionCatalog = WorkspaceActionCatalog,
> {
  private readonly descriptors = new Map<
    keyof TCatalog & string,
    WorkspaceActionDescriptor<string, unknown>
  >();

  register<TId extends keyof TCatalog & string>(
    descriptor: WorkspaceActionDescriptor<TId, TCatalog[TId]>,
  ): this {
    if (this.descriptors.has(descriptor.id)) {
      throw new DuplicateWorkspaceActionError(descriptor.id);
    }
    this.descriptors.set(
      descriptor.id,
      descriptor as WorkspaceActionDescriptor<string, unknown>,
    );
    return this;
  }

  get<TId extends keyof TCatalog & string>(
    actionId: TId,
  ): WorkspaceActionDescriptor<TId, TCatalog[TId]> {
    const descriptor = this.descriptors.get(actionId);
    if (!descriptor) {
      throw new WorkspaceActionNotFoundError(actionId);
    }
    return descriptor as WorkspaceActionDescriptor<TId, TCatalog[TId]>;
  }

  list(): readonly WorkspaceActionDescriptor<
    keyof TCatalog & string,
    TCatalog[keyof TCatalog]
  >[] {
    return [...this.descriptors.values()] as WorkspaceActionDescriptor<
      keyof TCatalog & string,
      TCatalog[keyof TCatalog]
    >[];
  }
}

