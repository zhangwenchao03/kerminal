import { afterEach, describe, expect, it, vi } from "vitest";

const desktopClipboardApiMock = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMock.writeDesktopClipboardText(...args),
}));

import { buildTerminalCommandBlockViews, copyTerminalCommandBlockAsImage, createTerminalCommandBlock } from "../../../../src/features/terminal/terminalCommandBlocks";

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

  it("hides command block views while a TUI owns the alternate buffer", () => {
    const block = createTerminalCommandBlock({
      command: "vim file.txt",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    block.collapsed = true;

    const views = buildTerminalCommandBlockViews([block], {
      activeBufferType: "alternate",
      bufferLength: 10,
      cols: 80,
      rowHeight: 18,
      rows: 8,
      viewportY: 0,
    });

    expect(views).toEqual([]);
  });

  it("hides command block views while a normal-buffer TUI command is running", () => {
    const claudeBlock = createTerminalCommandBlock({
      command: "claude",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    const promptInsideTui = createTerminalCommandBlock({
      command: "",
      id: "block-2",
      index: 1,
      marker: mockMarker(12),
      submitted: false,
    });

    const views = buildTerminalCommandBlockViews([claudeBlock, promptInsideTui], {
      activeBufferType: "normal",
      bufferLength: 24,
      cols: 80,
      contentBottomLine: 20,
      promptLine: 12,
      rowHeight: 18,
      rows: 12,
      viewportY: 0,
    });

    expect(views).toEqual([]);
  });

  it("hides command block views when typing inside a normal-buffer TUI prompt", () => {
    const codexBlock = createTerminalCommandBlock({
      command: "codex",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    codexBlock.endMarker = mockMarker(10);
    const promptInsideTui = createTerminalCommandBlock({
      command: "nihao",
      id: "block-2",
      index: 1,
      marker: mockMarker(12),
      submitted: false,
    });

    const views = buildTerminalCommandBlockViews([codexBlock, promptInsideTui], {
      activeBufferType: "normal",
      bufferLength: 24,
      cols: 80,
      contentBottomLine: 20,
      promptLine: 12,
      rowHeight: 18,
      rows: 12,
      viewportY: 0,
    });

    expect(views).toEqual([]);
  });

  it("restores command block views after a normal-buffer TUI command exits", () => {
    const claudeBlock = createTerminalCommandBlock({
      command: "claude",
      id: "block-1",
      index: 0,
      marker: mockMarker(1),
    });
    claudeBlock.endMarker = mockMarker(8);

    const views = buildTerminalCommandBlockViews([claudeBlock], {
      activeBufferType: "normal",
      bufferLength: 24,
      cols: 80,
      contentBottomLine: 8,
      promptLine: 10,
      rowHeight: 18,
      rows: 12,
      viewportY: 0,
    });

    expect(views[0]).toMatchObject({
      command: "claude",
      startLine: 1,
    });
    expect(views.length).toBeGreaterThan(0);
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
