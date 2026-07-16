import { describe, expect, it, vi } from "vitest";
import {
  acquireTerminalDocumentActivity,
  createTerminalDocumentActivity,
  type TerminalDocumentActivityAdapter,
  type TerminalDocumentActivityEventType,
} from "../../../../src/features/terminal/terminalDocumentActivity";

class FakeDocumentActivityAdapter
  implements TerminalDocumentActivityAdapter
{
  focused = true;
  visible = true;

  private readonly listeners = new Map<
    TerminalDocumentActivityEventType,
    Set<() => void>
  >();

  addEventListener = vi.fn(
    (type: TerminalDocumentActivityEventType, listener: () => void) => {
      let eventListeners = this.listeners.get(type);
      if (!eventListeners) {
        eventListeners = new Set();
        this.listeners.set(type, eventListeners);
      }
      eventListeners.add(listener);
    },
  );

  hasFocus = () => this.focused;
  isVisible = () => this.visible;

  removeEventListener = vi.fn(
    (type: TerminalDocumentActivityEventType, listener: () => void) => {
      this.listeners.get(type)?.delete(listener);
    },
  );

  emit(type: TerminalDocumentActivityEventType) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

describe("terminalDocumentActivity", () => {
  it("derives application activity from focus and visibility facts", () => {
    const adapter = new FakeDocumentActivityAdapter();
    const activity = createTerminalDocumentActivity(adapter);
    const listener = vi.fn();
    activity.subscribe(listener);

    expect(activity.getSnapshot()).toBe(true);

    adapter.focused = false;
    adapter.emit("blur");
    expect(activity.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    adapter.visible = false;
    adapter.emit("visibilitychange");
    expect(activity.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    adapter.focused = true;
    adapter.emit("focus");
    expect(activity.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    adapter.visible = true;
    adapter.emit("visibilitychange");
    expect(activity.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("registers each lifecycle listener once and removes it on idempotent dispose", () => {
    const adapter = new FakeDocumentActivityAdapter();
    const activity = createTerminalDocumentActivity(adapter);
    const listener = vi.fn();
    activity.subscribe(listener);

    expect(adapter.addEventListener.mock.calls.map(([type]) => type)).toEqual([
      "focus",
      "blur",
      "visibilitychange",
    ]);

    activity.dispose();
    activity.dispose();

    expect(adapter.removeEventListener.mock.calls.map(([type]) => type)).toEqual(
      ["focus", "blur", "visibilitychange"],
    );

    adapter.focused = false;
    adapter.emit("blur");
    expect(activity.getSnapshot()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(activity.subscribe(listener)()).toBeUndefined();
  });

  it("shares one lifecycle across pane leases and supports idempotent release", () => {
    const first = acquireTerminalDocumentActivity();
    const second = acquireTerminalDocumentActivity();

    expect(second.activity).toBe(first.activity);
    first.release();
    first.release();
    expect(second.activity.getSnapshot()).toBeTypeOf("boolean");
    second.release();

    const next = acquireTerminalDocumentActivity();
    expect(next.activity).not.toBe(first.activity);
    next.release();
  });
});
