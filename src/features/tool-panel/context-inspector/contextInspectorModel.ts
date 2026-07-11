import type {
  WorkspaceContextDiagnostic,
  WorkspaceContextProjection,
  WorkspaceContextSourceState,
} from "../../workspace/context";
import type {
  ContextInspectorActionDescriptor,
  ContextInspectorField,
  ContextInspectorSection,
  ContextInspectorViewModel,
} from "./contextInspectorTypes";

const EMPTY_VALUE = "未提供";

function value(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? EMPTY_VALUE
    : String(value);
}

function booleanValue(value: boolean): string {
  return value ? "是" : "否";
}

function sourceStatusLabel(source: WorkspaceContextSourceState): string {
  const labels = {
    available: "可用",
    loading: "加载中",
    stale: "已过期",
    unavailable: "不可用",
    error: "错误",
  } as const;
  return `${source.source} · ${labels[source.status]}`;
}

function diagnosticField(
  diagnostic: WorkspaceContextDiagnostic,
): ContextInspectorField {
  return {
    id: diagnostic.id,
    label: diagnostic.code,
    value: diagnostic.summary,
    tone:
      diagnostic.severity === "error"
        ? "danger"
        : diagnostic.severity === "warning"
          ? "warning"
          : "muted",
  };
}

function selectTopActions(
  actions: readonly ContextInspectorActionDescriptor[],
): readonly ContextInspectorActionDescriptor[] {
  return [...actions]
    .sort(
      (left, right) =>
        (right.priority ?? 0) - (left.priority ?? 0) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, 4);
}

/**
 * 将统一 Workspace Context 投影转换为只读展示模型。
 * 所有异常和过期来源都降级为可见状态，不会阻断其它分区渲染。
 */
export function buildContextInspectorViewModel(
  context: WorkspaceContextProjection,
  actions: readonly ContextInspectorActionDescriptor[] = [],
): ContextInspectorViewModel {
  const sourceHasError = context.freshness.sources.some(
    (source) => source.status === "error",
  );
  const status = sourceHasError
    ? "error"
    : context.freshness.state === "stale"
      ? "stale"
      : context.freshness.state === "partial"
        ? "partial"
        : "ready";
  const sections: ContextInspectorSection[] = [
    {
      id: "machine",
      title: "机器",
      fields: context.machine
        ? [
            { id: "machine-name", label: "名称", value: context.machine.name, navigationId: `machine:${context.machine.id}` },
            { id: "machine-kind", label: "类型", value: context.machine.kind },
            { id: "machine-status", label: "状态", value: context.machine.status },
            { id: "machine-production", label: "生产目标", value: booleanValue(context.machine.production), tone: context.machine.production ? "warning" : "default" },
          ]
        : [],
      emptyMessage: "当前没有选中的机器。",
    },
    {
      id: "target",
      title: "目标",
      fields: context.target
        ? [
            { id: "target-label", label: "目标", value: context.target.label, navigationId: `target:${context.target.id}` },
            { id: "target-kind", label: "连接", value: context.target.kind },
            { id: "target-host", label: "主机", value: value(context.target.hostLabel) },
            { id: "target-container", label: "容器", value: value(context.target.containerLabel) },
          ]
        : [],
      emptyMessage: "当前上下文没有可解析目标。",
    },
    {
      id: "tab-pane",
      title: "页签与窗格",
      fields: [
        { id: "subject", label: "当前对象", value: context.subject.title, navigationId: context.subject.id ? `subject:${context.subject.kind}:${context.subject.id}` : undefined },
        { id: "active-tab", label: "活动页签", value: value(context.activeTabId), navigationId: context.activeTabId ? `tab:${context.activeTabId}` : undefined },
        { id: "focused-pane", label: "焦点窗格", value: value(context.focusedPaneId), navigationId: context.focusedPaneId ? `pane:${context.focusedPaneId}` : undefined },
        { id: "subject-dirty", label: "未保存", value: booleanValue(Boolean(context.subject.dirty)) },
      ],
    },
    {
      id: "location",
      title: "位置",
      fields: [
        { id: "cwd", label: "当前目录", value: value(context.location.cwd), navigationId: context.location.cwd ? `location:${context.location.cwd}` : undefined },
        { id: "cwd-source", label: "来源", value: context.location.cwdSource },
        { id: "path-style", label: "路径风格", value: context.location.pathStyle },
        { id: "confidence", label: "置信度", value: context.location.confidence, tone: context.location.confidence === "low" ? "warning" : "default" },
      ],
    },
    {
      id: "resources",
      title: "资源",
      fields: [
        { id: "tabs", label: "页签", value: value(context.resources.tabs.length) },
        { id: "panes", label: "窗格", value: value(context.resources.panes.length) },
        { id: "files", label: "工作区文件", value: value(context.resources.workspaceFileCount) },
        { id: "dirty-files", label: "未保存文件", value: value(context.resources.dirtyWorkspaceFileCount), tone: context.resources.dirtyWorkspaceFileCount > 0 ? "warning" : "default" },
      ],
    },
    {
      id: "runtime",
      title: "运行态",
      fields: [
        { id: "connection", label: "连接状态", value: context.runtime.connectionStatus },
        { id: "pane-mode", label: "窗格模式", value: value(context.runtime.paneMode) },
        { id: "latency", label: "延迟", value: context.runtime.latencyMs === null ? EMPTY_VALUE : `${context.runtime.latencyMs} ms` },
        { id: "tmux", label: "tmux", value: context.runtime.tmuxAttached ? "已附加" : "未附加" },
      ],
    },
    {
      id: "agent",
      title: "Agent",
      fields: [
        { id: "agent-session", label: "会话", value: value(context.agent.sessionId), navigationId: context.agent.sessionId ? `agent:${context.agent.sessionId}` : undefined },
        { id: "agent-status", label: "状态", value: context.agent.status },
      ],
      emptyMessage: "当前没有关联 Agent 会话。",
    },
    {
      id: "freshness",
      title: "新鲜度",
      status: context.freshness.state === "fresh" ? "normal" : context.freshness.state,
      fields: context.freshness.sources.map((source) => ({
        id: `source-${source.source}`,
        label: sourceStatusLabel(source),
        value: source.updatedAt ?? value(source.revision),
        tone:
          source.status === "error"
            ? "danger"
            : source.status === "stale" || source.status === "unavailable"
              ? "warning"
              : "muted",
      })),
      emptyMessage: "没有来源状态。",
    },
    {
      id: "diagnostics",
      title: "诊断",
      status: context.diagnostics.some((item) => item.severity === "error")
        ? "error"
        : context.diagnostics.length > 0
          ? "partial"
          : "normal",
      fields: context.diagnostics.map(diagnosticField),
      emptyMessage: "没有上下文诊断。",
    },
  ];

  return {
    title: context.subject.title || "当前上下文",
    subtitle: context.target?.label ?? context.machine?.name ?? "未选择工作目标",
    production: Boolean(context.target?.production ?? context.machine?.production),
    status,
    sections,
    topActions: selectTopActions(actions),
  };
}
