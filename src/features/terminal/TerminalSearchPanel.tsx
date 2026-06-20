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
  const resultLabel = searchResultLabel({
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
      className="absolute right-3 top-10 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-2xl border border-black/10 bg-white/95 p-1.5 shadow-2xl shadow-black/15 backdrop-blur dark:border-white/10 dark:bg-zinc-950/95 dark:shadow-black/35"
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
        className="h-8 w-44 bg-transparent px-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        id={inputId}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter" && event.shiftKey) {
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
          resultCount === 0 && hasSearched && query.trim()
            ? "text-rose-500 dark:text-rose-300"
            : "text-zinc-400",
        )}
      >
        {resultLabel}
      </span>
      <Button
        aria-label="上一个匹配"
        disabled={!query.trim()}
        onClick={onSearchPrevious}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="下一个匹配"
        disabled={!query.trim()}
        onClick={onSearchNext}
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
          caseSensitive &&
            "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-200",
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

function searchResultLabel({
  hasSearched,
  query,
  resultCount,
  resultIndex,
}: {
  hasSearched: boolean;
  query: string;
  resultCount: number;
  resultIndex: number;
}) {
  if (!query.trim()) {
    return "输入关键词";
  }
  if (!hasSearched) {
    return "待搜索";
  }
  if (resultCount <= 0) {
    return "无匹配";
  }
  if (resultIndex < 0) {
    return `${resultCount} 项`;
  }
  return `${resultIndex + 1}/${resultCount}`;
}
