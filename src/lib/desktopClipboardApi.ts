import { isTauri } from "@tauri-apps/api/core";

interface DesktopClipboardTextTransport {
  readText: () => Promise<string | null>;
  writeText: (text: string) => Promise<void>;
}

export interface DesktopClipboardTextOptions {
  retryDelaysMs?: readonly number[];
  transport?: DesktopClipboardTextTransport;
  wait?: (delayMs: number) => Promise<void>;
}

export type DesktopClipboardWriteTextResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: "transport-error" | "unavailable";
    };

const DEFAULT_CLIPBOARD_RETRY_DELAYS_MS = [50, 100, 200, 400] as const;

export async function readDesktopClipboardText(
  options: DesktopClipboardTextOptions = {},
): Promise<string> {
  const transport = options.transport ?? (await loadDesktopClipboardTransport());
  if (!transport) {
    return "";
  }

  try {
    return (
      (await withClipboardRetries(
        () => transport.readText(),
        options.retryDelaysMs,
        options.wait,
      )) ?? ""
    );
  } catch {
    return "";
  }
}

export async function writeDesktopClipboardText(
  text: string,
  options: DesktopClipboardTextOptions = {},
): Promise<DesktopClipboardWriteTextResult> {
  const transport = options.transport ?? (await loadDesktopClipboardTransport());
  if (!transport) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    await withClipboardRetries(
      () => transport.writeText(text),
      options.retryDelaysMs,
      options.wait,
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "transport-error" };
  }
}

async function loadDesktopClipboardTransport(): Promise<DesktopClipboardTextTransport | null> {
  if (isTauri()) {
    const plugin = await import("@tauri-apps/plugin-clipboard-manager");
    return {
      readText: plugin.readText,
      writeText: plugin.writeText,
    };
  }

  const browserClipboard = globalThis.navigator?.clipboard;
  if (!browserClipboard?.readText || !browserClipboard?.writeText) {
    return null;
  }

  return {
    readText: async () => (await browserClipboard.readText()) ?? "",
    writeText: async (text: string) => {
      await browserClipboard.writeText(text);
    },
  };
}

async function withClipboardRetries<T>(
  operation: () => Promise<T>,
  retryDelaysMs: readonly number[] = DEFAULT_CLIPBOARD_RETRY_DELAYS_MS,
  wait: (delayMs: number) => Promise<void> = delay,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined) {
        break;
      }
      await wait(delayMs);
    }
  }
  throw lastError;
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}
