import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  buildTerminalSearchPanelModel,
  resolveTerminalSearchInputKeyAction,
} from "./terminalSearchPanelModel";

const terminalSearchPanelClassName =
  "kerminal-floating-surface kerminal-floating-enter absolute right-3 top-10 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-[var(--radius-card)] border p-1.5";
const terminalSearchInputClassName =
  "h-8 w-44 bg-transparent px-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100";
const terminalSearchActiveToggleClassName =
  "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-200";

interface TerminalSearchPanelProps {
  caseSensitive: boolean;
  hasSearched: boolean;
  inputId: string;
  query: string;
  resultCount: number;
  resultIndex: number;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
  onToggleCaseSensitive: () => void;
}

export function TerminalSearchPanel({
  caseSensitive,
  hasSearched,
  inputId,
  query,
  resultCount,
  resultIndex,
  onClose,
  onQueryChange,
  onSearchNext,
  onSearchPrevious,
  onToggleCaseSensitive,
}: TerminalSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const model = buildTerminalSearchPanelModel({
    hasSearched,
    query,
    resultCount,
    resultIndex,
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      aria-label="终端搜索"
      className={terminalSearchPanelClassName}
      onSubmit={(event) => {
        event.preventDefault();
        onSearchNext();
      }}
    >
      <Search className="ml-2 h-4 w-4 shrink-0 text-zinc-400" />
      <label className="sr-only" htmlFor={inputId}>
        搜索终端缓冲区
      </label>
      <input
        className={terminalSearchInputClassName}
        id={inputId}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          const action = resolveTerminalSearchInputKeyAction(event);
          if (action === "close") {
            event.preventDefault();
            onClose();
          }
          if (action === "previous") {
            event.preventDefault();
            onSearchPrevious();
          }
        }}
        placeholder="搜索当前终端"
        ref={inputRef}
        value={query}
      />
      <span
        className={cn(
          "w-16 shrink-0 text-right text-[11px]",
          model.resultTone === "danger"
            ? "text-rose-500 dark:text-rose-300"
            : "text-zinc-400",
        )}
      >
        {model.resultLabel}
      </span>
      <Button
        aria-label="上一个匹配"
        disabled={model.navigationDisabled}
        onClick={onSearchPrevious}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="下一个匹配"
        disabled={model.navigationDisabled}
        size="icon"
        type="submit"
        variant="ghost"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="区分大小写"
        aria-pressed={caseSensitive}
        className={cn(
          caseSensitive && terminalSearchActiveToggleClassName,
        )}
        onClick={onToggleCaseSensitive}
        size="icon"
        type="button"
        variant="ghost"
      >
        <CaseSensitive className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="关闭搜索"
        onClick={onClose}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
