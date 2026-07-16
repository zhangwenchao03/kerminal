import { afterEach, describe, expect, it, vi } from "vitest";

const desktopClipboardApiMock = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMock.writeDesktopClipboardText(...args),
}));

import { COMMAND_BLOCK_OUTPUT_MAX_CHARS, appendCommandBlockOutput, buildTerminalCommandBlockViews, commandBlockColor, createTerminalCommandBlock } from "../../../../src/features/terminal/terminalCommandBlocks";

const originalClipboardItem = globalThis.ClipboardItem;describe("terminalCommandBlocks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    desktopClipboardApiMock.writeDesktopClipboardText.mockReset();
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: originalClipboardItem,
    });
  });

  it("assigns distinct golden-angle colors to neighboring command blocks", () => {
    expect(commandBlockColor(0)).not.toBe(commandBlockColor(1));
    expect(commandBlockColor(1)).not.toBe(commandBlockColor(2));
  });

  it("does not change the latest command block when appending empty output", () => {
    const block = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    block.output = "existing output";

    appendCommandBlockOutput([block], "");

    expect(block.output).toBe("existing output");
  });

  it("appends output to the latest command block", () => {
    const first = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    const second = createTerminalCommandBlock({
      command: "ls",
      id: "block-2",
      index: 1,
      marker: mockMarker(1),
    });
    second.output = "one";

    appendCommandBlockOutput([first, second], "\ntwo");

    expect(first.output).toBe("");
    expect(second.output).toBe("one\ntwo");
  });

  it("does not append prompt output to an empty enter command block", () => {
    const block = createTerminalCommandBlock({
      command: "",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });

    appendCommandBlockOutput([block], "\r\nPS C:\\Users\\24052>");

    expect(block.output).toBe("");
  });

  it("does not append output after the latest command block is closed", () => {
    const block = createTerminalCommandBlock({
      command: "vim file.txt",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.output = "opening vim\r\n";
    block.endMarker = mockMarker(2);

    appendCommandBlockOutput([block], "alternate screen noise");

    expect(block.output).toBe("opening vim\r\n");
  });

  it("keeps the tail of command block output when it exceeds the limit", () => {
    const block = createTerminalCommandBlock({
      command: "npm test",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    block.output = `${"a".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS - 4)}head`;

    appendCommandBlockOutput([block], "tail");

    expect(block.output).toHaveLength(COMMAND_BLOCK_OUTPUT_MAX_CHARS);
    expect(block.output.startsWith("a")).toBe(true);
    expect(block.output).toBe(
      `${"a".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS - 8)}headtail`,
    );
  });

  it("does not split a surrogate pair when trimming command block output", () => {
    const block = createTerminalCommandBlock({
      command: "node unicode.js",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    block.output = `a😀${"b".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS - 1)}`;

    appendCommandBlockOutput([block], "c");

    expect(block.output).toBe(
      `${"b".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS - 1)}c`,
    );
    expect(block.output.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xdc00);
  });

  it("keeps the same trimmed tail when the existing output is already very large", () => {
    const block = createTerminalCommandBlock({
      command: "cargo test",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    block.output =
      "prefix" +
      "a".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS * 3) +
      "middle";

    appendCommandBlockOutput([block], "tail");

    expect(block.output).toBe(
      ("prefix" +
        "a".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS * 3) +
        "middletail").slice(-COMMAND_BLOCK_OUTPUT_MAX_CHARS),
    );
  });

  it("does not split a surrogate pair across the existing output and new data", () => {
    const block = createTerminalCommandBlock({
      command: "node unicode.js",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    const [highSurrogate, lowSurrogate] = Array.from("😀".split(""));
    block.output = `prefix${highSurrogate}`;

    appendCommandBlockOutput(
      [block],
      `${lowSurrogate}${"b".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS - 1)}`,
    );

    expect(block.output).toBe("b".repeat(COMMAND_BLOCK_OUTPUT_MAX_CHARS - 1));
    expect(block.output.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xdc00);
  });

  it("builds visible command block views from marker lines", () => {
    const first = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(2),
    });
    const second = createTerminalCommandBlock({
      command: "ls",
      id: "block-2",
      index: 1,
      marker: mockMarker(6),
    });

    const views = buildTerminalCommandBlockViews([first, second], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(views).toMatchObject([
      {
        command: "pwd",
        endLine: 5,
        height: 72,
        hiddenLineCount: 0,
        startLine: 2,
        top: 36,
      },
      {
        command: "ls",
        endLine: 6,
        height: 18,
        hiddenLineCount: 0,
        startLine: 6,
        top: 108,
      },
    ]);
  });

  it("uses command output length instead of stretching the last block to the buffer bottom", () => {
    const block = createTerminalCommandBlock({
      command: "npm test",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.output = "one\r\ntwo\r\n";

    const [view] = buildTerminalCommandBlockViews([block], {
      activeBufferType: "normal",
      bufferLength: 10,
      cols: 80,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      endLine: 3,
      height: 54,
      lineCount: 3,
    });
  });

  it("aligns the last command block with the terminal content bottom line", () => {
    const block = createTerminalCommandBlock({
      command: "ls",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.output = "zjw/\r\n.zshrc\r\n";

    const [view] = buildTerminalCommandBlockViews([block], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      contentBottomLine: 4,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      endLine: 4,
      height: 72,
      lineCount: 4,
    });
  });

  it("does not let the last command block extend below the last non-empty terminal line", () => {
    const block = createTerminalCommandBlock({
      command: "ls",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.output = "zjw/\r\n.zshrc\r\nubuntu@ubuntu:~$ \r\n\r\n\r\n";

    const [view] = buildTerminalCommandBlockViews([block], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      contentBottomLine: 3,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      endLine: 3,
      height: 54,
      lineCount: 3,
    });
  });

  it("uses a closed command block end marker before content-bottom heuristics", () => {
    const block = createTerminalCommandBlock({
      command: "clear",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.endMarker = mockMarker(2);
    block.output = "\r\n".repeat(40);

    const [view] = buildTerminalCommandBlockViews([block], {
      activeBufferType: "normal",
      bufferLength: 80,
      cols: 80,
      contentBottomLine: 60,
      rowHeight: 18,
      rows: 24,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      endLine: 2,
      height: 36,
      lineCount: 2,
    });
  });

  it("renders the current prompt rail before any command block exists", () => {
    const [view] = buildTerminalCommandBlockViews([], {
      activeBufferType: "normal",
      bufferLength: 24,
      cols: 80,
      promptLine: 4,
      rowHeight: 18,
      rows: 12,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      command: "",
      endLine: 4,
      height: 18,
      id: "current-prompt",
      lineCount: 1,
      startLine: 4,
      virtual: true,
    });
  });

  it("renders an empty enter submission as its own command block", () => {
    const emptyEnterBlock = createTerminalCommandBlock({
      command: "",
      id: "block-1",
      index: 0,
      marker: mockMarker(4),
    });

    const [view] = buildTerminalCommandBlockViews([emptyEnterBlock], {
      activeBufferType: "normal",
      bufferLength: 24,
      cols: 80,
      contentBottomLine: 4,
      promptLine: 4,
      rowHeight: 18,
      rows: 12,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      command: "",
      endLine: 4,
      height: 18,
      id: "block-1",
      lineCount: 1,
      startLine: 4,
    });
    expect(view?.virtual).toBeUndefined();
  });

  it("ends a command block on the line before the next enter submission", () => {
    const lsBlock = createTerminalCommandBlock({
      command: "ls",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    const emptyEnterBlock = createTerminalCommandBlock({
      command: "",
      id: "block-2",
      index: 1,
      marker: mockMarker(4),
    });
    lsBlock.output = "geo-guard kong\r\n";

    const views = buildTerminalCommandBlockViews([lsBlock, emptyEnterBlock], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      contentBottomLine: 4,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(views).toMatchObject([
      {
        command: "ls",
        endLine: 3,
        lineCount: 3,
      },
      {
        command: "",
        endLine: 4,
        lineCount: 1,
      },
    ]);
  });

  it("extends a trailing empty enter block to the latest visible content", () => {
    const emptyEnterBlock = createTerminalCommandBlock({
      command: "",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });

    const [view] = buildTerminalCommandBlockViews([emptyEnterBlock], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      contentBottomLine: 3,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      color: emptyEnterBlock.color,
      command: "",
      endLine: 3,
      lineCount: 3,
      startLine: 1,
    });
  });

  it("keeps the latest empty enter block anchored while extending to the next prompt", () => {
    const lsBlock = createTerminalCommandBlock({
      command: "ls",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    const emptyEnterBlock = createTerminalCommandBlock({
      command: "",
      id: "block-2",
      index: 1,
      marker: mockMarker(3),
    });
    lsBlock.output = "geo-guard kong plugin_config.json\r\n";

    const views = buildTerminalCommandBlockViews([lsBlock, emptyEnterBlock], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      contentBottomLine: 4,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(views).toMatchObject([
      {
        color: lsBlock.color,
        command: "ls",
        endLine: 2,
        startLine: 1,
      },
      {
        color: emptyEnterBlock.color,
        command: "",
        endLine: 4,
        lineCount: 2,
        startLine: 3,
      },
    ]);
    expect(views[1]?.color).not.toBe(views[0]?.color);
  });


});

function mockMarker(line: number) {
  return {
    dispose: vi.fn(),
    isDisposed: false,
    line,
    onDispose: vi.fn(() => ({ dispose: vi.fn() })),
  };
}
