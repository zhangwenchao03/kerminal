import { describe, expect, it, vi } from "vitest";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  applyTerminalShellIntegrationOsc7,
  collectTerminalShellIntegrationOsc133Segments,
  createTerminalShellIntegrationState,
  parseTerminalShellIntegrationOsc133,
  parseTerminalShellIntegrationCwd,
  reduceTerminalShellIntegrationState,
  type TerminalShellIntegrationState,
} from "./terminalShellIntegrationModel";

describe("terminalShellIntegrationModel", () => {
  it("tracks prompt, typing, running, and alternate buffer modes", () => {
    let state = createTerminalShellIntegrationState({ trusted: true });

    state = reduceTerminalShellIntegrationState(state, {
      data: "echo",
      type: "input",
    });
    expect(state.mode).toBe("typing");

    state = reduceTerminalShellIntegrationState(state, {
      data: "\r",
      type: "input",
    });
    expect(state.mode).toBe("running");

    state = reduceTerminalShellIntegrationState(state, {
      payload: "D;0",
      type: "osc133",
    });
    expect(state.mode).toBe("prompt");

    state = reduceTerminalShellIntegrationState(state, {
      bufferType: "alternate",
      type: "buffer",
    });
    expect(state.mode).toBe("alt");

    state = reduceTerminalShellIntegrationState(state, {
      payload: "C",
      type: "osc133",
    });
    expect(state.mode).toBe("alt");
    expect(state.normalMode).toBe("running");

    state = reduceTerminalShellIntegrationState(state, {
      bufferType: "normal",
      type: "buffer",
    });
    expect(state.mode).toBe("running");

    state = reduceTerminalShellIntegrationState(state, {
      payload: "A",
      type: "osc133",
    });
    expect(state.mode).toBe("prompt");
  });

  it("ignores OSC 7 cwd updates while command output is running", () => {
    let state = createTerminalShellIntegrationState({ trusted: true });
    state = reduceTerminalShellIntegrationState(state, {
      payload: "C",
      type: "osc133",
    });

    expect(
      applyTerminalShellIntegrationOsc7(state, "file://host/tmp/spoof"),
    ).toEqual({ state });

    state = reduceTerminalShellIntegrationState(state, {
      payload: "D;0",
      type: "osc133",
    });
    expect(
      applyTerminalShellIntegrationOsc7(state, "file://host/srv/app"),
    ).toEqual({ cwd: "/srv/app", state });
  });

  it("does not trust shell integration OSC when the session is disabled", () => {
    const state = createTerminalShellIntegrationState({ trusted: false });

    expect(
      applyTerminalShellIntegrationOsc7(state, "file://host/srv/app"),
    ).toEqual({ state });
    expect(
      reduceTerminalShellIntegrationState(state, {
        payload: "C",
        type: "osc133",
      }),
    ).toBe(state);
  });

  it("parses OSC 133 command and exit markers", () => {
    expect(parseTerminalShellIntegrationOsc133("C;echo one;two")).toEqual({
      command: "echo one;two",
      marker: "C",
    });
    expect(
      parseTerminalShellIntegrationOsc133("C;bad\u001bcommand\u0007"),
    ).toEqual({
      command: "bad command",
      marker: "C",
    });
    expect(parseTerminalShellIntegrationOsc133("D;127")).toEqual({
      exitCode: 127,
      marker: "D",
    });
    expect(parseTerminalShellIntegrationOsc133("unknown")).toBeUndefined();
  });

  it("collects split OSC 133 sequences into ordered data and marker segments", () => {
    let collected = collectTerminalShellIntegrationOsc133Segments(
      "",
      "before\u001b]133;C;echo hi",
    );
    expect(collected).toEqual({
      buffer: "\u001b]133;C;echo hi",
      segments: [{ data: "before", type: "data" }],
    });

    collected = collectTerminalShellIntegrationOsc133Segments(
      collected.buffer,
      "\u0007output\u001b]133;D;0\u001b\\after",
    );
    expect(collected).toEqual({
      buffer: "",
      segments: [
        { event: { command: "echo hi", marker: "C" }, type: "osc133" },
        { data: "output", type: "data" },
        { event: { exitCode: 0, marker: "D" }, type: "osc133" },
        { data: "after", type: "data" },
      ],
    });
  });

  it("decodes file URI, Windows, and MSYS cwd payloads", () => {
    expect(parseTerminalShellIntegrationCwd("file://host/srv/app")).toBe(
      "/srv/app",
    );
    expect(parseTerminalShellIntegrationCwd("file://host/srv/my%20app")).toBe(
      "/srv/my app",
    );
    expect(parseTerminalShellIntegrationCwd("file:///C:/Users/dev")).toBe(
      "C:/Users/dev",
    );
    expect(parseTerminalShellIntegrationCwd("/C:/Users/dev")).toBe(
      "C:/Users/dev",
    );
    expect(parseTerminalShellIntegrationCwd("file://host/c/Users/dev")).toBe(
      "C:/Users/dev",
    );
    expect(parseTerminalShellIntegrationCwd("/c/Users/dev")).toBe(
      "C:/Users/dev",
    );
  });

  it("rejects malformed, relative, control-char, and overlong cwd payloads", () => {
    expect(parseTerminalShellIntegrationCwd("relative/path")).toBeUndefined();
    expect(parseTerminalShellIntegrationCwd("file:///%E0%A4%A")).toBeUndefined();
    expect(
      parseTerminalShellIntegrationCwd("file://host/tmp/%00bad"),
    ).toBeUndefined();
    expect(
      parseTerminalShellIntegrationCwd(`/${"x".repeat(4097)}`),
    ).toBeUndefined();
    expect(
      parseTerminalShellIntegrationCwd("file://user:pass@host/tmp"),
    ).toBeUndefined();
  });

  it("lets the xterm OSC parser handle split OSC 7 sequences", async () => {
    installBrowserApiStubs();
    const terminal = new XtermTerminal({ cols: 80, rows: 24 });
    const container = document.createElement("div");
    document.body.append(container);
    terminal.open(container);
    const cwdChanges: string[] = [];
    let state: TerminalShellIntegrationState =
      createTerminalShellIntegrationState({ trusted: true });
    const disposable = terminal.parser.registerOscHandler(7, (payload) => {
      const result = applyTerminalShellIntegrationOsc7(state, payload);
      state = result.state;
      if (result.cwd) {
        cwdChanges.push(result.cwd);
      }
      return true;
    });

    try {
      await writeTerminalData(terminal, "\u001b]7;file://host/srv");
      expect(cwdChanges).toEqual([]);
      await writeTerminalData(terminal, "/app\u0007");
      expect(cwdChanges).toEqual(["/srv/app"]);
    } finally {
      disposable.dispose();
      terminal.dispose();
      container.remove();
      vi.restoreAllMocks();
    }
  });
});

function writeTerminalData(terminal: XtermTerminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function installBrowserApiStubs() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    createCanvasContextStub() as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(16);
}

function createCanvasContextStub() {
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    measureText: vi.fn(() => ({ width: 10 })),
    putImageData: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn(),
  };
}
