import { invoke, isTauri } from "@tauri-apps/api/core";

export interface SshCommandRequest {
  hostId: string;
  command: string;
  timeoutSeconds?: number;
  maxOutputBytes?: number;
}

export interface SshCommandOutput {
  hostId: string;
  hostName: string;
  host: string;
  port: number;
  username: string;
  exitCode?: number | null;
  success: boolean;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  maxOutputBytes: number;
  durationMs: number;
}

export async function executeSshCommand(
  request: SshCommandRequest,
): Promise<SshCommandOutput> {
  if (!isTauri()) {
    return browserPreviewOutput(request);
  }

  return invoke<SshCommandOutput>("ssh_command_execute", { request });
}

function browserPreviewOutput(request: SshCommandRequest): SshCommandOutput {
  const stdout = "浏览器预览模式不会写入远端 shell 配置。";
  return {
    durationMs: 0,
    exitCode: 0,
    host: "browser-preview",
    hostId: request.hostId,
    hostName: request.hostId,
    maxOutputBytes: request.maxOutputBytes ?? 4096,
    port: 22,
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
    stdout,
    stdoutBytes: stdout.length,
    stdoutTruncated: false,
    success: true,
    username: "preview",
  };
}
