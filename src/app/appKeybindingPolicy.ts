const TERMINAL_KEY_EVENT_TARGET_SELECTOR =
  "[data-kerminal-terminal-input], .xterm, .xterm-helper-textarea, .xterm-screen";
const EDITABLE_TEXT_KEY_EVENT_TARGET_SELECTOR =
  "textarea, input, [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox'], .monaco-editor, .monaco-editor textarea, [data-kerminal-text-editor]";

export const KERMINAL_TEXT_EDIT_COMMAND_EVENT =
  "kerminal://text-edit-command";

export type KerminalTextEditCommand =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll";

export interface KerminalTextEditCommandEventDetail {
  command: KerminalTextEditCommand;
  handled: boolean;
}

export function shouldAppHandleKeybinding(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return false;
  }

  return (
    !isTerminalKeyEventTarget(event.target) &&
    !isEditableTextKeyEventTarget(event.target)
  );
}

export function isTerminalKeyEventTarget(target: EventTarget | null) {
  const element = eventTargetElement(target);
  if (!element) {
    return false;
  }

  return Boolean(element.closest(TERMINAL_KEY_EVENT_TARGET_SELECTOR));
}

export function isEditableTextKeyEventTarget(target: EventTarget | null) {
  const element = eventTargetElement(target);
  if (!element) {
    return false;
  }

  if (element instanceof HTMLInputElement) {
    return isEditableInputElement(element);
  }

  const editable = element.closest(EDITABLE_TEXT_KEY_EVENT_TARGET_SELECTOR);
  if (editable instanceof HTMLInputElement) {
    return isEditableInputElement(editable);
  }

  return Boolean(editable);
}

export function dispatchKerminalTextEditCommand(
  command: KerminalTextEditCommand,
) {
  const detail: KerminalTextEditCommandEventDetail = {
    command,
    handled: false,
  };
  window.dispatchEvent(
    new CustomEvent<KerminalTextEditCommandEventDetail>(
      KERMINAL_TEXT_EDIT_COMMAND_EVENT,
      { detail },
    ),
  );
  if (detail.handled) {
    return true;
  }

  return runBrowserTextEditCommand(command);
}

function runBrowserTextEditCommand(command: KerminalTextEditCommand) {
  const activeElement = document.activeElement;
  if (
    isTerminalKeyEventTarget(activeElement) ||
    !isEditableTextKeyEventTarget(activeElement)
  ) {
    return false;
  }

  if (activeElement instanceof HTMLElement) {
    activeElement.focus();
  }

  if (typeof document.execCommand !== "function") {
    return false;
  }

  return document.execCommand(browserEditCommandFor(command));
}

function browserEditCommandFor(command: KerminalTextEditCommand) {
  if (command === "selectAll") {
    return "selectAll";
  }
  return command;
}

function isEditableInputElement(input: HTMLInputElement) {
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(input.type);
}

function eventTargetElement(target: EventTarget | null) {
  if (typeof Element !== "undefined" && target instanceof Element) {
    return target;
  }
  if (typeof Node !== "undefined" && target instanceof Node) {
    return target.parentElement;
  }
  return null;
}
