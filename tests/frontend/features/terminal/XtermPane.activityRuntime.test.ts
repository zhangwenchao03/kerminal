import { fireEvent } from "@testing-library/react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createXtermPaneActivityRuntime,
  readTerminalAtBottom,
} from "../../../../src/features/terminal/XtermPane.activityRuntime";
import { terminalChromeRuntimeStore } from "../../../../src/features/terminal/terminalChromeRuntimeStore";

describe("XtermPane.activityRuntime", () => {
  beforeEach(() => {
    terminalChromeRuntimeStore.reset();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    terminalChromeRuntimeStore.reset();
    vi.restoreAllMocks();
  });

  it("publishes only semantic output transitions and suppresses alternate output", () => {
    const harness = createHarness();
    const runtime = createXtermPaneActivityRuntime({
      connectionState: "connected",
      container: harness.container,
      paneId: "pane-a",
      terminal: harness.terminal,
      visible: true,
    });
    const listener = vi.fn();
    terminalChromeRuntimeStore.subscribe("pane-a", listener);

    runtime.markOutput();
    expect(listener).not.toHaveBeenCalled();

    harness.activeBuffer.viewportY = 4;
    harness.activeBuffer.baseY = 8;
    runtime.markScrollPosition();
    runtime.markOutput();
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a").followPaused).toBe(
      true,
    );

    harness.activeBuffer.type = "alternate";
    runtime.markBufferChanged();
    const beforeAlternateOutput =
      terminalChromeRuntimeStore.getSnapshot("pane-a");
    for (let index = 0; index < 10_000; index += 1) {
      runtime.markOutput();
    }
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a")).toBe(
      beforeAlternateOutput,
    );

    runtime.dispose();
  });

  it("tracks hidden unread, parsed Bell, wheel acknowledge and jump-to-bottom", () => {
    const harness = createHarness();
    const runtime = createXtermPaneActivityRuntime({
      connectionState: "connecting",
      container: harness.container,
      paneId: "pane-a",
      terminal: harness.terminal,
      visible: false,
    });

    runtime.markOutput();
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a").unread).toBe(true);

    harness.emitBell();
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a").bell).toBe(true);
    fireEvent.wheel(harness.container);
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a").bell).toBe(false);

    runtime.jumpToBottom();
    expect(harness.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a")).toEqual(
      expect.objectContaining({
        atBottom: true,
        followPaused: false,
        unread: false,
      }),
    );

    runtime.dispose();
    expect(terminalChromeRuntimeStore.getSnapshot("pane-a").paneId).toBe("");
  });

  it("uses xterm viewportY/baseY and normal buffer as the bottom fact", () => {
    const harness = createHarness();
    expect(readTerminalAtBottom(harness.terminal)).toBe(true);

    harness.activeBuffer.baseY = 3;
    expect(readTerminalAtBottom(harness.terminal)).toBe(false);

    harness.activeBuffer.viewportY = 3;
    expect(readTerminalAtBottom(harness.terminal)).toBe(true);

    harness.activeBuffer.type = "alternate";
    expect(readTerminalAtBottom(harness.terminal)).toBe(false);
  });

  it("publishes a distinct reconnecting progress state", () => {
    const harness = createHarness();
    const runtime = createXtermPaneActivityRuntime({
      connectionState: "connected",
      container: harness.container,
      paneId: "pane-a",
      terminal: harness.terminal,
      visible: true,
    });

    runtime.setConnectionState("reconnecting");

    expect(
      terminalChromeRuntimeStore.getSnapshot("pane-a").connectionState,
    ).toBe("reconnecting");
    runtime.dispose();
  });
});

function createHarness() {
  const container = document.createElement("div");
  const activeBuffer = {
    baseY: 0,
    type: "normal" as "normal" | "alternate",
    viewportY: 0,
  };
  let bellListener: (() => void) | undefined;
  const scrollToBottom = vi.fn(() => {
    activeBuffer.viewportY = activeBuffer.baseY;
  });
  const terminal = {
    buffer: { active: activeBuffer },
    onBell(listener: () => void) {
      bellListener = listener;
      return {
        dispose() {
          bellListener = undefined;
        },
      };
    },
    scrollToBottom,
  } as unknown as XtermTerminal;

  return {
    activeBuffer,
    container,
    emitBell: () => bellListener?.(),
    scrollToBottom,
    terminal,
  };
}
