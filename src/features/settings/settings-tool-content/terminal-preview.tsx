import { Check } from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  terminalColorSchemeForTheme,
  terminalColorSchemeOptions,
  terminalFontWeightValue,
  type ResolvedTheme,
  type TerminalAppearance,
  type TerminalColorScheme,
  type TerminalCursorStyle,
} from "../settingsModel";
import { xtermThemeFor } from "../terminalTheme";

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
              className={cn(
                "min-h-20 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                selected
                  ? "border-sky-500/45 bg-sky-500/12 text-sky-700 shadow-sm shadow-sky-950/5 dark:border-sky-300/35 dark:bg-sky-400/12 dark:text-sky-100"
                  : "border-black/8 bg-black/[0.03] text-zinc-600 hover:bg-black/[0.06] dark:border-white/8 dark:bg-black/20 dark:text-zinc-300 dark:hover:bg-white/10",
              )}
              key={option.value}
              onClick={() => onSelect(option.value)}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex overflow-hidden rounded-full border border-black/10 dark:border-white/10"
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

  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        字体预览
      </div>
      <pre
        aria-label="终端字体预览"
        className="mt-2 overflow-hidden rounded-xl border border-black/10 p-3 text-left shadow-inner dark:border-white/10"
        style={{
          backgroundColor: theme.background,
          color: theme.foreground,
          fontFamily: terminal.fontFamily,
          fontSize: terminal.fontSize,
          fontWeight: terminalFontWeightValue(terminal.fontWeight),
          lineHeight: terminal.lineHeight,
        }}
      >
        <code className="block">abcdefghijklmnopqrstuvwxyz</code>
        <code className="block">0123456789 !@#$%^&*()[]{}&lt;&gt;</code>
        <code className="block">中文路径 /var/log/应用 日志输出</code>
        <code className="block" style={{ color: theme.green }}>
          $ ssh root@server.example.com
        </code>
        <code className="block" style={{ color: theme.cyan }}>
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
      className="mt-3 block overflow-hidden rounded-xl border border-black/10 bg-[#0b1220] shadow-inner dark:border-white/10"
    >
      <span className="flex h-7 items-center gap-1 border-b border-white/8 bg-white/[0.04] px-3">
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
