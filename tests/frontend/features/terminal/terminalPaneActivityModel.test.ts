import { describe, expect, it } from "vitest";
import {
  createTerminalPaneActivityState,
  reduceTerminalPaneActivity,
  resolveTerminalPaneAttention,
  type TerminalPaneActivityEvent,
  type TerminalPaneActivityState,
} from "../../../../src/features/terminal/terminalPaneActivityModel";

describe("terminalPaneActivityModel", () => {
  it.each([
    {
      expected: { followPaused: false, unread: false },
      name: "visible active bottom normal output stays quiet",
      state: {},
    },
    {
      expected: { followPaused: true, unread: false },
      name: "visible active scrolled normal output pauses follow",
      state: { atBottom: false },
    },
    {
      expected: { followPaused: false, unread: true },
      name: "hidden normal output becomes unread",
      state: { visible: false },
    },
    {
      expected: { followPaused: false, unread: true },
      name: "background normal output becomes unread",
      state: { applicationActive: false },
    },
    {
      expected: { followPaused: false, unread: false },
      name: "alternate output stays quiet",
      state: { bufferType: "alternate" as const, visible: false },
    },
  ])("$name", ({ expected, state }) => {
    const next = reduceTerminalPaneActivity(
      createTerminalPaneActivityState(state),
      { type: "output" },
    );

    expect(next).toEqual(expect.objectContaining(expected));
  });

  it.each([
    { event: { type: "output" } as const, state: {} },
    {
      event: { type: "output" } as const,
      state: { bufferType: "alternate" as const },
    },
    {
      event: { type: "output" } as const,
      state: { unread: true, visible: false },
    },
    {
      event: { type: "output" } as const,
      state: { atBottom: false, followPaused: true },
    },
    { event: { type: "bell" } as const, state: { bell: true } },
    {
      event: {
        type: "connectionChanged",
        connectionState: "connected",
      } as const,
      state: {},
    },
  ])("returns the same object for unchanged semantics %#", ({ event, state }) => {
    const current = createTerminalPaneActivityState(state);
    expect(reduceTerminalPaneActivity(current, event)).toBe(current);
  });

  it("does not create or clear activity on buffer transitions", () => {
    const unread = createTerminalPaneActivityState({
      atBottom: false,
      followPaused: true,
      unread: true,
    });
    const alternate = reduceTerminalPaneActivity(unread, {
      type: "bufferChanged",
      bufferType: "alternate",
    });
    const normal = reduceTerminalPaneActivity(alternate, {
      type: "bufferChanged",
      bufferType: "normal",
    });

    expect(alternate).toEqual(
      expect.objectContaining({
        bufferType: "alternate",
        followPaused: true,
        unread: true,
      }),
    );
    expect(normal).toEqual(
      expect.objectContaining({
        bufferType: "normal",
        followPaused: true,
        unread: true,
      }),
    );
  });

  it("keeps Bell independent from buffer and clears it only through user interaction", () => {
    let state = createTerminalPaneActivityState({ bufferType: "alternate" });
    state = reduceTerminalPaneActivity(state, { type: "bell" });
    expect(state.bell).toBe(true);

    const repeated = reduceTerminalPaneActivity(state, { type: "bell" });
    expect(repeated).toBe(state);

    for (const event of [
      { type: "userInput" },
      { type: "userScrolled", atBottom: false },
      { type: "acknowledgeBell" },
      { type: "jumpToBottom" },
    ] satisfies TerminalPaneActivityEvent[]) {
      const acknowledged = reduceTerminalPaneActivity(state, event);
      expect(acknowledged.bell).toBe(false);
    }
  });

  it("clears ordinary activity only when observable at bottom or jumping to bottom", () => {
    const unread = createTerminalPaneActivityState({
      applicationActive: false,
      atBottom: false,
      unread: true,
    });
    const visible = reduceSequence(unread, [
      { type: "applicationActivityChanged", applicationActive: true },
      { type: "visibilityChanged", visible: true },
    ]);
    expect(visible.unread).toBe(true);

    const atBottom = reduceTerminalPaneActivity(visible, {
      type: "bottomChanged",
      atBottom: true,
    });
    expect(atBottom.unread).toBe(false);

    const jumped = reduceTerminalPaneActivity(
      createTerminalPaneActivityState({
        applicationActive: false,
        atBottom: false,
        followPaused: true,
        unread: true,
      }),
      { type: "jumpToBottom" },
    );
    expect(jumped).toEqual(
      expect.objectContaining({
        atBottom: true,
        followPaused: false,
        unread: false,
      }),
    );
  });

  it.each([
    ["error", { connectionState: "error", bell: true }, "error"],
    ["closed", { connectionState: "closed", bell: true }, "disconnected"],
    ["warning", { connectionState: "warning", bell: true }, "warning"],
    ["bell", { bell: true, followPaused: true, unread: true }, "bell"],
    ["follow", { atBottom: false, followPaused: true, unread: true }, "followPaused"],
    ["unread", { applicationActive: false, unread: true }, "unread"],
    ["connecting", { connectionState: "connecting" }, "none"],
    ["reconnecting", { connectionState: "reconnecting" }, "none"],
    ["connected", {}, "none"],
  ] as const)("resolves %s attention priority", (_, overrides, expected) => {
    expect(
      resolveTerminalPaneAttention(createTerminalPaneActivityState(overrides)),
    ).toBe(expected);
  });
});

function reduceSequence(
  initialState: TerminalPaneActivityState,
  events: TerminalPaneActivityEvent[],
) {
  return events.reduce(reduceTerminalPaneActivity, initialState);
}
