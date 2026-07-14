import { listTerminalSessions } from "../../lib/terminalApi";

export interface TerminalSessionStatusPollContext {
  currentRun: number;
  sessionId: string;
  sessionStartedAtMs: number;
}

export interface TerminalSessionStatusPollTimer {
  clear(timerId: number): void;
  schedule(callback: () => void, delayMs: number): number;
}

interface CreateTerminalSessionStatusPollControllerOptions {
  intervalMs?: number;
  isCurrent(context: TerminalSessionStatusPollContext): boolean;
  listSessions?: typeof listTerminalSessions;
  onSessionClosed(
    context: TerminalSessionStatusPollContext,
    message: string,
  ): void;
  timer?: TerminalSessionStatusPollTimer;
}

export interface TerminalSessionStatusPollController {
  clear(): void;
  schedule(context: TerminalSessionStatusPollContext): void;
}

const DEFAULT_STATUS_POLL_INTERVAL_MS = 2_000;
const SESSION_EXITED_MESSAGE =
  "\r\n会话已退出，可通过右键菜单重新连接。\r\n";

/** 持有终端会话状态轮询 timer，并在每个异步边界重新校验 generation。 */
export function createTerminalSessionStatusPollController({
  intervalMs = DEFAULT_STATUS_POLL_INTERVAL_MS,
  isCurrent,
  listSessions = listTerminalSessions,
  onSessionClosed,
  timer = browserStatusPollTimer,
}: CreateTerminalSessionStatusPollControllerOptions): TerminalSessionStatusPollController {
  let timerId: number | null = null;

  const clear = () => {
    if (timerId === null) {
      return;
    }
    timer.clear(timerId);
    timerId = null;
  };
  const schedule = (context: TerminalSessionStatusPollContext) => {
    clear();
    timerId = timer.schedule(() => {
      timerId = null;
      if (!isCurrent(context)) {
        return;
      }
      void listSessions()
        .then((sessions) => {
          if (!isCurrent(context)) {
            return;
          }
          const session = sessions.find(
            (candidate) => candidate.id === context.sessionId,
          );
          if (!session || session.status === "exited") {
            onSessionClosed(context, SESSION_EXITED_MESSAGE);
            return;
          }
          schedule(context);
        })
        .catch(() => {
          if (isCurrent(context)) {
            schedule(context);
          }
        });
    }, intervalMs);
  };

  return { clear, schedule };
}

const browserStatusPollTimer: TerminalSessionStatusPollTimer = {
  clear: (timerId) => window.clearTimeout(timerId),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
};
