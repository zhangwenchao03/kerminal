import { describe, expect, it, vi } from "vitest";
import {
  dispatchKerminalTextEditCommand,
  isEditableTextKeyEventTarget,
  isTerminalKeyEventTarget,
  KERMINAL_TEXT_EDIT_COMMAND_EVENT,
  shouldAppHandleKeybinding,
} from "../../../src/app/appKeybindingPolicy";

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

  it("lets text editing surfaces receive keydown before app keybindings", () => {
    const settingsInput = document.createElement("input");
    const editor = document.createElement("div");
    editor.className = "monaco-editor";

    expect(isTerminalKeyEventTarget(settingsInput)).toBe(false);
    expect(isEditableTextKeyEventTarget(settingsInput)).toBe(true);
    expect(isEditableTextKeyEventTarget(editor)).toBe(true);
    expect(shouldAppHandleKeybinding(keydownFor(settingsInput, "s"))).toBe(
      false,
    );
    expect(shouldAppHandleKeybinding(keydownFor(editor, "s"))).toBe(false);
  });

  it("keeps non-editable app surfaces eligible for global keybindings", () => {
    const button = document.createElement("button");

    expect(isTerminalKeyEventTarget(button)).toBe(false);
    expect(isEditableTextKeyEventTarget(button)).toBe(false);
    expect(shouldAppHandleKeybinding(keydownFor(button, "s"))).toBe(true);
  });

  it("does not handle events that another layer already consumed", () => {
    const button = document.createElement("button");
    const event = keydownFor(button, "s");
    event.preventDefault();

    expect(shouldAppHandleKeybinding(event)).toBe(false);
  });

  it("dispatches text edit commands before falling back to browser editing", () => {
    const handler = vi.fn((event: Event) => {
      const detail = (
        event as CustomEvent<{ command: string; handled: boolean }>
      ).detail;
      detail.handled = true;
    });
    window.addEventListener(KERMINAL_TEXT_EDIT_COMMAND_EVENT, handler);

    expect(dispatchKerminalTextEditCommand("copy")).toBe(true);

    window.removeEventListener(KERMINAL_TEXT_EDIT_COMMAND_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
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
