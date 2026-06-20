import { describe, expect, it } from "vitest";
import { defaultKeybindings } from "./settingsModel";
import {
  bindingForPlatform,
  keyboardEventMatchesBinding,
  keybindingMatchesEvent,
} from "./keybindingUtils";

describe("keybindingUtils", () => {
  it("returns platform-specific shortcut strings", () => {
    const settingsKeybinding = defaultKeybindings.find(
      (keybinding) => keybinding.action === "settings.open",
    );

    expect(settingsKeybinding).toBeDefined();
    expect(bindingForPlatform(settingsKeybinding!, "windows")).toBe(
      "Ctrl+Alt+S",
    );
    expect(bindingForPlatform(settingsKeybinding!, "mac")).toBe("Cmd+,");
  });

  it("matches Windows-style shortcuts against keyboard events", () => {
    const event = new KeyboardEvent("keydown", {
      altKey: true,
      ctrlKey: true,
      key: "s",
    });

    expect(keyboardEventMatchesBinding(event, "Ctrl+Alt+S")).toBe(true);
    expect(keyboardEventMatchesBinding(event, "Ctrl+Shift+S")).toBe(false);
  });

  it("matches macOS command and option aliases", () => {
    const settingsKeybinding = defaultKeybindings.find(
      (keybinding) => keybinding.action === "settings.open",
    );
    const terminalKeybinding = defaultKeybindings.find(
      (keybinding) => keybinding.action === "terminal.focus",
    );
    const commandEvent = new KeyboardEvent("keydown", {
      key: ",",
      metaKey: true,
    });
    const optionEvent = new KeyboardEvent("keydown", {
      altKey: true,
      key: "F12",
    });

    expect(keybindingMatchesEvent(settingsKeybinding!, commandEvent, "mac")).toBe(
      true,
    );
    expect(keybindingMatchesEvent(terminalKeybinding!, optionEvent, "mac")).toBe(
      true,
    );
  });

  it("normalizes arrow key names", () => {
    const event = new KeyboardEvent("keydown", {
      altKey: true,
      key: "ArrowRight",
    });

    expect(keyboardEventMatchesBinding(event, "Alt+Right")).toBe(true);
  });
});
