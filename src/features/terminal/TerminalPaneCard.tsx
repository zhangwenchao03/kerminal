import { Terminal, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/settingsModel";
import type { TerminalPane } from "../workspace/types";
import type { TerminalSplitDirection } from "../workspace/types";
import { XtermPane } from "./XtermPane";
import { buildTerminalPaneCardModel } from "./terminalPaneCardModel";

interface TerminalPaneCardProps {
  focused: boolean;
  pane: TerminalPane;
  resolvedTheme: ResolvedTheme;
  terminalAppearance: TerminalAppearance;
  onClosePane: (paneId: string) => void;
  onCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenLogs?: () => void;
  onOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
}

export function TerminalPaneCard({
  focused,
  onClosePane,
  onCurrentCwdChange,
  onFocusPane,
  onOpenLogs,
  onOutputHistoryChange,
  onSplitPane,
  pane,
  resolvedTheme,
  terminalAppearance,
}: TerminalPaneCardProps) {
  const model = buildTerminalPaneCardModel(pane);

  return (
    <section
      aria-label={model.ariaLabel}
      className={cn(
        "kerminal-terminal-surface flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border",
        focused ? "border-sky-400/70" : "border-[var(--border-subtle)]",
      )}
      onClick={() => onFocusPane(pane.id)}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {model.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {model.latencyLabel ? (
            <span className="rounded-lg bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">
              {model.latencyLabel}
            </span>
          ) : null}
          <Button
            aria-label={model.closeAriaLabel}
            onClick={(event) => {
              event.stopPropagation();
              onClosePane(pane.id);
            }}
            size="icon"
            variant="ghost"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {model.renderKind === "runtime" ? (
        <XtermPane
          args={pane.args}
          currentCwd={pane.currentCwd}
          cwd={pane.cwd}
          env={pane.env}
          focused={focused}
          paneId={pane.id}
          profileId={pane.profileId}
          remoteHostId={pane.remoteHostId}
          remoteHostProduction={pane.remoteHostProduction}
          onCurrentCwdChange={(cwd) => onCurrentCwdChange?.(pane.id, cwd)}
          onOpenLogs={onOpenLogs}
          onOutputHistoryChange={(outputHistory) =>
            onOutputHistoryChange?.(pane.id, outputHistory)
          }
          onSplitPane={onSplitPane}
          outputHistory={pane.outputHistory}
          resolvedTheme={resolvedTheme}
          shell={pane.shell}
          target={pane.target}
          terminalAppearance={terminalAppearance}
          title={pane.title}
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto bg-[#f7f7fa] p-4 font-mono text-[13px] leading-6 text-zinc-800 dark:bg-[#1f1f21] dark:text-zinc-200">
          {pane.lines.map((line, index) => (
            <code className="block" key={`${pane.id}-${index}-${line}`}>
              {line}
            </code>
          ))}
          <code className="mt-2 flex items-center gap-2 text-rose-300">
            <Terminal className="h-3.5 w-3.5" />
            {pane.prompt}
          </code>
        </pre>
      )}
    </section>
  );
}
