export type TerminalInputBufferKind = "normal" | "alternate";

type TerminalInputHideReason =
  | "alternate-buffer"
  | "cancelled"
  | "cursor-not-at-end"
  | "empty"
  | "escape-sequence"
  | "ime-composition"
  | "paste"
  | "tab-completion"
  | "unknown";

export interface TerminalInputModelState {
  bufferKind: TerminalInputBufferKind;
  command: string;
  cursor: number;
  hasEscapeBeforeSubmit: boolean;
  hideReason?: TerminalInputHideReason;
  imeComposing: boolean;
  synchronized: boolean;
}

export interface TerminalInputModelUpdate {
  commands: string[];
  state: TerminalInputModelState;
}

export interface TerminalSuggestionEligibility {
  eligible: boolean;
  reason?: TerminalInputHideReason;
}

type EscapeAction =
  | "delete"
  | "down"
  | "end"
  | "home"
  | "left"
  | "right"
  | "unknown"
  | "up"
  | "word-left"
  | "word-right";

interface EscapeToken {
  action: EscapeAction;
  length: number;
}

const ESC = "\u001b";
const BACKSPACE = "\u007f";

export function createTerminalInputModelState(
  overrides: Partial<TerminalInputModelState> = {},
): TerminalInputModelState {
  const command = overrides.command ?? "";
  const commandLength = inputLength(command);

  return {
    bufferKind: overrides.bufferKind ?? "normal",
    command,
    cursor:
      typeof overrides.cursor === "number"
        ? clamp(overrides.cursor, 0, commandLength)
        : commandLength,
    hasEscapeBeforeSubmit: overrides.hasEscapeBeforeSubmit ?? false,
    hideReason: overrides.hideReason,
    imeComposing: overrides.imeComposing ?? false,
    synchronized: overrides.synchronized ?? true,
  };
}

export function updateTerminalInputBufferKind(
  state: TerminalInputModelState,
  bufferKind: TerminalInputBufferKind,
): TerminalInputModelState {
  if (state.bufferKind === bufferKind) {
    return state;
  }

  return createTerminalInputModelState({
    bufferKind,
    hideReason: bufferKind === "alternate" ? "alternate-buffer" : state.hideReason,
    imeComposing: state.imeComposing,
  });
}

export function updateTerminalInputComposition(
  state: TerminalInputModelState,
  imeComposing: boolean,
): TerminalInputModelState {
  return {
    ...state,
    hideReason: imeComposing ? "ime-composition" : state.hideReason,
    imeComposing,
  };
}

export function applyTerminalInputData(
  state: TerminalInputModelState,
  data: string,
): TerminalInputModelUpdate {
  if (state.bufferKind === "alternate") {
    return {
      commands: [],
      state: {
        ...state,
        hideReason: "alternate-buffer",
      },
    };
  }

  let next = state;
  const commands: string[] = [];
  const pasteLike = isPasteLikeInput(data);

  if (pasteLike) {
    next = {
      ...next,
      hideReason: "paste",
    };
  }

  for (let index = 0; index < data.length; ) {
    const char = data[index];

    if (char === ESC) {
      const token = parseEscapeToken(data, index);
      next = applyEscapeToken(next, token);
      index += token.length;
      continue;
    }

    if (char === "\r" || char === "\n") {
      const command = next.command.trim();
      if (command || !next.hasEscapeBeforeSubmit) {
        commands.push(command);
      }
      next = createTerminalInputModelState({
        bufferKind: next.bufferKind,
        hideReason: "empty",
        imeComposing: next.imeComposing,
      });
      index += 1;
      continue;
    }

    if (char === "\u0003") {
      next = createTerminalInputModelState({
        bufferKind: next.bufferKind,
        hideReason: "cancelled",
        imeComposing: next.imeComposing,
      });
      index += 1;
      continue;
    }

    if (char === "\u0015") {
      next = deleteRange(next, 0, next.cursor);
      index += 1;
      continue;
    }

    if (char === "\u0017") {
      next = deletePreviousWord(next);
      index += 1;
      continue;
    }

    if (char === BACKSPACE || char === "\b") {
      next = deleteRange(next, next.cursor - 1, next.cursor);
      index += 1;
      continue;
    }

    if (char === "\t") {
      next = {
        ...next,
        hasEscapeBeforeSubmit: false,
        hideReason: "tab-completion",
        synchronized: false,
      };
      index += 1;
      continue;
    }

    const codePoint = data.codePointAt(index);
    if (typeof codePoint !== "number") {
      index += 1;
      continue;
    }

    const text = String.fromCodePoint(codePoint);
    if (codePoint >= 0x20 && codePoint !== 0x7f) {
      next = insertText(next, text, pasteLike ? "paste" : undefined);
    }
    index += text.length;
  }

  return { commands, state: next };
}

export function terminalSuggestionEligibility(
  state: TerminalInputModelState,
): TerminalSuggestionEligibility {
  if (state.bufferKind === "alternate") {
    return { eligible: false, reason: "alternate-buffer" };
  }
  if (state.imeComposing) {
    return { eligible: false, reason: "ime-composition" };
  }
  if (!state.synchronized) {
    return { eligible: false, reason: state.hideReason ?? "unknown" };
  }
  if (!state.command.trim()) {
    return { eligible: false, reason: "empty" };
  }
  if (state.cursor !== inputLength(state.command)) {
    return { eligible: false, reason: "cursor-not-at-end" };
  }
  if (
    state.hideReason === "cancelled" ||
    state.hideReason === "escape-sequence" ||
    state.hideReason === "paste" ||
    state.hideReason === "tab-completion"
  ) {
    return { eligible: false, reason: state.hideReason };
  }
  return { eligible: true };
}

