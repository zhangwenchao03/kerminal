// @author kongweiguang

import type { AgentSessionTargetRequest } from "../../../lib/agentLauncherApi";
import { targetStableId } from "../../../lib/targetModel";
import {
  getTerminalPaneSessionRecord,
  type PaneSessionRecord,
} from "../../terminal/session/index";
import {
  isTerminalSessionTab,
  type TerminalPane,
  type TerminalTab,
} from "../../workspace/contracts/index";

export function buildAgentSessionTarget(
  focusedPane?: TerminalPane,
  activeTab?: TerminalTab,
): AgentSessionTargetRequest | undefined {
  if (!focusedPane) {
    return undefined;
  }
  const paneSession = getTerminalPaneSessionRecord(focusedPane.id);
  if (!paneSession?.sessionId) {
    return undefined;
  }
  return {
    cwd: paneSession.cwd ?? focusedPane.currentCwd ?? focusedPane.cwd,
    liveStatus: "ready",
    paneId: focusedPane.id,
    shell: paneSession.shell ?? focusedPane.shell,
    tabId: paneSession.tabId ?? activeTab?.id,
    targetKind: paneSession.target ?? paneTargetKind(focusedPane),
    targetRef: buildAgentTargetRef(focusedPane, activeTab, paneSession),
    targetTerminalSessionId: paneSession.sessionId,
  };
}

function buildAgentTargetRef(
  focusedPane: TerminalPane,
  activeTab: TerminalTab | undefined,
  paneSession: PaneSessionRecord,
): string {
  if (paneSession.targetRef?.trim()) {
    return paneSession.targetRef.trim();
  }
  if (focusedPane.target) {
    return targetStableId(focusedPane.target);
  }
  const tabPart = activeTab?.id ? `tab:${activeTab.id}` : undefined;
  const panePart = `pane:${focusedPane.id}`;
  if (paneSession.target === "dockerContainer") {
    return joinTargetRefParts([
      "dockerContainer",
      paneSession.remoteHostId ? `host:${paneSession.remoteHostId}` : undefined,
      paneSession.containerRuntime
        ? `runtime:${paneSession.containerRuntime}`
        : undefined,
      paneSession.containerId ? `container:${paneSession.containerId}` : undefined,
      tabPart,
      panePart,
    ]);
  }
  if (paneSession.target === "local") {
    return joinTargetRefParts([
      "local",
      paneSession.profileId ? `profile:${paneSession.profileId}` : "profile:default",
      tabPart,
      panePart,
    ]);
  }
  return joinTargetRefParts([
    paneSession.target,
    paneSession.remoteHostId ? `host:${paneSession.remoteHostId}` : undefined,
    tabPart,
    panePart,
  ]);
}

function joinTargetRefParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(":");
}

export function formatTargetChipLabel(
  target?: AgentSessionTargetRequest,
): string {
  if (!target?.targetTerminalSessionId) {
    return "未绑定";
  }
  if (target.liveStatus === "closed") {
    return "已关闭";
  }
  if (target.liveStatus === "stale") {
    return "已失效";
  }
  const name = compactTargetName(target.targetRef ?? target.paneId);
  const path = compactTargetPath(target.cwd);
  return path ? `${name} · ${path}` : name;
}

export function formatCurrentAgentTargetLabel(
  focusedPane?: TerminalPane,
  activeTab?: TerminalTab,
): string {
  if (!buildAgentSessionTarget(focusedPane, activeTab)) {
    return "未绑定";
  }
  const paneTitle = focusedPane?.title?.trim();
  if (paneTitle) {
    return paneTitle;
  }
  const tabTitle = isTerminalSessionTab(activeTab)
    ? activeTab.title?.trim()
    : undefined;
  if (tabTitle) {
    return tabTitle;
  }
  if (focusedPane?.mode === "ssh") {
    return "SSH 终端";
  }
  if (focusedPane?.mode === "container") {
    return "容器终端";
  }
  if (focusedPane?.mode === "local") {
    return "本地终端";
  }
  return "当前终端";
}

function compactTargetName(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "当前终端";
  }
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function compactTargetPath(path?: string): string {
  const normalized = path?.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "cwd 未知";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }
  return `.../${segments.slice(-2).join("/")}`;
}

function paneTargetKind(pane: TerminalPane): string | undefined {
  if (pane.mode === "container") {
    return "dockerContainer";
  }
  return pane.mode === "preview" ? undefined : pane.mode;
}
