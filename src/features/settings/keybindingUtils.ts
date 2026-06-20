import type {
  KeybindingPlatform,
  KeybindingSetting,
} from "./settingsModel";

const modifierAliases: Record<string, "alt" | "ctrl" | "meta" | "shift"> = {
  alt: "alt",
  cmd: "meta",
  command: "meta",
  control: "ctrl",
  ctrl: "ctrl",
  meta: "meta",
  option: "alt",
  shift: "shift",
};

export function shortcutPlatform(): KeybindingPlatform {
  if (typeof navigator === "undefined") {
    return "windows";
  }

  const platform = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /\b(Mac|iPhone|iPad|iPod)\b/i.test(platform) ? "mac" : "windows";
}

export function bindingForPlatform(
  keybinding: KeybindingSetting,
  platform: KeybindingPlatform = shortcutPlatform(),
) {
  return platform === "mac"
    ? keybinding.macBinding || keybinding.binding
    : keybinding.windowsBinding || keybinding.binding;
}

export function keybindingMatchesEvent(
  keybinding: KeybindingSetting,
  event: KeyboardEvent,
  platform: KeybindingPlatform = shortcutPlatform(),
) {
  return keyboardEventMatchesBinding(
    event,
    bindingForPlatform(keybinding, platform),
  );
}

export function keyboardEventMatchesBinding(
  event: KeyboardEvent,
  binding: string | undefined,
) {
  const shortcut = parseBinding(binding);
  if (!shortcut || event.repeat || event.isComposing) {
    return false;
  }

  return (
    event.altKey === shortcut.alt &&
    event.ctrlKey === shortcut.ctrl &&
    event.metaKey === shortcut.meta &&
    event.shiftKey === shortcut.shift &&
    normalizedEventKey(event) === shortcut.key
  );
}

function parseBinding(binding: string | undefined) {
  if (!binding) {
    return null;
  }

  const tokens = binding
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const shortcut = {
    alt: false,
    ctrl: false,
    key: "",
    meta: false,
    shift: false,
  };

  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();
    const modifier = modifierAliases[normalizedToken];
    if (modifier) {
      shortcut[modifier] = true;
      continue;
    }

    shortcut.key = normalizeKeyToken(token);
  }

  return shortcut.key ? shortcut : null;
}

function normalizedEventKey(event: KeyboardEvent) {
  if (event.key && event.key !== "Unidentified") {
    return normalizeKeyToken(event.key);
  }
  return normalizeKeyToken(event.code);
}

function normalizeKeyToken(key: string) {
  const normalized = key.trim().toLowerCase();
  if (normalized.startsWith("arrow")) {
    return normalized.replace("arrow", "");
  }
  if (normalized.startsWith("digit")) {
    return normalized.replace("digit", "");
  }
  if (normalized.startsWith("key") && normalized.length === 4) {
    return normalized.slice(3);
  }
  return normalized;
}
