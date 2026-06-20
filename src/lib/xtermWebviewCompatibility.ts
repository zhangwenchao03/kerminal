const xtermNamespaceInitializerPattern =
  /\}\)\(([A-Za-z_$][\w$]*)\|\|=\{\}\);/g;

export function prepareXtermWebviewCompatibility() {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "toString",
  );

  if (
    !descriptor ||
    typeof descriptor.value !== "function" ||
    descriptor.writable !== false
  ) {
    return;
  }

  try {
    Object.defineProperty(Object.prototype, "toString", {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      value: descriptor.value,
      writable: true,
    });
  } catch {
    // Tauri's freezePrototype makes this descriptor non-configurable. Keep
    // freezePrototype disabled while xterm's namespace initialization assigns
    // to a fresh object's inherited toString property.
  }
}

export function patchXtermWebviewNamespace(code: string) {
  return code.replace(
    xtermNamespaceInitializerPattern,
    "})($1 ||= Object.create(null));",
  );
}
