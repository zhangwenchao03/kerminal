// @author kongweiguang

import type {
  TerminalArtifact,
  TerminalArtifactActionMetadata,
  TerminalArtifactKind,
  TerminalArtifactSensitivity,
  TerminalArtifactSource,
} from "./types";

type TerminalArtifactUiActionId =
  "copy" | "open" | "reveal" | "send-to-agent";

type TerminalArtifactActionRoute =
  "execute" | "confirmation" | "preview";

/** UI 和菜单共享的动作描述；不携带执行函数，避免展示层绕过确认策略。 */
export interface TerminalArtifactUiAction {
  disabledReason?: string;
  enabled: boolean;
  id: TerminalArtifactUiActionId;
  label: string;
  route: TerminalArtifactActionRoute;
}

/** 集成层收到请求后再选择既有 controller、确认框或 Agent preview。 */
export interface TerminalArtifactActionRequest {
  actionId: TerminalArtifactUiActionId;
  artifact: TerminalArtifact;
  route: TerminalArtifactActionRoute;
}

export interface TerminalArtifactViewModel {
  actions: readonly TerminalArtifactUiAction[];
  id: string;
  kindLabel: string;
  label: string;
  sensitivity: TerminalArtifactSensitivity;
  sensitivityLabel: string;
  sourceLabel: string;
  targetLabel: string;
}

const KIND_LABELS: Record<TerminalArtifactKind, string> = {
  command: "命令",
  directory: "目录",
  link: "链接",
  log: "日志",
  path: "路径",
  url: "URL",
};

const SOURCE_LABELS: Record<TerminalArtifactSource, string> = {
  "command-block": "命令块",
  heuristic: "文本检测",
  "link-provider": "链接提供器",
  osc7: "工作目录",
  osc8: "终端链接",
};

const SENSITIVITY_LABELS: Record<TerminalArtifactSensitivity, string> = {
  blocked: "已阻止",
  normal: "普通",
  sensitive: "敏感",
};

/** 从底层 policy 派生统一动作，不复制 target/path 安全判断。 */
export function buildTerminalArtifactActions(
  artifact: TerminalArtifact,
): readonly TerminalArtifactUiAction[] {
  const sensitive = artifact.sensitivity !== "normal";
  const copy = findAction(artifact.actions, "copy");
  const open = findAction(artifact.actions, "open");
  const openTerminal = findAction(artifact.actions, "open-terminal");
  const reveal = findAction(artifact.actions, "reveal");
  const actions: TerminalArtifactUiAction[] = [
    presentAction("copy", "复制", copy, sensitive ? "confirmation" : "execute"),
    presentAction(
      "open",
      artifact.kind === "url" || artifact.kind === "link"
        ? "打开链接"
        : "在终端中打开",
      open ?? openTerminal,
      sensitive ? "confirmation" : "execute",
    ),
    presentAction(
      "reveal",
      "在文件管理器中显示",
      reveal,
      sensitive ? "confirmation" : "execute",
    ),
    {
      enabled: artifact.sensitivity !== "blocked",
      id: "send-to-agent",
      label: "发送给 Agent",
      route: "preview",
      ...(artifact.sensitivity === "blocked"
        ? { disabledReason: "该产物已被敏感策略阻止" }
        : {}),
    },
  ];
  return actions;
}

/** 只返回展示安全的元数据；正文 value 不会被复制进 view model。 */
export function createTerminalArtifactViewModel(
  artifact: TerminalArtifact,
): TerminalArtifactViewModel {
  return {
    actions: buildTerminalArtifactActions(artifact),
    id: artifact.id,
    kindLabel: KIND_LABELS[artifact.kind],
    label: artifact.label,
    sensitivity: artifact.sensitivity,
    sensitivityLabel: SENSITIVITY_LABELS[artifact.sensitivity],
    sourceLabel: SOURCE_LABELS[artifact.source],
    targetLabel: artifact.target.host ?? artifact.target.id,
  };
}

function findAction(
  actions: readonly TerminalArtifactActionMetadata[],
  id: TerminalArtifactActionMetadata["id"],
) {
  return actions.find((action) => action.id === id);
}

function presentAction(
  id: TerminalArtifactUiActionId,
  label: string,
  source: TerminalArtifactActionMetadata | undefined,
  route: TerminalArtifactActionRoute,
): TerminalArtifactUiAction {
  return {
    enabled: source?.enabled ?? false,
    id,
    label,
    route,
    ...(!source?.enabled
      ? { disabledReason: source?.disabledReason ?? "该产物不支持此动作" }
      : {}),
  };
}
