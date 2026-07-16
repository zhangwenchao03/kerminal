import { invoke, isTauri } from "@tauri-apps/api/core";

export function hasTerminalSuggestionTransport() {
  return isTauri();
}

export function invokeTerminalSuggestionCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
) {
  return args === undefined
    ? invoke<TResult>(command)
    : invoke<TResult>(command, args);
}
