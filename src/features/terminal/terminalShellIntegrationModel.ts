export type TerminalShellIntegrationMode = "prompt" | "typing" | "running" | "alt";

type TerminalShellIntegrationNormalMode = Exclude<
  TerminalShellIntegrationMode,
  "alt"
>;

export interface TerminalShellIntegrationState {
  mode: TerminalShellIntegrationMode;
  normalMode: TerminalShellIntegrationNormalMode;
  trusted: boolean;
}

export type TerminalShellIntegrationEvent =
  | { type: "session"; trusted: boolean }
  | { type: "input"; data: string }
  | { type: "osc133"; payload: string }
  | { type: "buffer"; bufferType: "normal" | "alternate" };

export interface TerminalShellIntegrationCwdResult {
  cwd?: string;
  state: TerminalShellIntegrationState;
}

type TerminalShellIntegrationOsc133Marker = "A" | "B" | "C" | "D";

export interface TerminalShellIntegrationOsc133Event {
  command?: string;
  exitCode?: number;
  marker: TerminalShellIntegrationOsc133Marker;
}

type TerminalShellIntegrationOsc133Segment =
  | { data: string; type: "data" }
  | { event: TerminalShellIntegrationOsc133Event; type: "osc133" };

export interface TerminalShellIntegrationOsc133Collection {
  buffer: string;
  segments: TerminalShellIntegrationOsc133Segment[];
}

const MAX_SHELL_INTEGRATION_CWD_LENGTH = 4096;
const MAX_SHELL_INTEGRATION_COMMAND_LENGTH = 4096;
const CONTROL_CHAR_RE = new RegExp(String.raw`[\u0000-\u001f\u007f]`);
const CONTROL_CHARS_GLOBAL_RE = new RegExp(
  String.raw`[\u0000-\u001f\u007f]+`,
  "g",
);
const OSC_133_PREFIX = "\u001b]133;";
const OSC_BEL_TERMINATOR = "\u0007";
const OSC_ST_TERMINATOR = "\u001b\\";
const WINDOWS_DRIVE_PATH_RE = /^\/([A-Za-z]):(?:\/|$)(.*)$/;
const MSYS_DRIVE_PATH_RE = /^\/([A-Za-z])(?:\/|$)(.*)$/;
const DIRECT_WINDOWS_DRIVE_PATH_RE = /^([A-Za-z]):(?:\/|$)(.*)$/;

export function createTerminalShellIntegrationState({
  mode = "prompt",
  trusted = false,
}: {
  mode?: TerminalShellIntegrationMode;
  trusted?: boolean;
} = {}): TerminalShellIntegrationState {
  const normalMode = mode === "alt" ? "prompt" : mode;
  return {
    mode,
    normalMode,
    trusted,
  };
}

export function reduceTerminalShellIntegrationState(
  state: TerminalShellIntegrationState,
  event: TerminalShellIntegrationEvent,
): TerminalShellIntegrationState {
  if (event.type === "session") {
    return createTerminalShellIntegrationState({ trusted: event.trusted });
  }

  if (event.type === "buffer") {
    if (event.bufferType === "alternate") {
      return {
        ...state,
        mode: "alt",
        normalMode: state.mode === "alt" ? state.normalMode : state.mode,
      };
    }
    return {
      ...state,
      mode: state.normalMode,
    };
  }

  if (!state.trusted) {
    return state;
  }

  if (event.type === "input") {
    if (state.mode === "alt") {
      return state;
    }
    return withNormalMode(state, modeAfterInput(state.normalMode, event.data));
  }

  const osc133 = parseTerminalShellIntegrationOsc133(event.payload);
  if (!osc133) {
    return state;
  }

  switch (osc133.marker) {
    case "A":
    case "B":
    case "D":
      return withNormalMode(state, "prompt");
    case "C":
      return withNormalMode(state, "running");
    default:
      return state;
  }
}

export function parseTerminalShellIntegrationOsc133(
  payload: string,
): TerminalShellIntegrationOsc133Event | undefined {
  const [markerPart, ...parts] = payload.trim().split(";");
  const marker = markerPart?.toUpperCase();
  if (marker !== "A" && marker !== "B" && marker !== "C" && marker !== "D") {
    return undefined;
  }

  if (marker === "C") {
    return {
      command: sanitizeShellIntegrationCommand(parts.join(";")),
      marker,
    };
  }

  if (marker === "D") {
    const exitCode = Number.parseInt(parts[0] ?? "", 10);
    return {
      exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
      marker,
    };
  }

  return { marker };
}

