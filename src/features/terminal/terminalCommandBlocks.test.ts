import { afterEach, describe, expect, it, vi } from "vitest";

const desktopClipboardApiMock = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMock.writeDesktopClipboardText(...args),
}));

import {
  COMMAND_BLOCK_OUTPUT_MAX_CHARS,
  appendCommandBlockOutput,
  buildTerminalCommandBlockViews,
  commandBlockColor,
  copyTerminalCommandBlockAsImage,
  createTerminalCommandBlock,
} from "./terminalCommandBlocks";

const originalClipboardItem = globalThis.ClipboardItem;
const originalCreateElement = document.createElement.bind(document);

describe("terminalCommandBlocks", () => {
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

  it("renders the current prompt rail after an open command block", () => {
    const lsBlock = createTerminalCommandBlock({
      command: "ls",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    lsBlock.output = "geo-guard kong plugin_config.json\r\n";

    const views = buildTerminalCommandBlockViews([lsBlock], {
      activeBufferType: "normal",
      bufferLength: 12,
      cols: 80,
      contentBottomLine: 3,
      promptLine: 3,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(views).toMatchObject([
      {
        color: lsBlock.color,
        command: "ls",
        endLine: 2,
        lineCount: 2,
        startLine: 1,
      },
      {
        command: "",
        current: true,
        endLine: 3,
        lineCount: 1,
        startLine: 3,
        virtual: true,
      },
    ]);
    expect(views).toHaveLength(2);
    expect(views[0]?.virtual).toBeUndefined();
  });

  it("collapses a command block to one row and shifts following blocks upward", () => {
    const first = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    const second = createTerminalCommandBlock({
      command: "ls",
      id: "block-2",
      index: 1,
      marker: mockMarker(6),
    });
    first.collapsed = true;

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
        collapsed: true,
        height: 18,
        hiddenLineCount: 4,
        lineCount: 5,
        top: 18,
      },
      {
        command: "ls",
        height: 18,
        top: 36,
      },
    ]);
  });

  it("keeps collapsed command blocks muted in alternate screen without folding rows", () => {
    const block = createTerminalCommandBlock({
      command: "vim file.txt",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.collapsed = true;

    const [view] = buildTerminalCommandBlockViews([block], {
      activeBufferType: "alternate",
      bufferLength: 10,
      cols: 80,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(view).toMatchObject({
      collapsed: true,
      height: 18,
      hiddenLineCount: 0,
      muted: true,
    });
  });

  it("copies a command block as a PNG clipboard item when supported", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: clipboardWrite,
        writeText: vi.fn(),
      },
    });

    const clipboardItems: Array<Record<string, Blob>> = [];
    class MockClipboardItem {
      constructor(items: Record<string, Blob>) {
        clipboardItems.push(items);
      }
    }
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: MockClipboardItem,
    });

    const fakeContext = {
      beginPath: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      scale: vi.fn(),
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textBaseline(_value: string) {},
    };
    const fakeCanvas = {
      getContext: vi.fn(() => fakeContext),
      height: 0,
      style: {},
      toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
        callback(new Blob(["png"], { type: "image/png" }));
      }),
      width: 0,
    };
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return fakeCanvas as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName);
    });

    const block = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    block.output = "C:/dev/rust/kerminal\r\n";

    await expect(copyTerminalCommandBlockAsImage(block, "dark")).resolves.toBe(
      "image",
    );
    expect(clipboardItems[0]["image/png"].type).toBe("image/png");
    expect(clipboardWrite).toHaveBeenCalledWith([
      expect.any(MockClipboardItem),
    ]);
    expect(
      desktopClipboardApiMock.writeDesktopClipboardText,
    ).not.toHaveBeenCalled();
  });

  it("copies command block text through the desktop clipboard facade when image copy is unavailable", async () => {
    desktopClipboardApiMock.writeDesktopClipboardText.mockResolvedValue({
      ok: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: undefined,
    });

    const block = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });
    block.output = "C:/dev/rust/kerminal\r\n";

    await expect(copyTerminalCommandBlockAsImage(block, "dark")).resolves.toBe(
      "text",
    );
    expect(desktopClipboardApiMock.writeDesktopClipboardText).toHaveBeenCalledWith(
      "$ pwd\nC:/dev/rust/kerminal",
    );
  });

  it("reports clipboard unavailability when command block text fallback fails", async () => {
    desktopClipboardApiMock.writeDesktopClipboardText.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: undefined,
    });

    const block = createTerminalCommandBlock({
      command: "pwd",
      id: "block-1",
      index: 0,
      marker: mockMarker(0),
    });

    await expect(copyTerminalCommandBlockAsImage(block, "dark")).rejects.toThrow(
      "当前环境不支持复制到剪贴板。",
    );
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
