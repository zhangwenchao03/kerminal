const TERMINAL_KEY_EVENT_TARGET_SELECTOR =
  "[data-kerminal-terminal-input], .xterm, .xterm-helper-textarea, .xterm-screen";

export function shouldAppHandleKeybinding(event: KeyboardEvent) {
  if (event.defaultPrevented) {
    return false;
  }

  return !isTerminalKeyEventTarget(event.target);
}

export function isTerminalKeyEventTarget(target: EventTarget | null) {
  const element = eventTargetElement(target);
  if (!element) {
    return false;
  }

  return Boolean(element.closest(TERMINAL_KEY_EVENT_TARGET_SELECTOR));
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