export function collectTerminalShellIntegrationOsc133Segments(
  currentBuffer: string,
  data: string,
): TerminalShellIntegrationOsc133Collection {
  const source = currentBuffer + data;
  const segments: TerminalShellIntegrationOsc133Segment[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(OSC_133_PREFIX, cursor);
    if (start === -1) {
      const partialStart = findPartialOsc133PrefixStart(source, cursor);
      if (partialStart >= 0) {
        pushDataSegment(segments, source.slice(cursor, partialStart));
        return {
          buffer: source.slice(partialStart),
          segments,
        };
      }
      pushDataSegment(segments, source.slice(cursor));
      return { buffer: "", segments };
    }

    pushDataSegment(segments, source.slice(cursor, start));
    const payloadStart = start + OSC_133_PREFIX.length;
    const terminator = findOscTerminator(source, payloadStart);
    if (!terminator) {
      return {
        buffer: source.slice(start),
        segments,
      };
    }

    const event = parseTerminalShellIntegrationOsc133(
      source.slice(payloadStart, terminator.index),
    );
    if (event) {
      segments.push({ event, type: "osc133" });
    }
    cursor = terminator.index + terminator.length;
  }

  return { buffer: "", segments };
}

export function applyTerminalShellIntegrationOsc7(
  state: TerminalShellIntegrationState,
  payload: string,
): TerminalShellIntegrationCwdResult {
  if (!state.trusted || state.mode === "running" || state.mode === "alt") {
    return { state };
  }
  const cwd = parseTerminalShellIntegrationCwd(payload);
  return cwd ? { cwd, state } : { state };
}

export function parseTerminalShellIntegrationCwd(
  payload: string,
): string | undefined {
  const trimmed = payload.trim();
  if (!isValidPathCandidate(trimmed)) {
    return undefined;
  }

  const decoded = /^file:/i.test(trimmed)
    ? parseFileUriPath(trimmed)
    : decodePath(trimmed);
  if (!decoded || !isValidPathCandidate(decoded)) {
    return undefined;
  }

  return normalizeShellIntegrationPath(decoded);
}

function withNormalMode(
  state: TerminalShellIntegrationState,
  normalMode: TerminalShellIntegrationNormalMode,
): TerminalShellIntegrationState {
  return {
    ...state,
    mode: state.mode === "alt" ? "alt" : normalMode,
    normalMode,
  };
}

function modeAfterInput(
  mode: TerminalShellIntegrationNormalMode,
  data: string,
): TerminalShellIntegrationNormalMode {
  if (mode === "running") {
    return "running";
  }
  if (data.includes("\r") || data.includes("\n")) {
    return "running";
  }
  if (hasTypingInput(data)) {
    return "typing";
  }
  return mode;
}

function hasTypingInput(data: string): boolean {
  for (const char of data) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") {
      continue;
    }
    if (codePoint === 0x7f || codePoint === 0x08 || codePoint >= 0x20) {
      return true;
    }
  }
  return false;
}

function parseFileUriPath(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (
      url.protocol !== "file:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return decodePath(url.pathname);
  } catch {
    return undefined;
  }
}

function decodePath(path: string): string | undefined {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

function normalizeShellIntegrationPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const windowsDrive = normalized.match(WINDOWS_DRIVE_PATH_RE);
  if (windowsDrive) {
    return `${windowsDrive[1].toUpperCase()}:/${windowsDrive[2]}`;
  }
  const directWindowsDrive = normalized.match(DIRECT_WINDOWS_DRIVE_PATH_RE);
  if (directWindowsDrive) {
    return `${directWindowsDrive[1].toUpperCase()}:/${directWindowsDrive[2]}`;
  }
  const msysDrive = normalized.match(MSYS_DRIVE_PATH_RE);
  if (msysDrive) {
    return `${msysDrive[1].toUpperCase()}:/${msysDrive[2]}`;
  }
  if (normalized.startsWith("/")) {
    return normalized;
  }
  return undefined;
}

function isValidPathCandidate(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MAX_SHELL_INTEGRATION_CWD_LENGTH &&
    !CONTROL_CHAR_RE.test(path)
  );
}

function sanitizeShellIntegrationCommand(command: string): string | undefined {
  const sanitized = command
    .replace(CONTROL_CHARS_GLOBAL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized) {
    return undefined;
  }
  return sanitized.slice(0, MAX_SHELL_INTEGRATION_COMMAND_LENGTH);
}

function pushDataSegment(
  segments: TerminalShellIntegrationOsc133Segment[],
  data: string,
) {
  if (data) {
    segments.push({ data, type: "data" });
  }
}

function findPartialOsc133PrefixStart(source: string, fromIndex: number): number {
  const maxLength = Math.min(OSC_133_PREFIX.length - 1, source.length - fromIndex);
  for (let length = maxLength; length > 0; length -= 1) {
    const start = source.length - length;
    if (
      start >= fromIndex &&
      OSC_133_PREFIX.startsWith(source.slice(start))
    ) {
      return start;
    }
  }
  return -1;
}

function findOscTerminator(
  source: string,
  fromIndex: number,
): { index: number; length: number } | undefined {
  const belIndex = source.indexOf(OSC_BEL_TERMINATOR, fromIndex);
  const stIndex = source.indexOf(OSC_ST_TERMINATOR, fromIndex);
  if (belIndex === -1 && stIndex === -1) {
    return undefined;
  }
  if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
    return { index: belIndex, length: OSC_BEL_TERMINATOR.length };
  }
  return { index: stIndex, length: OSC_ST_TERMINATOR.length };
}
