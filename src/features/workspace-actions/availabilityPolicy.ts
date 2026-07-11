import type {
  WorkspaceActionAvailability,
  WorkspaceActionAvailabilityPolicy,
  WorkspaceActionContext,
} from "./types";

const AVAILABLE: WorkspaceActionAvailability = { available: true };

/** 始终可用的默认策略。 */
export function availableWorkspaceAction(): WorkspaceActionAvailability {
  return AVAILABLE;
}

/** 要求上下文具备全部 capability；缺失时返回可供 UI 展示的稳定原因。 */
export function requireWorkspaceCapabilities<TPayload>(
  ...requiredCapabilities: readonly string[]
): WorkspaceActionAvailabilityPolicy<TPayload> {
  return (context: WorkspaceActionContext) => {
    const missing = requiredCapabilities.filter(
      (capability) => !context.capabilities?.has(capability),
    );
    if (missing.length === 0) {
      return AVAILABLE;
    }
    return {
      available: false,
      code: "missing-capability",
      reason: `缺少所需能力：${missing.join("、")}`,
    };
  };
}

/** 组合多个策略，按顺序返回第一个不可用原因。 */
export function allWorkspaceActionPolicies<TPayload>(
  ...policies: readonly WorkspaceActionAvailabilityPolicy<TPayload>[]
): WorkspaceActionAvailabilityPolicy<TPayload> {
  return (context, payload) => {
    for (const policy of policies) {
      const result = policy(context, payload);
      if (!result.available) {
        return result;
      }
    }
    return AVAILABLE;
  };
}

