const sftpBrowserModes = ["list", "tree", "workspace"] as const;

export type SftpBrowserMode = (typeof sftpBrowserModes)[number];

export function isSftpBrowserMode(value: unknown): value is SftpBrowserMode {
  return (
    typeof value === "string" &&
    (sftpBrowserModes as readonly string[]).includes(value)
  );
}

export function normalizeSftpBrowserMode(value: unknown): SftpBrowserMode {
  return isSftpBrowserMode(value) ? value : "list";
}
