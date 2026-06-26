import { localTarget, sshTarget, targetStableId } from "../../../lib/targetModel";
import type {
  TmuxPaneBinding,
  TmuxSessionSummary,
  TmuxTargetRef,
} from "../../../lib/tmuxApi";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";
import { isTerminalSessionTab } from "../../workspace/types";

export type TmuxTargetResolution =
  | {
      status: "ready";
      target: TmuxTargetRef;
      targetLabel: string;
      targetRef: string;
      source: "focusedPane" | "activeTab" | "selectedMachine";
    }
  | {
      status: "empty" | "unsupported";
      reason: string;
      targetLabel?: string;
      source?: "focusedPane" | "activeTab" | "selectedMachine";
    };

export interface ResolveTmuxTargetInput {
  activeMachine?: Machine;
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
}

export function resolveTmuxTarget({
  activeMachine,
  activeTab,
  focusedPane,
  selectedMachine,
}: ResolveTmuxTargetInput): TmuxTargetResolution {
  const focusedTarget = targetFromPane(focusedPane);
  if (focusedTarget) {
    return focusedTarget;
  }

  const activeMachineTarget =
    activeMachine && isTerminalSessionTab(activeTab)
      ? targetFromMachine(activeMachine, "activeTab")
      : undefined;
  if (activeMachineTarget) {
    return activeMachineTarget;
  }

  const selectedTarget = targetFromMachine(selectedMachine, "selectedMachine");
  if (selectedTarget) {
    return selectedTarget;
  }

  if (selectedMachine) {
    return {
      reason:
        selectedMachine.kind === "dockerContainer"
          ? "Docker target is not wired to tmux yet"
          : "target has no non-interactive tmux executor",
      source: "selectedMachine",
      status: "unsupported",
      targetLabel: selectedMachine.name,
    };
  }

  return {
    reason: "select a local or SSH target, or focus a terminal pane",
    status: "empty",
  };
}

export function sortTmuxSessions(
  sessions: TmuxSessionSummary[],
  currentBinding?: TmuxPaneBinding,
) {
  return [...sessions].sort((left, right) => {
    const leftScore = tmuxSessionSortScore(left, currentBinding);
    const rightScore = tmuxSessionSortScore(right, currentBinding);
    return (
      rightScore - leftScore ||
      (right.activityAt ?? 0) - (left.activityAt ?? 0) ||
      left.name.localeCompare(right.name, "zh-Hans-CN")
    );
  });
}

export function tmuxSessionMatchesBinding(
  session: Pick<TmuxSessionSummary, "id" | "name" | "targetRef">,
  binding?: TmuxPaneBinding,
) {
  return Boolean(
    binding &&
      session.targetRef === binding.targetRef &&
      (session.id === binding.sessionId || session.name === binding.sessionName),
  );
}

export function tmuxPaneBindingMatches(
  left: TmuxPaneBinding | undefined,
  right: TmuxPaneBinding | undefined,
) {
  return Boolean(
    left &&
      right &&
      left.targetRef === right.targetRef &&
      left.sessionId === right.sessionId &&
      left.socketName === right.socketName &&
      left.socketPath === right.socketPath,
  );
}

export function findTmuxAttachPane(
  panes: TerminalPane[] | undefined,
  session: TmuxSessionSummary,
) {
  return panes?.find((pane) =>
    tmuxSessionMatchesBinding(session, pane.tmuxBinding),
  );
}

export function defaultTmuxSessionName({
  cwd,
  now = new Date(),
  targetLabel,
}: {
  cwd?: string;
  now?: Date;
  targetLabel?: string;
}) {
  const cwdName = basename(cwd);
  const base = sanitizeSessionName(cwdName || targetLabel || "kerminal");
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `${base}-${timestamp}`;
}

export function tmuxStatusLabel(session: TmuxSessionSummary, current: boolean) {
  if (session.status === "stale") {
    return "会话已失效";
  }
  if (current) {
    return "当前终端";
  }
  return session.attached ? "已连接" : "未连接";
}

export function tmuxActionDisabledReason({
  busy,
  session,
}: {
  busy?: boolean;
  session: TmuxSessionSummary;
}) {
  if (busy) {
    return "正在执行操作";
  }
  if (session.status === "stale") {
    return "会话已失效";
  }
  return undefined;
}

function targetFromPane(
  pane?: TerminalPane,
): TmuxTargetResolution | undefined {
  if (!pane) {
    return undefined;
  }
  if (pane.target?.kind === "local") {
    const target = { target: pane.target };
    return readyTarget(target, pane.title, "focusedPane");
  }
  if (pane.target?.kind === "ssh") {
    const target = { target: pane.target };
    return readyTarget(target, pane.title, "focusedPane");
  }
  if (pane.mode === "ssh" && pane.remoteHostId) {
    const target = { target: sshTarget(pane.remoteHostId) };
    return readyTarget(target, pane.title, "focusedPane");
  }
  if (pane.mode === "local") {
    const target = { target: localTarget(pane.profileId) };
    return readyTarget(target, pane.title, "focusedPane");
  }
  if (pane.mode === "container") {
    return {
      reason: "Docker target is not wired to tmux yet",
      source: "focusedPane",
      status: "unsupported",
      targetLabel: pane.title,
    };
  }
  return undefined;
}

function targetFromMachine(
  machine: Machine | undefined,
  source: "activeTab" | "selectedMachine",
): TmuxTargetResolution | undefined {
  if (!machine) {
    return undefined;
  }
  if (machine.kind === "local") {
    return readyTarget(
      { target: machine.target ?? localTarget(machine.profileId) },
      machine.name,
      source,
    );
  }
  if (machine.kind === "ssh") {
    return readyTarget({ target: sshTarget(machine.id) }, machine.name, source);
  }
  return undefined;
}

function readyTarget(
  target: TmuxTargetRef,
  targetLabel: string,
  source: "focusedPane" | "activeTab" | "selectedMachine",
): TmuxTargetResolution {
  return {
    source,
    status: "ready",
    target,
    targetLabel,
    targetRef: targetStableId(target.target),
  };
}

function tmuxSessionSortScore(
  session: TmuxSessionSummary,
  currentBinding?: TmuxPaneBinding,
) {
  if (tmuxSessionMatchesBinding(session, currentBinding)) {
    return 10_000;
  }
  if (session.attached) {
    return 1_000;
  }
  return 0;
}

function basename(path: string | undefined) {
  const normalized = path?.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function sanitizeSessionName(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "kerminal"
  );
}
