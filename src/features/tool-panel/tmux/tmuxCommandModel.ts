import { writeTerminal } from "../../../lib/terminalApi";
import type { TmuxSessionSummary, TmuxTargetRef } from "../../../lib/tmuxApi";
import { getTerminalPaneSession } from "../../terminal/terminalSessionRegistry";
import { tmuxShortcutData } from "./tmuxQuickrefModel";

export function buildTmuxAttachCommand(
  target: TmuxTargetRef,
  session: TmuxSessionSummary,
) {
  const program = target.tmuxPath?.trim() || "tmux";
  const args = [
    ...socketArgs(target),
    "attach-session",
    "-t",
    session.id || session.name,
  ];
  return [program, ...args.map(shellQuote)].join(" ");
}

export async function writeTmuxDetachShortcut(paneId: string) {
  return writeTmuxShortcut(paneId, tmuxShortcutData("d"));
}

export async function writeTmuxShortcut(paneId: string, data: string) {
  const terminalSessionId = getTerminalPaneSession(paneId);
  if (!terminalSessionId) {
    return false;
  }
  await writeTerminal(terminalSessionId, data);
  return true;
}

function socketArgs(target: TmuxTargetRef) {
  if (target.socketName?.trim()) {
    return ["-L", target.socketName.trim()];
  }
  if (target.socketPath?.trim()) {
    return ["-S", target.socketPath.trim()];
  }
  return [];
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
