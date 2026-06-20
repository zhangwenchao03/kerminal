import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { ContainerRuntime } from "./targetModel";

export type TerminalOutputKind = "data" | "closed" | "error";

export type TerminalSessionStatus = "running" | "exited";

export interface TerminalCreateRequest {
  shell?: string;
  args?: string[];
  cwd?: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface SshTerminalCreateRequest {
  hostId: string;
  cols: number;
  rows: number;
}

export interface TelnetTerminalCreateRequest {
  hostId: string;
  cols: number;
  rows: number;
}

export interface SerialTerminalCreateRequest {
  hostId: string;
  cols: number;
  rows: number;
}

export interface DockerContainerTerminalCreateRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
  shell?: string;
  user?: string;
  workdir?: string;
  cols: number;
  rows: number;
}

export interface TerminalResizeRequest {
  cols: number;
  rows: number;
}

export interface TerminalOutputEvent {
  sessionId: string;
  kind: TerminalOutputKind;
  data: string;
}

export interface TerminalSessionSummary {
  id: string;
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
  pid?: number;
  status: TerminalSessionStatus;
}

export interface TerminalSessionLogState {
  active: boolean;
  path?: string;
  startedAt?: string;
  bytesWritten: number;
}

type TerminalOutputHandler = (event: TerminalOutputEvent) => void;

const browserPreviewSessions = new Map<string, TerminalOutputHandler>();
const browserPreviewLogStates = new Map<string, TerminalSessionLogState>();

export async function createTerminalSession(
  request: TerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(request, onOutput);
  }

  const output = new Channel<TerminalOutputEvent>((event) => onOutput(event));
  return invoke<TerminalSessionSummary>("terminal_create_session", {
    output,
    request: normalizeCreateRequest(request),
  });
}

export async function createSshTerminalSession(
  request: SshTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "ssh-preview",
      },
      onOutput,
      "Kerminal 浏览器预览模式\r\n请在 Tauri 应用窗口中连接真实 SSH 主机。\r\n",
    );
  }

  const output = new Channel<TerminalOutputEvent>((event) => onOutput(event));
  return invoke<TerminalSessionSummary>("ssh_create_session", {
    output,
    request,
  });
}

export async function createTelnetTerminalSession(
  request: TelnetTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "telnet-preview",
      },
      onOutput,
      "Kerminal 浏览器预览模式\r\n请在 Tauri 应用窗口中连接真实 Telnet 主机。\r\n",
    );
  }

  const output = new Channel<TerminalOutputEvent>((event) => onOutput(event));
  return invoke<TerminalSessionSummary>("telnet_create_session", {
    output,
    request,
  });
}

export async function createSerialTerminalSession(
  request: SerialTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "serial-preview",
      },
      onOutput,
      "Kerminal 浏览器预览模式\r\n请在 Tauri 应用窗口中连接真实 Serial 设备。\r\n",
    );
  }

  const output = new Channel<TerminalOutputEvent>((event) => onOutput(event));
  return invoke<TerminalSessionSummary>("serial_create_session", {
    output,
    request,
  });
}

export async function createDockerContainerTerminalSession(
  request: DockerContainerTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "container-preview",
      },
      onOutput,
      `Kerminal 浏览器预览模式\r\n请在 Tauri 应用窗口中进入容器：${request.containerId}\r\n`,
    );
  }

  const output = new Channel<TerminalOutputEvent>((event) => onOutput(event));
  return invoke<TerminalSessionSummary>("docker_create_container_session", {
    output,
    request: normalizeDockerContainerCreateRequest(request),
  });
}

export async function writeTerminal(
  sessionId: string,
  data: string,
): Promise<void> {
  if (!isTauri()) {
    browserPreviewSessions.get(sessionId)?.({
      sessionId,
      kind: "data",
      data: `\r\n${data}浏览器预览模式不会执行本地命令。\r\n`,
    });
    return;
  }

  await invoke("terminal_write", { data, sessionId });
}