function applyEscapeToken(
  state: TerminalInputModelState,
  token: EscapeToken,
): TerminalInputModelState {
  const base = {
    ...state,
    hasEscapeBeforeSubmit: true,
    hideReason: "escape-sequence" as const,
  };

  switch (token.action) {
    case "delete":
      return {
        ...deleteRange(base, base.cursor, base.cursor + 1),
        hasEscapeBeforeSubmit: true,
        hideReason: "escape-sequence",
      };
    case "down":
    case "up":
      return {
        ...base,
        synchronized: false,
      };
    case "end":
      return {
        ...base,
        cursor: inputLength(base.command),
      };
    case "home":
      return {
        ...base,
        cursor: 0,
      };
    case "left":
      return {
        ...base,
        cursor: Math.max(0, base.cursor - 1),
      };
    case "right":
      return {
        ...base,
        cursor: Math.min(inputLength(base.command), base.cursor + 1),
      };
    case "word-left":
      return {
        ...base,
        cursor: previousWordBoundary(base.command, base.cursor),
      };
    case "word-right":
      return {
        ...base,
        cursor: nextWordBoundary(base.command, base.cursor),
      };
    case "unknown":
      return {
        ...base,
        synchronized: false,
      };
  }
}

function parseEscapeToken(data: string, start: number): EscapeToken {
  const second = data[start + 1];
  if (!second) {
    return { action: "unknown", length: 1 };
  }

  if (second === "O") {
    const third = data[start + 2];
    const action = third === "H" ? "home" : third === "F" ? "end" : "unknown";
    return { action, length: third ? 3 : 2 };
  }

  if (second !== "[") {
    return { action: "unknown", length: 2 };
  }

  let end = start + 2;
  while (end < data.length && !/[A-Za-z~]/.test(data[end])) {
    end += 1;
  }

  if (end >= data.length) {
    return { action: "unknown", length: data.length - start };
  }

  const final = data[end];
  const params = data.slice(start + 2, end);
  const length = end - start + 1;

  if (params === "1;5" && final === "D") {
    return { action: "word-left", length };
  }
  if (params === "1;5" && final === "C") {
    return { action: "word-right", length };
  }

  if (final === "A") {
    return { action: "up", length };
  }
  if (final === "B") {
    return { action: "down", length };
  }
  if (final === "C") {
    return { action: "right", length };
  }
  if (final === "D") {
    return { action: "left", length };
  }
  if (final === "F") {
    return { action: "end", length };
  }
  if (final === "H") {
    return { action: "home", length };
  }
  if (final === "~") {
    switch (params) {
      case "1":
      case "7":
        return { action: "home", length };
      case "3":
        return { action: "delete", length };
      case "4":
      case "8":
        return { action: "end", length };
    }
  }

  return { action: "unknown", length };
}

function insertText(
  state: TerminalInputModelState,
  text: string,
  hideReason?: TerminalInputHideReason,
): TerminalInputModelState {
  const chars = inputChars(state.command);
  chars.splice(state.cursor, 0, text);

  return {
    ...state,
    command: chars.join(""),
    cursor: state.cursor + 1,
    hasEscapeBeforeSubmit: false,
    hideReason,
    synchronized: state.synchronized,
  };
}

function deletePreviousWord(
  state: TerminalInputModelState,
): TerminalInputModelState {
  return deleteRange(state, previousWordBoundary(state.command, state.cursor), state.cursor);
}

function deleteRange(
  state: TerminalInputModelState,
  start: number,
  end: number,
): TerminalInputModelState {
  const chars = inputChars(state.command);
  const normalizedStart = clamp(start, 0, chars.length);
  const normalizedEnd = clamp(end, normalizedStart, chars.length);
  chars.splice(normalizedStart, normalizedEnd - normalizedStart);

  return {
    ...state,
    command: chars.join(""),
    cursor: normalizedStart,
    hasEscapeBeforeSubmit: false,
  };
}

function previousWordBoundary(command: string, cursor: number) {
  const chars = inputChars(command);
  let index = clamp(cursor, 0, chars.length);

  while (index > 0 && /\s/.test(chars[index - 1])) {
    index -= 1;
  }
  while (index > 0 && !/\s/.test(chars[index - 1])) {
    index -= 1;
  }

  return index;
}

function nextWordBoundary(command: string, cursor: number) {
  const chars = inputChars(command);
  let index = clamp(cursor, 0, chars.length);

  while (index < chars.length && !/\s/.test(chars[index])) {
    index += 1;
  }
  while (index < chars.length && /\s/.test(chars[index])) {
    index += 1;
  }

  return index;
}

function isPasteLikeInput(data: string) {
  let printableCount = 0;
  for (let index = 0; index < data.length; ) {
    const codePoint = data.codePointAt(index);
    if (typeof codePoint !== "number") {
      index += 1;
      continue;
    }
    const text = String.fromCodePoint(codePoint);
    if (codePoint >= 0x20 && codePoint !== 0x7f) {
      printableCount += 1;
    }
    index += text.length;
  }
  return printableCount > 1;
}

function inputLength(value: string) {
  return inputChars(value).length;
}

function inputChars(value: string) {
  return Array.from(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
