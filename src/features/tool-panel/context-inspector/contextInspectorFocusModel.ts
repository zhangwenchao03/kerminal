/** Inspector 内可聚焦元素的业务类型。 */
export type ContextInspectorFocusKind = "action" | "navigation";

export interface ContextInspectorFocusTarget {
  readonly id: string;
  readonly kind: ContextInspectorFocusKind;
  readonly disabled?: boolean;
}

/**
 * 选择首次打开时的聚焦目标：优先可用 top action，其次选择可跳转字段。
 * 返回 null 时组件保持容器可读，不强行抢占终端焦点。
 */
export function resolveContextInspectorInitialFocus(
  targets: readonly ContextInspectorFocusTarget[],
): string | null {
  return (
    targets.find((target) => target.kind === "action" && !target.disabled)?.id ??
    targets.find((target) => target.kind === "navigation" && !target.disabled)?.id ??
    null
  );
}

/** Home/End 在当前 Inspector 的交互元素间提供可预测的边界跳转。 */
export function resolveContextInspectorBoundaryFocus(
  key: string,
  targets: readonly ContextInspectorFocusTarget[],
): string | null {
  const enabled = targets.filter((target) => !target.disabled);
  if (key === "Home") {
    return enabled[0]?.id ?? null;
  }
  if (key === "End") {
    return enabled[enabled.length - 1]?.id ?? null;
  }
  return null;
}
