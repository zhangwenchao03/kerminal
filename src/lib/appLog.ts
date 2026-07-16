import { isTauri } from "@tauri-apps/api/core";
import type { LogOptions } from "@tauri-apps/plugin-log";

export type AppLogLevel = "debug" | "error" | "info" | "warn";

export interface AppLogEntry {
  category: string;
  error?: unknown;
  keyValues?: Record<string, unknown>;
  message: string;
}

export interface AppLogTransport {
  debug: (message: string, options?: LogOptions) => Promise<void>;
  error: (message: string, options?: LogOptions) => Promise<void>;
  info: (message: string, options?: LogOptions) => Promise<void>;
  warn: (message: string, options?: LogOptions) => Promise<void>;
}

export interface AppLogWriteOptions {
  enableDebug?: boolean;
  transport?: AppLogTransport;
}

export interface AppLogWriteResult {
  keyValues?: Record<string, string | undefined>;
  level: AppLogLevel;
  message: string;
  skippedReason?: "debug-disabled" | "not-tauri" | "transport-error";
  written: boolean;
}

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|api[_-]?key|secret|private[_-]?key|credential)/i;
const PATH_KEY_PATTERN = /(path|cwd|directory|file)/i;
const COMMAND_KEY_PATTERN =
  /(^|[_-])(command|command_line|cmdline|args|argv|prompt|environment|env)($|[_-])/i;

export async function writeAppLog(
  level: AppLogLevel,
  entry: AppLogEntry,
  options: AppLogWriteOptions = {},
): Promise<AppLogWriteResult> {
  const normalized = normalizeLogEntry(level, entry);
  if (level === "debug" && !options.enableDebug) {
    return {
      ...normalized,
      skippedReason: "debug-disabled",
      written: false,
    };
  }

  const transport = options.transport ?? (await loadTauriLogTransport());
  if (!transport) {
    return {
      ...normalized,
      skippedReason: "not-tauri",
      written: false,
    };
  }

  try {
    await transport[level](normalized.message, {
      keyValues: normalized.keyValues,
    });
    return {
      ...normalized,
      written: true,
    };
  } catch {
    return {
      ...normalized,
      skippedReason: "transport-error",
      written: false,
    };
  }
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[redacted-private-key]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-token]")
    .replace(
      /\b(password|passwd|token|api[_-]?key|secret)\s*[:=]\s*[^,\s;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+\\[^\s,;]+/g, "[local-path]")
    .replace(/\b(?:\/Users|\/home)\/[^/\s]+\/[^\s,;]+/g, "[local-path]");
}

function redactLogKeyValues(
  keyValues: Record<string, unknown> = {},
): Record<string, string | undefined> {
  const redacted: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(keyValues)) {
    if (value === undefined || value === null) {
      redacted[key] = undefined;
      continue;
    }

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    if (COMMAND_KEY_PATTERN.test(normalizeLogKey(key))) {
      redacted[key] = "[redacted-command]";
      continue;
    }

    const stringValue = stringifyLogValue(value);
    redacted[key] = PATH_KEY_PATTERN.test(key)
      ? summarizePathValue(stringValue)
      : redactSensitiveText(stringValue);
  }

  return redacted;
}

function normalizeLogKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function normalizeLogEntry(level: AppLogLevel, entry: AppLogEntry) {
  const keyValues = redactLogKeyValues({
    ...entry.keyValues,
    category: entry.category,
    error: entry.error ? errorToLogString(entry.error) : undefined,
  });
  return {
    keyValues,
    level,
    message: `[${redactSensitiveText(entry.category)}] ${redactSensitiveText(
      entry.message,
    )}`,
  };
}

async function loadTauriLogTransport(): Promise<AppLogTransport | null> {
  if (!isTauri()) {
    return null;
  }

  const plugin = await import("@tauri-apps/plugin-log");
  return {
    debug: plugin.debug,
    error: plugin.error,
    info: plugin.info,
    warn: plugin.warn,
  };
}

function errorToLogString(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return stringifyLogValue(error);
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizePathValue(value: string): string {
  const normalized = redactSensitiveText(value);
  if (normalized.includes("[local-path]")) {
    return normalized;
  }

  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.length <= 1) {
    return normalized;
  }

  return `.../${segments[segments.length - 1]}`;
}
