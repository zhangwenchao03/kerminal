import {
  useCallback,
  useId,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { terminalSearchOptions } from "./XtermPane.helpers";

export interface XtermPaneSearchController {
  caseSensitive: boolean;
  close(): void;
  inputId: string;
  open: boolean;
  openSearch(): void;
  query: string;
  resultCount: number;
  resultIndex: number;
  setResults: Dispatch<SetStateAction<XtermPaneSearchResults>>;
  hasSearched: boolean;
  run(direction: "next" | "previous"): void;
  toggleCaseSensitive(): void;
  updateQuery(query: string): void;
}

export interface XtermPaneSearchResults {
  hasSearched: boolean;
  resultCount: number;
  resultIndex: number;
}

interface UseXtermPaneSearchOptions {
  searchAddonRef: RefObject<SearchAddon | null>;
  terminalRef: RefObject<XtermTerminal | null>;
}

const EMPTY_SEARCH_RESULTS: XtermPaneSearchResults = {
  hasSearched: false,
  resultCount: 0,
  resultIndex: -1,
};

/**
 * 管理终端搜索面板状态，并把 SearchAddon 副作用限制在明确的控制器边界内。
 */
export function useXtermPaneSearch({
  searchAddonRef,
  terminalRef,
}: UseXtermPaneSearchOptions): XtermPaneSearchController {
  const inputId = useId();
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(EMPTY_SEARCH_RESULTS);
  const openSearch = useCallback(() => setOpen(true), []);

  const run = useCallback(
    (direction: "next" | "previous") => {
      const normalizedQuery = query.trim();
      const searchAddon = searchAddonRef.current;
      if (!normalizedQuery || !searchAddon) {
        searchAddon?.clearDecorations();
        setResults(EMPTY_SEARCH_RESULTS);
        return;
      }

      const options = terminalSearchOptions(caseSensitive);
      const found =
        direction === "next"
          ? searchAddon.findNext(normalizedQuery, options)
          : searchAddon.findPrevious(normalizedQuery, options);
      setResults((current) => ({
        ...current,
        hasSearched: true,
        ...(found ? {} : { resultCount: 0, resultIndex: -1 }),
      }));
    },
    [caseSensitive, query, searchAddonRef],
  );

  const updateQuery = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      if (!nextQuery.trim()) {
        searchAddonRef.current?.clearDecorations();
        setResults(EMPTY_SEARCH_RESULTS);
      }
    },
    [searchAddonRef],
  );

  const close = useCallback(() => {
    setOpen(false);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, [searchAddonRef, terminalRef]);

  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive((current) => !current);
    setResults(EMPTY_SEARCH_RESULTS);
  }, []);

  return {
    caseSensitive,
    close,
    hasSearched: results.hasSearched,
    inputId,
    open,
    openSearch,
    query,
    resultCount: results.resultCount,
    resultIndex: results.resultIndex,
    run,
    setResults,
    toggleCaseSensitive,
    updateQuery,
  };
}
