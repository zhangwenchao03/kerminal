import type { SshTerminalFailure } from "./terminalSshFailurePolicy";
import { decideSshTerminalReconnect } from "./terminalSshFailurePolicy";

interface TerminalReconnectOutputWriter {
  writeNow(data: string): void;
}

interface SshFailureTracker {
  current(): SshTerminalFailure | undefined;
}

interface TerminalReconnectRuntimeOptions {
  isSshTerminalTarget: () => boolean;
  outputWriter: TerminalReconnectOutputWriter;
  readAutoReconnect: () => boolean;
  sshFailureTracker: SshFailureTracker;
  startSession: () => void;
  window: Window;
}

export function createTerminalReconnectRuntime({
  isSshTerminalTarget,
  outputWriter,
  readAutoReconnect,
  sshFailureTracker,
  startSession,
  window,
}: TerminalReconnectRuntimeOptions) {
  let reconnectTimer: number | null = null;
  let sshReconnectAttempt = 0;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer !== null) {
      return;
    }
    if (!isSshTerminalTarget()) {
      if (!readAutoReconnect()) {
        return;
      }
      outputWriter.writeNow("\r\n3 秒后自动重新连接...\r\n");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        startSession();
      }, 3000);
      return;
    }
    const decision = decideSshTerminalReconnect({
      appearanceAutoReconnect: readAutoReconnect(),
      attempt: sshReconnectAttempt,
      failure: sshFailureTracker.current(),
    });
    sshReconnectAttempt = decision.nextAttempt;
    outputWriter.writeNow(decision.notice);
    if (!decision.autoReconnect) {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      startSession();
    }, decision.delayMs);
  };

  return {
    clearReconnectTimer,
    diagnosticsSnapshot: () => ({
      reconnecting: reconnectTimer !== null,
      sshReconnectAttempt,
    }),
    resetSshReconnectAttempts: () => {
      sshReconnectAttempt = 0;
    },
    scheduleReconnect,
  };
}
