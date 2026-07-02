import { describe, expect, it } from "vitest";
import { createTerminalRuntimeOutputBuffer } from "../../../../src/features/terminal/terminalRuntimeOutputBuffer";

describe("terminalRuntimeOutputBuffer", () => {
  it("preserves output order across chunks until the max tail is reached", () => {
    const buffer = createTerminalRuntimeOutputBuffer({ maxChars: 64 });

    buffer.append("one ");
    buffer.append("two ");
    buffer.append("three");

    expect(buffer.snapshot()).toEqual({
      text: "one two three",
      truncated: false,
    });
    expect(buffer.stats()).toEqual({
      chunkCount: 3,
      maxChars: 64,
      totalChars: 13,
      truncatedChars: 0,
    });
  });

  it("keeps only the newest tail when output exceeds the runtime ring size", () => {
    const buffer = createTerminalRuntimeOutputBuffer({ maxChars: 10 });

    buffer.append("01234");
    buffer.append("56789");
    buffer.append("abc");

    expect(buffer.snapshot()).toEqual({
      text: "3456789abc",
      truncated: true,
    });
    expect(buffer.stats()).toEqual(
      expect.objectContaining({
        totalChars: 10,
        truncatedChars: 3,
      }),
    );
  });

  it("does not split surrogate pairs when trimming the head", () => {
    const buffer = createTerminalRuntimeOutputBuffer({ maxChars: 4 });

    buffer.append("abc😀");
    buffer.append("de");

    expect(buffer.snapshot()).toEqual({
      text: "😀de",
      truncated: true,
    });
  });

  it("returns bounded tails without mutating the stored snapshot", () => {
    const buffer = createTerminalRuntimeOutputBuffer({
      initialOutput: "restored ",
      maxChars: 32,
    });
    buffer.append("live output");

    expect(buffer.tail(6)).toEqual({ text: "output", truncated: true });
    expect(buffer.snapshot()).toEqual({
      text: "restored live output",
      truncated: false,
    });
  });
});
