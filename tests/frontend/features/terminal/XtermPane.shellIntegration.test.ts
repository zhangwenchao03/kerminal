import { describe, expect, it, vi } from "vitest";
import { installShellIntegrationOscHandlers } from "../../../../src/features/terminal/XtermPane.shellIntegration";
import { createTerminalShellIntegrationState } from "../../../../src/features/terminal/terminalShellIntegrationModel";

type OscHandler = (payload: string) => boolean;

function createParserHarness() {
  const handlers = new Map<number, OscHandler>();
  const terminal = {
    parser: {
      registerOscHandler: vi.fn((identifier: number, handler: OscHandler) => {
        handlers.set(identifier, handler);
        return {
          dispose: vi.fn(() => handlers.delete(identifier)),
        };
      }),
    },
  };

  return { handlers, terminal };
}

describe("XtermPane shell integration OSC handlers", () => {
  it("does not throw when OSC 7 callbacks reject binary-like payloads", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handlers, terminal } = createParserHarness();

    installShellIntegrationOscHandlers(terminal as never, {
      onCurrentCwd: () => {
        throw new Error("cwd callback failed");
      },
      readState: () => createTerminalShellIntegrationState({ trusted: true }),
      reduceState: vi.fn(),
      writeState: vi.fn(),
    });

    expect(() => handlers.get(7)?.("file:///tmp/\u0000bad")).not.toThrow();
    expect(handlers.get(7)?.("file:///tmp/good")).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "terminal OSC 7 handler failed",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });

  it("does not throw when OSC 133 command block callbacks fail", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handlers, terminal } = createParserHarness();

    installShellIntegrationOscHandlers(terminal as never, {
      onCurrentCwd: vi.fn(),
      onOsc133: () => {
        throw new Error("command block callback failed");
      },
      readState: () => createTerminalShellIntegrationState({ trusted: true }),
      reduceState: vi.fn(),
      writeState: vi.fn(),
    });

    expect(() => handlers.get(133)?.("C;cat binary")).not.toThrow();
    expect(handlers.get(133)?.("C;cat binary")).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "terminal OSC 133 handler failed",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
