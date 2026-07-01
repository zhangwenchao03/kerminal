// @author kongweiguang

import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  applyTerminalShellIntegrationOsc7,
  parseTerminalShellIntegrationOsc133,
  type TerminalShellIntegrationEvent,
  type TerminalShellIntegrationOsc133Event,
  type TerminalShellIntegrationState,
} from "./terminalShellIntegrationModel";

type XtermOscDisposable = { dispose: () => void };

interface XtermOscParserHost {
  parser?: {
    registerOscHandler?: (
      identifier: number,
      handler: (data: string) => boolean,
    ) => XtermOscDisposable;
  };
}

export function installShellIntegrationOscHandlers(
  terminal: XtermTerminal,
  callbacks: {
    onCurrentCwd: (cwd: string) => void;
    onOsc133?: (event: TerminalShellIntegrationOsc133Event) => void;
    readState: () => TerminalShellIntegrationState;
    reduceState: (event: TerminalShellIntegrationEvent) => void;
    writeState: (state: TerminalShellIntegrationState) => void;
  },
): XtermOscDisposable[] {
  const parser = (terminal as XtermOscParserHost).parser;
  if (typeof parser?.registerOscHandler !== "function") {
    return [];
  }

  const osc7Disposable = parser.registerOscHandler(7, (payload) => {
    const result = applyTerminalShellIntegrationOsc7(
      callbacks.readState(),
      payload,
    );
    callbacks.writeState(result.state);
    if (result.cwd) {
      callbacks.onCurrentCwd(result.cwd);
      return true;
    }
    return result.state.trusted;
  });
  const osc133Disposable = parser.registerOscHandler(133, (payload) => {
    const previousState = callbacks.readState();
    const event = parseTerminalShellIntegrationOsc133(payload);
    callbacks.reduceState({ payload, type: "osc133" });
    if (previousState.trusted && event) {
      callbacks.onOsc133?.(event);
    }
    return previousState.trusted;
  });

  return [osc7Disposable, osc133Disposable];
}

export function isClearScreenCommand(command: string) {
  return /^(?:clear|cls|clear-host|reset)(?:\s|$)/i.test(command.trim());
}
