import { describe, expect, it, vi } from "vitest";
import { buildTerminalEmptyStateActions } from "./terminalEmptyStateModel";

describe("buildTerminalEmptyStateActions", () => {
  it("returns no actions when the empty workspace has no available handlers", () => {
    expect(buildTerminalEmptyStateActions({})).toEqual([]);
  });

  it("returns no actions when workspace handlers are available", () => {
    const onCreateTerminal = vi.fn();
    const onOpenConnection = vi.fn();
    const onOpenAiTool = vi.fn();

    expect(
      buildTerminalEmptyStateActions({
        onCreateTerminal,
        onOpenAiTool,
        onOpenConnection,
      }),
    ).toEqual([]);

    expect(onCreateTerminal).not.toHaveBeenCalled();
    expect(onOpenConnection).not.toHaveBeenCalled();
    expect(onOpenAiTool).not.toHaveBeenCalled();
  });
});
