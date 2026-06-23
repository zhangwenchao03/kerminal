import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function parentLocalPath(path: string) {
  const normalized = path.replace(/[\\/]+$/g, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index <= 0 ? normalized : normalized.slice(0, index);
}

export function isLocalCopyShortcut(event: ReactKeyboardEvent<HTMLElement>) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "c"
  );
}

export function isLocalPasteShortcut(event: ReactKeyboardEvent<HTMLElement>) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "v"
  );
}

export function isEditableLocalKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}
