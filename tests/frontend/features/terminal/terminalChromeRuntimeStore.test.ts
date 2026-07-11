import { describe, expect, it, vi } from "vitest";
import {
  createTerminalChromeRuntimeStore,
  EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT,
} from "../../../../src/features/terminal/terminalChromeRuntimeStore";

describe("terminalChromeRuntimeStore", () => {
  it("keeps stable empty snapshots and supports subscribe-before-register", () => {
    const store = createTerminalChromeRuntimeStore();
    const listener = vi.fn();
    const firstEmpty = store.getSnapshot("pane-a");
    const unsubscribe = store.subscribe("pane-a", listener);

    expect(firstEmpty).toBe(EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT);
    expect(store.getSnapshot("pane-b")).toBe(firstEmpty);

    store.register("pane-a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot("pane-a").paneId).toBe("pane-a");

    unsubscribe();
    store.update("pane-a", { type: "bell" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies only when a pane snapshot genuinely changes", () => {
    const store = createTerminalChromeRuntimeStore();
    store.register("pane-a");
    const listener = vi.fn();
    store.subscribe("pane-a", listener);

    const initial = store.getSnapshot("pane-a");
    expect(store.update("pane-a", { type: "output" })).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    const unread = store.update("pane-a", {
      type: "visibilityChanged",
      visible: false,
    });
    expect(unread).not.toBe(initial);
    expect(listener).toHaveBeenCalledTimes(1);

    store.update("pane-a", { type: "visibilityChanged", visible: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      expectedPublishes: 0,
      initial: {},
      name: "visible bottom output",
      repeatedEvent: { type: "output" } as const,
    },
    {
      expectedPublishes: 1,
      initial: { visible: false },
      name: "hidden output",
      repeatedEvent: { type: "output" } as const,
    },
    {
      expectedPublishes: 1,
      initial: { atBottom: false },
      name: "scrolled output",
      repeatedEvent: { type: "output" } as const,
    },
    {
      expectedPublishes: 0,
      initial: { bufferType: "alternate" as const },
      name: "alternate output",
      repeatedEvent: { type: "output" } as const,
    },
    {
      expectedPublishes: 1,
      initial: {},
      name: "unacknowledged Bell",
      repeatedEvent: { type: "bell" } as const,
    },
  ])("limits 10,000 $name events to $expectedPublishes publish(es)", ({
    expectedPublishes,
    initial,
    repeatedEvent,
  }) => {
    const store = createTerminalChromeRuntimeStore();
    store.register("pane-a", initial);
    const listener = vi.fn();
    store.subscribe("pane-a", listener);

    for (let index = 0; index < 10_000; index += 1) {
      store.update("pane-a", repeatedEvent);
    }

    expect(listener).toHaveBeenCalledTimes(expectedPublishes);
  });

  it("removes only the active registration and reset publishes once per registered pane", () => {
    const store = createTerminalChromeRuntimeStore();
    const firstDispose = store.register("pane-a", { visible: false });
    const secondDispose = store.register("pane-a");
    store.register("pane-b");
    const paneAListener = vi.fn();
    const paneBListener = vi.fn();
    store.subscribe("pane-a", paneAListener);
    store.subscribe("pane-b", paneBListener);

    firstDispose();
    expect(store.getSnapshot("pane-a").paneId).toBe("pane-a");

    secondDispose();
    expect(store.getSnapshot("pane-a")).toBe(
      EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT,
    );
    expect(paneAListener).toHaveBeenCalledTimes(1);

    store.reset();
    expect(paneAListener).toHaveBeenCalledTimes(1);
    expect(paneBListener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot("pane-b")).toBe(
      EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT,
    );

    store.remove("missing");
    expect(paneBListener).toHaveBeenCalledTimes(1);
  });

  it("does not let an equivalent stale registration dispose the current pane", () => {
    const store = createTerminalChromeRuntimeStore();
    const staleDispose = store.register("pane-a");
    const currentDispose = store.register("pane-a");

    staleDispose();
    expect(store.getSnapshot("pane-a").paneId).toBe("pane-a");

    currentDispose();
    expect(store.getSnapshot("pane-a")).toBe(
      EMPTY_TERMINAL_PANE_CHROME_SNAPSHOT,
    );
  });

  it("publishes a stable aggregate snapshot only on semantic changes", () => {
    const store = createTerminalChromeRuntimeStore();
    const listener = vi.fn();
    store.subscribeAll(listener);
    const empty = store.getSnapshots();

    expect(store.getSnapshots()).toBe(empty);
    store.register("pane-a");
    const registered = store.getSnapshots();
    expect(registered).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    store.update("pane-a", { type: "output" });
    expect(store.getSnapshots()).toBe(registered);
    expect(listener).toHaveBeenCalledTimes(1);

    store.update("pane-a", { type: "bell" });
    expect(store.getSnapshots()).not.toBe(registered);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reports published and suppressed transitions without terminal content", () => {
    const store = createTerminalChromeRuntimeStore();
    store.register("pane-a", { visible: false });

    store.update("pane-a", { type: "output" });
    store.update("pane-a", { type: "output" });
    store.update("missing-pane", { type: "bell" });

    const diagnostics = store.diagnosticsSnapshot();
    expect(diagnostics).toEqual({
      publishedTransitions: 1,
      registeredPanes: 1,
      suppressedTransitions: 2,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("output");
  });
});