export async function resizeTerminal(
  sessionId: string,
  request: TerminalResizeRequest,
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("terminal_resize", { request, sessionId });
}

export async function closeTerminal(sessionId: string): Promise<void> {
  if (!isTauri()) {
    browserPreviewSessions.delete(sessionId);
    browserPreviewLogStates.delete(sessionId);
    return;
  }

  await invoke("terminal_close", { sessionId });
}

export async function listTerminalSessions(): Promise<TerminalSessionSummary[]> {
  if (!isTauri()) {
    return Array.from(browserPreviewSessions.keys()).map((id) => ({
      id,
      shell: "browser-preview",
      cols: 80,
      rows: 24,
      status: "running",
    }));
  }

  return invoke<TerminalSessionSummary[]>("terminal_list_sessions");
}

export async function startTerminalLog(
  sessionId: string,
): Promise<TerminalSessionLogState> {
  if (!isTauri()) {
    return startBrowserPreviewLog(sessionId);
  }

  return invoke<TerminalSessionLogState>("terminal_start_log", { sessionId });
}

export async function stopTerminalLog(
  sessionId: string,
): Promise<TerminalSessionLogState> {
  if (!isTauri()) {
    const previous = browserPreviewLogStates.get(sessionId);
    const stopped = previous
      ? { ...previous, active: false }
      : inactiveLogState();
    browserPreviewLogStates.set(sessionId, stopped);
    return stopped;
  }

  return invoke<TerminalSessionLogState>("terminal_stop_log", { sessionId });
}

export async function getTerminalLogState(
  sessionId: string,
): Promise<TerminalSessionLogState> {
  if (!isTauri()) {
    return browserPreviewLogStates.get(sessionId) ?? inactiveLogState();
  }

  return invoke<TerminalSessionLogState>("terminal_log_state", { sessionId });
}

function normalizeCreateRequest(
  request: TerminalCreateRequest,
): TerminalCreateRequest {
  return {
    ...request,
    args: request.args ?? [],
    env: request.env ?? {},
  };
}

function normalizeDockerContainerCreateRequest(
  request: DockerContainerTerminalCreateRequest,
): DockerContainerTerminalCreateRequest {
  return {
    ...request,
    containerId: request.containerId.trim(),
    hostId: request.hostId.trim(),
    runtime: request.runtime ?? "docker",
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
    ...(request.user?.trim() ? { user: request.user.trim() } : {}),
    ...(request.workdir?.trim() ? { workdir: request.workdir.trim() } : {}),
  };
}

function createBrowserPreviewSession(
  request: TerminalCreateRequest,
  onOutput: TerminalOutputHandler,
  welcomeText = "Kerminal 浏览器预览模式\r\n请在 Tauri 应用窗口中使用真实本地 PTY。\r\n",
): TerminalSessionSummary {
  const id = `browser-preview-${Date.now().toString(36)}`;
  browserPreviewSessions.set(id, onOutput);
  browserPreviewLogStates.set(id, inactiveLogState());

  queueMicrotask(() => {
    onOutput({
      sessionId: id,
      kind: "data",
      data: welcomeText,
    });
  });

  return {
    id,
    shell: request.shell ?? "browser-preview",
    cols: request.cols,
    rows: request.rows,
    status: "running",
  };
}

function startBrowserPreviewLog(sessionId: string): TerminalSessionLogState {
  const current = browserPreviewLogStates.get(sessionId);
  if (current?.active) {
    return current;
  }

  const state: TerminalSessionLogState = {
    active: true,
    bytesWritten: 0,
    path: `browser-preview://${sessionId}.log`,
    startedAt: Math.floor(Date.now() / 1000).toString(),
  };
  browserPreviewLogStates.set(sessionId, state);
  return state;
}

function inactiveLogState(): TerminalSessionLogState {
  return {
    active: false,
    bytesWritten: 0,
  };
}
