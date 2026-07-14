import { useEffect, useMemo, useRef, useState } from "react";
import {
  WorkspaceActionInvoker,
  type WorkspaceActionCatalog,
  type WorkspaceActionInvocationResult,
} from "../workspace-actions";
import {
  WorkspacePaletteShell,
  type WorkspacePaletteItem,
} from "../workspace-overlay";
import {
  buildCommandPaletteItems,
  formatCommandPaletteEffect,
} from "./commandPaletteModel";
import type {
  CommandPaletteExecutionFeedback,
  CommandPaletteProps,
} from "./commandPaletteTypes";

/** 将 invoker 的完整结果联合转换成固定、可访问的执行反馈。 */
export function resolveCommandPaletteFeedback(
  actionId: string,
  result: WorkspaceActionInvocationResult,
): CommandPaletteExecutionFeedback {
  switch (result.kind) {
    case "completed":
      return { actionId, kind: "success", message: "动作已完成" };
    case "cancelled":
      return { actionId, kind: "info", message: "动作已取消" };
    case "duplicate":
      return { actionId, kind: "info", message: "动作正在执行，请稍候" };
    case "stale-context":
      return { actionId, kind: "error", message: "工作区上下文已变化，请重试" };
    case "unavailable":
      return { actionId, kind: "error", message: result.reason };
    case "failure":
      return { actionId, kind: "error", message: result.error.title };
    case "confirmation-required":
      return { actionId, kind: "info", message: "等待确认" };
    case "open-tool":
      return { actionId, kind: "success", message: "工具已打开" };
  }
}

/** 成功接管用户意图后关闭临时面板；可恢复错误保留结果供用户修正或重试。 */
function shouldCloseCommandPalette(
  result: WorkspaceActionInvocationResult,
): boolean {
  return (
    result.kind === "completed" ||
    result.kind === "cancelled" ||
    result.kind === "confirmation-required" ||
    result.kind === "open-tool"
  );
}

/** 基于 Workspace Action 单一注册表的命令面板。 */
export function CommandPalette<
  TCatalog extends WorkspaceActionCatalog = WorkspaceActionCatalog,
>({
  context,
  executor,
  getPayload,
  getPresentation,
  onClose,
  onConfirmationRequired,
  onOpenTool,
  open,
  registry,
  title = "命令面板",
}: CommandPaletteProps<TCatalog>) {
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<CommandPaletteExecutionFeedback>({
    kind: "idle",
  });
  const abortControllersRef = useRef(new Set<AbortController>());
  const activeInvocationRef = useRef<symbol | null>(null);
  const invoker = useMemo(
    () => new WorkspaceActionInvoker(registry, executor),
    [executor, registry],
  );
  const items = useMemo(
    () =>
      buildCommandPaletteItems(
        registry,
        context,
        query,
        getPayload,
        getPresentation,
      ),
    [context, getPayload, getPresentation, query, registry],
  );

  useEffect(() => {
    if (open) {
      return;
    }
    activeInvocationRef.current = null;
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    setQuery("");
    setFeedback({ kind: "idle" });
  }, [open]);

  useEffect(
    () => () => {
      activeInvocationRef.current = null;
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
    },
    [],
  );

  const shellItems: readonly WorkspacePaletteItem[] = items.map((item) => ({
    description: (
      <span className="flex min-w-0 items-center gap-2">
        <span>{item.category ?? "通用"}</span>
        <span aria-hidden="true">·</span>
        <span>{item.scope ?? "当前工作区"}</span>
        <span aria-hidden="true">·</span>
        <span>{formatCommandPaletteEffect(item.effect)}</span>
        {item.disabledReason ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.disabledReason}</span>
          </>
        ) : null}
      </span>
    ),
    disabled: item.disabled,
    id: item.id,
    label: item.title,
    leading: item.leading,
    trailing: item.keybinding,
  }));

  const handleSelect = async (selected: WorkspacePaletteItem) => {
    const descriptor = registry.get(selected.id as keyof TCatalog & string);
    const controller = new AbortController();
    const invocationToken = Symbol(descriptor.id);
    activeInvocationRef.current = invocationToken;
    abortControllersRef.current.add(controller);
    setFeedback({ actionId: descriptor.id, kind: "running" });

    const result = await invoker.invoke({
      actionId: descriptor.id,
      context,
      expectedContextRevision: context.revision,
      invocationKey: descriptor.id,
      payload: getPayload(descriptor),
      signal: controller.signal,
    });
    abortControllersRef.current.delete(controller);

    if (activeInvocationRef.current !== invocationToken) {
      return;
    }

    // 危险动作仅向既有确认流程转发，Palette 永不自行执行。
    if (result.kind === "confirmation-required") {
      onConfirmationRequired(result.confirmation);
    } else if (result.kind === "open-tool") {
      onOpenTool(result.toolId, result.payload);
    }
    setFeedback(resolveCommandPaletteFeedback(descriptor.id, result));
    if (shouldCloseCommandPalette(result)) {
      onClose();
    }
  };

  const handleClose = () => {
    activeInvocationRef.current = null;
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    onClose();
  };

  const statusMessage =
    feedback.kind === "idle"
      ? undefined
      : feedback.kind === "running"
        ? "正在执行动作"
        : feedback.message;

  return (
    <WorkspacePaletteShell
      description="搜索并执行当前工作区可用动作"
      emptyMessage="没有匹配的动作"
      footer={statusMessage ?? "Enter 执行"}
      items={shellItems}
      loadingMessage="正在执行动作"
      onClose={handleClose}
      onQueryChange={setQuery}
      onSelect={(item) => {
        void handleSelect(item);
      }}
      open={open}
      placeholder="搜索动作"
      query={query}
      status={feedback.kind === "running" ? "partial" : "ready"}
      statusMessage={statusMessage}
      title={title}
    />
  );
}
