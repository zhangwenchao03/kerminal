import type { RemoteTargetKind, RemoteTargetRef } from "../../lib/targetModel";
import type {
  TerminalCommandBlock,
  TerminalCommandBlockMarker,
} from "./terminalCommandBlocks";

interface Disposable {
  dispose: () => void;
}

interface TerminalWithOptionalParser {
  buffer?: {
    active?: {
      cursorX?: number;
      cursorY?: number;
    };
  };
  parser?: {
    registerCsiHandler?: (
      identifier: { final: string; prefix?: string },
      callback: (params: CsiParams) => boolean,
    ) => Disposable;
    registerEscHandler?: (
      identifier: { final: string },
      callback: () => boolean,
    ) => Disposable;
  };
}

interface TerminalWithMarkers {
  buffer: {
    active: {
      baseY?: number;
      cursorY?: number;
    };
  };
  registerMarker: (offset: number) => TerminalCommandBlockMarker | undefined;
}

type CsiParams = Array<number | number[]>;

const noopDisposable: Disposable = {
  dispose: () => undefined,
};

export function remoteSuggestionHostId(
  target: RemoteTargetRef | undefined,
  remoteHostId: string | undefined,
) {
  if (
    target?.kind === "dockerContainer" ||
    target?.kind === "telnet" ||
    target?.kind === "serial"
  ) {
    return undefined;
  }
  return remoteHostId;
}

export function terminalSessionTargetKind(
  target: RemoteTargetRef | undefined,
  remoteHostId: string | undefined,
): RemoteTargetKind {
  if (target?.kind === "dockerContainer") {
    return "dockerContainer";
  }
  if (target?.kind === "telnet") {
    return "telnet";
  }
  if (target?.kind === "serial") {
    return "serial";
  }
  return remoteHostId ? "ssh" : "local";
}

export function terminalSessionFailureLabel(
  target: RemoteTargetRef | undefined,
  remoteHostId: string | undefined,
) {
  switch (terminalSessionTargetKind(target, remoteHostId)) {
    case "dockerContainer":
      return "容器会话启动失败";
    case "telnet":
      return "Telnet 会话启动失败";
    case "serial":
      return "Serial 会话启动失败";
    case "ssh":
      return "SSH 会话启动失败";
    case "local":
      return "本地终端启动失败";
  }
}

export function terminalSessionStartupNotice(
  reason: "initial" | "reconnect",
  target: RemoteTargetRef | undefined,
  remoteHostId: string | undefined,
  startupMessage: string | undefined,
) {
  if (reason === "reconnect") {
    return "\r\n正在重新连接...\r\n";
  }
  if (typeof startupMessage === "string") {
    return startupMessage;
  }
  switch (terminalSessionTargetKind(target, remoteHostId)) {
    case "dockerContainer":
      return "正在进入容器...\r\n";
    case "telnet":
      return "正在连接 Telnet 主机...\r\n";
    case "serial":
      return "正在连接 Serial 设备...\r\n";
    case "ssh":
      return "正在连接 SSH 主机...\r\n";
    case "local":
      return "正在启动本地终端...\r\n";
  }
}

export function disposeCommandBlockMarkers(block: TerminalCommandBlock) {
  block.endMarker?.dispose();
  block.marker.dispose();
}

export function registerMarkerAtLine(
  terminal: TerminalWithMarkers,
  line: number | undefined,
) {
  if (typeof line === "number") {
    const activeBuffer = terminal.buffer.active;
    if (
      typeof activeBuffer.baseY === "number" &&
      typeof activeBuffer.cursorY === "number"
    ) {
      const currentLine = activeBuffer.baseY + activeBuffer.cursorY;
      const marker = terminal.registerMarker(line - currentLine);
      if (marker) {
        return marker;
      }
    }
  }
  return terminal.registerMarker(0);
}

export function registerCommandBlockClearHandlers(
  terminal: TerminalWithOptionalParser,
  clearCommandBlocks: () => void,
  options: {
    shouldPreserveOriginEraseBelow?: () => boolean;
  } = {},
): Disposable {
  const disposables: Disposable[] = [];
  const registerEscHandler = terminal.parser?.registerEscHandler?.bind(
    terminal.parser,
  );
  if (registerEscHandler) {
    disposables.push(
      registerEscHandler({ final: "c" }, () => {
        clearCommandBlocks();
        return false;
      }),
    );
  }

  const registerCsiHandler = terminal.parser?.registerCsiHandler?.bind(
    terminal.parser,
  );
  if (registerCsiHandler) {
    const eraseInDisplayHandler = (params: CsiParams) => {
      if (shouldClearCommandBlocksForEraseInDisplay(terminal, params, options)) {
        clearCommandBlocks();
      }
      return false;
    };
    disposables.push(
      registerCsiHandler({ final: "J" }, eraseInDisplayHandler),
      registerCsiHandler({ prefix: "?", final: "J" }, eraseInDisplayHandler),
    );
  }

  if (disposables.length === 0) {
    return noopDisposable;
  }
  return {
    dispose: () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}

function shouldClearCommandBlocksForEraseInDisplay(
  terminal: TerminalWithOptionalParser,
  params: CsiParams,
  options: {
    shouldPreserveOriginEraseBelow?: () => boolean;
  },
) {
  const eraseParams = params.length > 0 ? params : [0];
  if (eraseParams.some(containsFullDisplayEraseParam)) {
    return true;
  }
  const isOriginEraseBelow =
    eraseParams.some(containsEraseBelowParam) &&
    terminal.buffer?.active?.cursorX === 0 &&
    terminal.buffer.active.cursorY === 0;
  if (!isOriginEraseBelow) {
    return false;
  }
  return !options.shouldPreserveOriginEraseBelow?.();
}

function containsFullDisplayEraseParam(param: number | number[]) {
  if (Array.isArray(param)) {
    return param.some(isFullDisplayEraseParam);
  }
  return isFullDisplayEraseParam(param);
}

function containsEraseBelowParam(param: number | number[]) {
  if (Array.isArray(param)) {
    return param.some(isEraseBelowParam);
  }
  return isEraseBelowParam(param);
}

function isFullDisplayEraseParam(param: number) {
  return param === 2 || param === 3;
}

function isEraseBelowParam(param: number) {
  return param === 0;
}
