import { describe, expect, it } from "vitest";
import {
  isTerminalKeyEventTarget,
  shouldAppHandleKeybinding,
} from "./appKeybindingPolicy";

describe("appKeybindingPolicy", () => {
  it("lets focused xterm DOM receive keydown before app keybindings", () => {
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const textarea = document.createElement("textarea");
    textarea.className = "xterm-helper-textarea";
    terminal.append(textarea);

    expect(isTerminalKeyEventTarget(textarea)).toBe(true);
    expect(shouldAppHandleKeybinding(keydownFor(textarea, "Enter"))).toBe(false);
  });

  it("supports explicit terminal input markers outside xterm internals", () => {
    const customInput = document.createElement("div");
    customInput.dataset.kerminalTerminalInput = "true";

    expect(isTerminalKeyEventTarget(customInput)).toBe(true);
    expect(shouldAppHandleKeybinding(keydownFor(customInput, "j"))).toBe(false);
  });

  it("keeps non-terminal app surfaces eligible for global keybindings", () => {
    const settingsInput = document.createElement("input");

    expect(isTerminalKeyEventTarget(settingsInput)).toBe(false);
    expect(shouldAppHandleKeybinding(keydownFor(settingsInput, "s"))).toBe(true);
  });

  it("does not handle events that another layer already consumed", () => {
    const button = document.createElement("button");
    const event = keydownFor(button, "s");
    event.preventDefault();

    expect(shouldAppHandleKeybinding(event)).toBe(false);
  });
});

function keydownFor(target: Element, key: string) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  Object.defineProperty(event, "target", {
    configurable: true,
    value: target,
  });
  return event;
}
