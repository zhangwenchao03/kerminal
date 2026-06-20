import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  normalizeAppSettings,
  type AppSettings,
} from "../features/settings/settingsModel";
import type { Machine, TerminalPane, TerminalTab } from "../features/workspace/types";

export interface AiTerminalContextRequest {
  sessionId?: string;
  paneId?: string;
  paneTitle?: string;
  tabId?: string;
  tabTitle?: string;
  machineId?: string;
  machineName?: string;
  machineKind?: string;
  maxOutputBytes?: number;
}

export interface AiTerminalContextSource {
  paneId?: string;
  paneTitle?: string;
  tabId?: string;
  tabTitle?: string;
  machineId?: string;
  machineName?: string;
  machineKind?: string;
}

export interface AiContextPolicySnapshot {
  mode: string;
  includesRecentOutput: boolean;
  includesFullHistory: boolean;
  secretRedaction: boolean;
  maxOutputBytes: number;
}

export interface TerminalContextSessionSummary {
  id: string;
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
  pid?: number;
  status: "running" | "exited";
}

export interface TerminalOutputSnapshot {
  data: string;
  capturedBytes: number;
  maxBytes: number;
  truncated: boolean;
}

export interface AiTerminalContextSnapshot {
  generatedAt: string;
  session: TerminalContextSessionSummary;
  source: AiTerminalContextSource;
  output: TerminalOutputSnapshot;
  redacted: boolean;
  policy: AiContextPolicySnapshot;
}

export interface AiTerminalContextTarget {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  sessionId?: string;
  settings?: AppSettings;
}

const DEFAULT_OUTPUT_BYTES = 12 * 1024;

export async function getAiTerminalContextSnapshot(
  request: AiTerminalContextRequest,
): Promise<AiTerminalContextSnapshot> {
  if (!isTauri()) {
    return browserPreviewContext(request);
  }

  if (!request.sessionId) {
    throw new Error("当前 pane 尚未绑定终端 session");
  }

  return invoke<AiTerminalContextSnapshot>("ai_terminal_context_snapshot", {
    request: {
      ...request,
      maxOutputBytes: request.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES,
      sessionId: request.sessionId,
    },
  });
}

export function buildAiTerminalContextRequest({
  activeTab,
  focusedPane,
  selectedMachine,
  sessionId,
  settings,
}: AiTerminalContextTarget): AiTerminalContextRequest {
  const normalizedSettings = normalizeAppSettings(settings);

  return {
    machineId: selectedMachine?.id ?? focusedPane?.machineId,
    machineKind: selectedMachine?.kind ?? focusedPane?.mode,
    machineName: selectedMachine?.name,
    maxOutputBytes: normalizedSettings.ai.contextMaxOutputBytes,
    paneId: focusedPane?.id,
    paneTitle: focusedPane?.title,
    sessionId,
    tabId: activeTab?.id,
    tabTitle: activeTab?.title,
  };
}

function browserPreviewContext(
  request: AiTerminalContextRequest,
): AiTerminalContextSnapshot {
  const data = [
    "Kerminal 浏览器预览模式。",
    "真实 Tauri 窗口会读取当前终端最近输出、shell、cwd、pane 和主机信息。",
    "当前预览不会执行命令，也不会连接真实 SSH 主机。",
  ].join("\n");

  return {
    generatedAt: String(Math.floor(Date.now() / 1000)),
    output: {
      capturedBytes: data.length,
      data,
      maxBytes: request.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES,
      truncated: false,
    },
    policy: {
      includesFullHistory: false,
      includesRecentOutput: true,
      maxOutputBytes: request.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES,
      mode: "currentTerminal",
      secretRedaction: true,
    },
    redacted: false,
    session: {
      cols: 80,
      cwd: undefined,
      id: request.sessionId ?? "browser-preview-session",
      rows: 24,
      shell: request.machineKind === "ssh" ? "ssh-preview" : "browser-preview",
      status: "running",
    },
    source: {
      machineId: request.machineId,
      machineKind: request.machineKind,
      machineName: request.machineName,
      paneId: request.paneId,
      paneTitle: request.paneTitle,
      tabId: request.tabId,
      tabTitle: request.tabTitle,
    },
  };
}
