// @author kongweiguang

import { TERMINAL_OUTPUT_HISTORY_MAX_CHARS } from "../workspace/workspaceSession";

export interface TerminalRuntimeOutputBufferSnapshot {
  text: string | undefined;
  truncated: boolean;
}

export interface TerminalRuntimeOutputBufferStats {
  chunkCount: number;
  maxChars: number;
  totalChars: number;
  truncatedChars: number;
}

export interface TerminalRuntimeOutputBuffer {
  append(data: string): boolean;
  snapshot(): TerminalRuntimeOutputBufferSnapshot;
  stats(): TerminalRuntimeOutputBufferStats;
  tail(maxChars?: number): TerminalRuntimeOutputBufferSnapshot;
}

interface TerminalRuntimeOutputBufferOptions {
  initialOutput?: string;
  maxChars?: number;
}

export function createTerminalRuntimeOutputBuffer({
  initialOutput,
  maxChars = TERMINAL_OUTPUT_HISTORY_MAX_CHARS,
}: TerminalRuntimeOutputBufferOptions = {}): TerminalRuntimeOutputBuffer {
  const resolvedMaxChars = normalizeMaxChars(maxChars);
  const chunks: string[] = [];
  let headIndex = 0;
  let totalChars = 0;
  let truncatedChars = 0;

  const compactChunks = () => {
    if (headIndex === 0) {
      return;
    }
    if (headIndex >= chunks.length) {
      chunks.length = 0;
      headIndex = 0;
      return;
    }
    if (headIndex >= 128 && headIndex * 2 >= chunks.length) {
      chunks.splice(0, headIndex);
      headIndex = 0;
    }
  };

  const trimOverflow = () => {
    let overflow = totalChars - resolvedMaxChars;
    while (overflow > 0 && headIndex < chunks.length) {
      const head = chunks[headIndex] ?? "";
      if (head.length <= overflow) {
        totalChars -= head.length;
        truncatedChars += head.length;
        overflow -= head.length;
        headIndex += 1;
        continue;
      }

      const trimAt = nextSafeSliceStart(head, overflow);
      chunks[headIndex] = head.slice(trimAt);
      totalChars -= trimAt;
      truncatedChars += trimAt;
      overflow -= trimAt;
    }
    compactChunks();
  };

  const append = (data: string) => {
    if (!data) {
      return false;
    }
    chunks.push(data);
    totalChars += data.length;
    trimOverflow();
    return true;
  };

  const snapshotText = () => {
    if (totalChars <= 0) {
      return undefined;
    }
    return chunks.slice(headIndex).join("");
  };

  const buffer: TerminalRuntimeOutputBuffer = {
    append,
    snapshot() {
      return {
        text: snapshotText(),
        truncated: truncatedChars > 0,
      };
    },
    stats() {
      return {
        chunkCount: chunks.length - headIndex,
        maxChars: resolvedMaxChars,
        totalChars,
        truncatedChars,
      };
    },
    tail(maxTailChars = resolvedMaxChars) {
      const text = snapshotText();
      if (!text) {
        return { text: undefined, truncated: false };
      }
      const resolvedMaxTailChars = normalizeMaxChars(maxTailChars);
      if (text.length <= resolvedMaxTailChars) {
        return { text, truncated: truncatedChars > 0 };
      }
      const start = nextSafeSliceStart(
        text,
        text.length - resolvedMaxTailChars,
      );
      return {
        text: text.slice(start),
        truncated: true,
      };
    },
  };

  append(initialOutput ?? "");
  return buffer;
}

function normalizeMaxChars(maxChars: number) {
  return Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : 1;
}

function nextSafeSliceStart(text: string, minIndex: number) {
  const start = Math.min(Math.max(0, Math.floor(minIndex)), text.length);
  if (start <= 0 || start >= text.length) {
    return start;
  }

  const previousCodeUnit = text.charCodeAt(start - 1);
  const currentCodeUnit = text.charCodeAt(start);
  const splitsSurrogatePair =
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    currentCodeUnit >= 0xdc00 &&
    currentCodeUnit <= 0xdfff;
  return splitsSurrogatePair ? start + 1 : start;
}
