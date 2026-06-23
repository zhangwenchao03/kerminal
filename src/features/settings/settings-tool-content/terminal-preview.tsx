import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  terminalColorSchemeForTheme,
  terminalColorSchemeOptions,
  terminalFontOptions,
  terminalFontWeightValue,
  type ResolvedTheme,
  type TerminalAppearance,
  type TerminalColorScheme,
  type TerminalCursorStyle,
} from "../settingsModel";
import { xtermThemeFor } from "../terminalTheme";

function terminalSchemeButtonClassName(selected: boolean) {
  return cn(
    "kerminal-focus-ring kerminal-pressable min-h-20 rounded-xl border px-3 py-2.5 text-left transition",
    selected
      ? "border-sky-500/45 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 dark:border-sky-300/35 dark:text-sky-100 dark:ring-sky-300/15"
      : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
  );
}

export function TerminalSchemePicker({
  label,
  onSelect,
  value,
}: {
  label: string;
  onSelect: (value: TerminalColorScheme) => void;
  value: TerminalColorScheme;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {terminalColorSchemeOptions.map((option) => {
          const selected = value === option.value;
          return (
            <button
              aria-pressed={selected}
              className={terminalSchemeButtonClassName(selected)}
              key={option.value}
              onClick={() => onSelect(option.value)}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex overflow-hidden rounded-full border border-[var(--border-subtle)]"
                  >
                    {option.colors.map((color) => (
                      <span
                        className="h-4 w-4"
                        key={color}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white dark:bg-sky-300 dark:text-zinc-950"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="mt-1 block text-xs leading-5 opacity-80">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TerminalAppearancePreview({
  resolvedTheme,
  terminal,
}: {
  resolvedTheme: ResolvedTheme;
  terminal: TerminalAppearance;
}) {
  const theme = xtermThemeFor(
    resolvedTheme,
    terminalColorSchemeForTheme(terminal, resolvedTheme),
  );
  const fontLabel = terminalFontLabelFor(terminal.fontFamily);
  const previewCodeStyle = {
    fontFamily: terminal.fontFamily,
    fontSize: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
  } satisfies CSSProperties;

  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        字体预览
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.04)] px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-sm text-zinc-800 dark:text-zinc-100"
          style={{
            fontFamily: terminal.fontFamily,
            fontWeight: terminalFontWeightValue(terminal.fontWeight),
          }}
        >
          Aa
        </span>
        <span className="min-w-0">
          <span className="block truncate">当前预览</span>
          <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {fontLabel}
          </span>
        </span>
      </div>
      <pre
        aria-label="终端字体预览"
        className="mt-2 overflow-hidden rounded-xl border border-[var(--border-subtle)] p-3 text-left shadow-inner"
        data-font-family={terminal.fontFamily}
        data-font-label={fontLabel}
        key={terminal.fontFamily}
        style={{
          backgroundColor: theme.background,
          color: theme.foreground,
          fontFamily: terminal.fontFamily,
          fontSize: terminal.fontSize,
          fontWeight: terminalFontWeightValue(terminal.fontWeight),
          lineHeight: terminal.lineHeight,
        }}
      >
        <code className="block" style={previewCodeStyle}>
          font: {fontLabel}
        </code>
        <code className="block" style={previewCodeStyle}>
          abcdefghijklmnopqrstuvwxyz
        </code>
        <code className="block" style={previewCodeStyle}>
          0123456789 !@#$%^&*()[]{}&lt;&gt;
        </code>
        <code className="block" style={previewCodeStyle}>
          中文路径 /var/log/应用 日志输出
        </code>
        <code
          className="block"
          style={{ ...previewCodeStyle, color: theme.green }}
        >
          $ ssh root@server.example.com
        </code>
        <code
          className="block"
          style={{ ...previewCodeStyle, color: theme.cyan }}
        >
          $ npm run build &amp;&amp; npm run start
          <CursorMarker
            blink={terminal.cursorBlink}
            color={theme.cursor ?? theme.foreground ?? "#f8fafc"}
            cursorStyle={terminal.cursorStyle}
          />
        </code>
      </pre>
    </div>
  );
}

function terminalFontLabelFor(fontFamily: string): string {
  const selectedOption = terminalFontOptions.find(
    (option) => option.value === fontFamily,
  );
  if (selectedOption) {
    return selectedOption.label;
  }

  return primaryFontFamilyName(fontFamily) || "自定义字体";
}

function primaryFontFamilyName(fontFamily: string): string {
  const trimmedFontFamily = fontFamily.trim();
  if (!trimmedFontFamily) {
    return "";
  }

  const match = trimmedFontFamily.match(/^"([^"]+)"|^'([^']+)'|^([^,]+)/);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

export function CursorStylePreview({
  blink,
  cursorStyle,
}: {
  blink: boolean;
  cursorStyle: TerminalCursorStyle;
}) {
  return (
    <span
      aria-hidden="true"
      className="mt-3 block overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[#0b1220] shadow-inner"
    >
      <span className="flex h-7 items-center gap-1 border-b border-[rgb(255_255_255_/_0.08)] bg-[rgb(255_255_255_/_0.04)] px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400/80" />
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300/80" />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
        <span className="ml-2 text-[10px] font-medium uppercase tracking-normal text-zinc-500">
          prompt
        </span>
      </span>
      <span className="block px-3 py-2.5 font-mono text-[11px] leading-5 text-zinc-300">
        <span className="block text-emerald-300">root@kerminal</span>
        <span className="block text-zinc-500">~/workspace</span>
        <span className="block text-sky-300">
          $ edit cursor
          <CursorMarker
            blink={blink}
            color="#38bdf8"
            cursorStyle={cursorStyle}
          />
        </span>
      </span>
    </span>
  );
}

function CursorMarker({
  blink,
  color,
  cursorStyle,
}: {
  blink: boolean;
  color: string;
  cursorStyle: TerminalCursorStyle;
}) {
  const blinkClassName = blink ? "animate-pulse" : "";

  if (cursorStyle === "bar") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "ml-0.5 inline-block h-4 w-0.5 align-[-3px]",
          blinkClassName,
        )}
        style={{ backgroundColor: color }}
      />
    );
  }

  if (cursorStyle === "underline") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "ml-0.5 inline-block h-4 w-2.5 border-b-2 align-[-3px]",
          blinkClassName,
        )}
        style={{ borderColor: color }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "ml-0.5 inline-block h-4 w-2.5 rounded-[2px] align-[-3px]",
        blinkClassName,
      )}
      style={{ backgroundColor: color }}
    />
  );
}
