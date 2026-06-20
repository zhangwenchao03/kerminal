import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  resizeTerminal,
  startTerminalLog,
  stopTerminalLog,
  type TerminalSessionLogState,
} from "../../lib/terminalApi";
import type { RemoteTargetRef } from "../../lib/targetModel";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/settingsModel";
import {
  terminalColorSchemeForTheme,
  terminalFontWeightValue,
} from "../settings/settingsModel";
import { xtermThemeFor } from "../settings/terminalTheme";
import {
  TerminalCommandBlockRail,
  type TerminalCommandBlockAction,
} from "./TerminalCommandBlockRail";
import {
  splitDirectionForMenuAction,
  TerminalContextMenu,
  type TerminalContextMenuAction,
  type TerminalContextMenuPosition,
} from "./TerminalContextMenu";
import {
  buildTerminalCommandBlockViews,
  commandBlockViewsEqual,
  copyTerminalCommandBlockAsImage,
  terminalCommandBlockPlainText,
  type TerminalCommandBlock,
  type TerminalCommandBlockView,
} from "./terminalCommandBlocks";
import {
  createTerminalInputModelState,
  type TerminalInputModelState,
} from "./terminalInputModel";
import { TerminalSearchPanel } from "./TerminalSearchPanel";
import type { TerminalSplitDirection } from "../workspace/types";
import {
  applyTerminalCommandBlockFolding,
  clampMenuPosition,
  errorMessage,
  formatLogPath,
  pasteIntoTerminal,
  resolveTerminalContentBottomLine,
  resolveTerminalPromptLine,
  resolveTerminalRowHeight,
  type ConnectionState,
  type TerminalGhostSuggestion,
  stateLabel,
  terminalSearchOptions,
} from "./XtermPane.helpers";

export {
  collectCurrentDirOscSequences,
  collectSubmittedCommands,
} from "./XtermPane.helpers";
import { installXtermPaneRuntime } from "./XtermPane.runtime";

interface XtermPaneProps {
  args?: string[];
  currentCwd?: string;
  cwd?: string;
  env?: Record<string, string>;
  focused: boolean;
  paneId: string;
  profileId?: string;
  remoteHostId?: string;
  remoteHostProduction?: boolean;
  resolvedTheme: ResolvedTheme;
  shell?: string;
  terminalAppearance: TerminalAppearance;
  target?: RemoteTargetRef;
  title: string;
  onCurrentCwdChange?: (cwd: string) => void;
  onOpenLogs?: () => void;
  onOutputHistoryChange?: (outputHistory: string | undefined) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  outputHistory?: string;
}

export function XtermPane({
  args,
  currentCwd,
  cwd,
  env,
  focused,
  paneId,
  profileId,
  remoteHostId,
  remoteHostProduction = false,
  resolvedTheme,
  shell,
  terminalAppearance,
  target,
  title,
  onCurrentCwdChange,
  onOpenLogs,
  onOutputHistoryChange,
  onSplitPane,
  outputHistory,
}: XtermPaneProps) {
  const commandBlockCounterRef = useRef(0);
  const commandBlocksRef = useRef<TerminalCommandBlock[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const disconnectSessionRef = useRef<(() => Promise<void>) | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const focusedRef = useRef(focused);
  const inputBufferRef = useRef("");
  const inputModelRef = useRef<TerminalInputModelState>(
    createTerminalInputModelState(),
  );
  const cwdTrackingBufferRef = useRef("");
  const currentCwdRef = useRef(currentCwd ?? cwd);
  const ghostSuggestionRef = useRef<TerminalGhostSuggestion | null>(null);
  const onCurrentCwdChangeRef = useRef(onCurrentCwdChange);
  const onOutputHistoryChangeRef = useRef(onOutputHistoryChange);
  const outputHistoryRef = useRef(outputHistory);
  const reconnectSessionRef = useRef<(() => Promise<void>) | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const terminalAppearanceRef = useRef(terminalAppearance);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const searchInputId = useId();
  const [commandBlockNotice, setCommandBlockNotice] = useState<string | null>(
    null,
  );
  const [commandBlockViews, setCommandBlockViews] = useState<
    TerminalCommandBlockView[]
  >([]);
  const [contextMenu, setContextMenu] = useState<{
    canCopy: boolean;
    position: TerminalContextMenuPosition;
  } | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState({
    hasSearched: false,
    resultCount: 0,
    resultIndex: -1,
  });
  const [logState, setLogState] = useState<TerminalSessionLogState>({
    active: false,
    bytesWritten: 0,
  });
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const [ghostSuggestion, setGhostSuggestion] =
    useState<TerminalGhostSuggestion | null>(null);
  const terminalTheme = useMemo(
    () =>
      xtermThemeFor(
        resolvedTheme,
        terminalColorSchemeForTheme(terminalAppearance, resolvedTheme),
      ),
    [
      resolvedTheme,
      terminalAppearance.darkColorScheme,
      terminalAppearance.lightColorScheme,
    ],
  );
  const terminalFontWeight = useMemo(
    () => terminalFontWeightValue(terminalAppearance.fontWeight),
    [terminalAppearance.fontWeight],
  );

  const syncCommandBlockViews = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setCommandBlockViews([]);
      return;
    }

    const activeBuffer = terminal.buffer.active;
    const nextViews = buildTerminalCommandBlockViews(commandBlocksRef.current, {
      activeBufferType: activeBuffer.type,
      bufferLength: activeBuffer.length,
      cols: terminal.cols,
      contentBottomLine: resolveTerminalContentBottomLine(terminal),
      promptLine: resolveTerminalPromptLine(terminal, inputBufferRef.current),
      rowHeight: resolveTerminalRowHeight(
        containerRef.current,
        terminalAppearanceRef.current,
        terminal,
      ),
      rows: terminal.rows,
      viewportY: activeBuffer.viewportY,
    });

    setCommandBlockViews((current) =>
      commandBlockViewsEqual(current, nextViews) ? current : nextViews,
    );
  }, []);

  const clearCommandBlocks = useCallback(() => {
    const blocks = commandBlocksRef.current;
    commandBlocksRef.current = [];
    for (const block of blocks) {
      block.marker.dispose();
    }
    setCommandBlockViews([]);
    setCommandBlockNotice(null);
  }, []);

  useEffect(() => {
    currentCwdRef.current = currentCwd ?? cwd;
  }, [currentCwd, cwd]);

  useEffect(() => {
    onCurrentCwdChangeRef.current = onCurrentCwdChange;
  }, [onCurrentCwdChange]);

  useEffect(() => {
    onOutputHistoryChangeRef.current = onOutputHistoryChange;
  }, [onOutputHistoryChange]);

  useEffect(() => {
    outputHistoryRef.current = outputHistory;
  }, [outputHistory]);

  useEffect(() => {
    terminalAppearanceRef.current = terminalAppearance;
  }, [terminalAppearance]);

  useEffect(() => {
    ghostSuggestionRef.current = ghostSuggestion;
  }, [ghostSuggestion]);

  useEffect(() =>
    installXtermPaneRuntime({
      args,
      commandBlockCounterRef,
      commandBlocksRef,
      containerRef,
      cwd,
      cwdTrackingBufferRef,
      currentCwdRef,
      disconnectSessionRef,
      env,
      fitAddonRef,
      focusedRef,
      ghostSuggestionRef,
      inputBufferRef,
      inputModelRef,
      onCurrentCwdChangeRef,
      onOutputHistoryChangeRef,
      outputHistoryRef,
      paneId,
      profileId,
      reconnectSessionRef,
      remoteHostId,
      remoteHostProduction,
      searchAddonRef,
      sessionIdRef,
      setCommandBlockNotice,
      setCommandBlockViews,
      setConnectionState,
      setGhostSuggestion,
      setLogNotice,
      setLogState,
      setSearchResults,
      shell,
      syncCommandBlockViews,
      target,
      terminalAppearance,
      terminalAppearanceRef,
      terminalFontWeight,
      terminalRef,
      terminalTheme,
    }),
  [
    args,
    cwd,
    env,
    paneId,
    profileId,
    remoteHostId,
    remoteHostProduction,
    shell,
    syncCommandBlockViews,
    target,
  ]);

  useEffect(() => {
    focusedRef.current = focused;
    if (focused) {
      terminalRef.current?.focus();
    }
  }, [focused]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.cursorBlink = terminalAppearance.cursorBlink;
    terminal.options.cursorStyle = terminalAppearance.cursorStyle;
    terminal.options.fontFamily = terminalAppearance.fontFamily;
    terminal.options.fontSize = terminalAppearance.fontSize;
    terminal.options.fontWeight = terminalFontWeight;
    terminal.options.fontWeightBold = 700;
    terminal.options.lineHeight = terminalAppearance.lineHeight;
    terminal.options.macOptionIsMeta = terminalAppearance.macOptionIsMeta;
    terminal.options.scrollback = terminalAppearance.scrollback;
    terminal.options.theme = terminalTheme;
    fitAddonRef.current?.fit();
    const dimensions = fitAddonRef.current?.proposeDimensions();
    const sessionId = sessionIdRef.current;
    if (sessionId && dimensions) {
      void resizeTerminal(sessionId, {
        cols: dimensions.cols,
        rows: dimensions.rows,
      });
    }
  }, [terminalAppearance, terminalFontWeight, terminalTheme]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    return applyTerminalCommandBlockFolding(
      containerRef.current,
      commandBlockViews,
    );
  }, [commandBlockViews]);

  const startLogging = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setLogNotice("会话尚未就绪，无法记录日志");
      return;
    }

    try {
      const nextState = await startTerminalLog(sessionId);
      setLogState(nextState);
      setLogNotice(
        nextState.path
          ? `正在记录日志：${formatLogPath(nextState.path)}`
          : "正在记录日志",
      );
    } catch (error: unknown) {
      setLogNotice(`日志启动失败：${errorMessage(error)}`);
    }
  }, []);

  const stopLogging = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setLogNotice("会话尚未就绪，无法停止日志");
      return;
    }

    try {
      const nextState = await stopTerminalLog(sessionId);
      setLogState(nextState);
      setLogNotice(
        nextState.path
          ? `日志已停止：${formatLogPath(nextState.path)}`
          : "日志已停止",
      );
    } catch (error: unknown) {
      setLogNotice(`日志停止失败：${errorMessage(error)}`);
    }
  }, []);

  const disconnectTerminal = useCallback(async () => {
    await disconnectSessionRef.current?.();
  }, []);

  const reconnectTerminal = useCallback(async () => {
    await reconnectSessionRef.current?.();
  }, []);

  const executeContextMenuAction = useCallback(
    (action: TerminalContextMenuAction) => {
      setContextMenu(null);
      const terminal = terminalRef.current;
      const sessionId = sessionIdRef.current;

      if (action === "copy") {
        const selection = terminal?.getSelection?.() ?? "";
        if (selection) {
          void navigator.clipboard?.writeText(selection);
        }
      } else if (action === "paste") {
        void pasteIntoTerminal(terminal, sessionId);
      } else if (action === "selectAll") {
        terminal?.selectAll?.();
      } else if (action === "clear") {
        terminal?.clear?.();
        clearCommandBlocks();
      } else if (action === "search") {
        setSearchOpen(true);
      } else if (action === "startLog") {
        void startLogging();
      } else if (action === "stopLog") {
        void stopLogging();
      } else if (action === "disconnect") {
        void disconnectTerminal();
      } else if (action === "reconnect") {
        void reconnectTerminal();
      } else if (action === "openLogs") {
        onOpenLogs?.();
      } else {
        const direction = splitDirectionForMenuAction(action);
        if (direction) {
          onSplitPane?.(direction);
        }
      }

      terminal?.focus();
    },
    [
      onOpenLogs,
      onSplitPane,
      disconnectTerminal,
      reconnectTerminal,
      startLogging,
      stopLogging,
      clearCommandBlocks,
    ],
  );

  const openContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const terminal = terminalRef.current;
      const sessionId = sessionIdRef.current;
      const rightClickBehavior = terminalAppearanceRef.current.rightClickBehavior;
      if (rightClickBehavior === "none") {
        terminal?.focus();
        return;
      }
      if (rightClickBehavior === "paste") {
        void pasteIntoTerminal(terminal, sessionId);
        terminal?.focus();
        return;
      }

      const selection = terminal?.getSelection?.() ?? "";
      const menuState = {
        canCopy: selection.length > 0,
        position: clampMenuPosition(event.clientX, event.clientY),
      };
      setContextMenu(menuState);
      terminal?.focus();
    },
    [],
  );

  const executeCommandBlockAction = useCallback(
    (blockId: string, action: TerminalCommandBlockAction) => {
      const block = commandBlocksRef.current.find(
        (current) => current.id === blockId,
      );
      if (!block) {
        return;
      }

      if (action === "toggle") {
        block.collapsed = !block.collapsed;
        setCommandBlockNotice(
          block.collapsed ? "命令块已折叠" : "命令块已展开",
        );
        syncCommandBlockViews();
        terminalRef.current?.focus();
        return;
      }

      if (action === "copyText") {
        void navigator.clipboard
          ?.writeText(terminalCommandBlockPlainText(block))
          .then(() => setCommandBlockNotice("命令块文本已复制"))
          .catch(() => setCommandBlockNotice("复制命令块文本失败"));
        terminalRef.current?.focus();
        return;
      }

      void copyTerminalCommandBlockAsImage(block, resolvedTheme)
        .then((result) => {
          setCommandBlockNotice(
            result === "image"
              ? "命令块图片已复制"
              : "当前剪贴板不支持图片，已复制文本",
          );
        })
        .catch(() => {
          void navigator.clipboard
            ?.writeText(terminalCommandBlockPlainText(block))
            .then(() => setCommandBlockNotice("复制图片失败，已复制文本"))
            .catch(() => setCommandBlockNotice("复制命令块失败"));
        });
      terminalRef.current?.focus();
    },
    [resolvedTheme, syncCommandBlockViews],
  );

  const runSearch = useCallback(
    (direction: "next" | "previous") => {
      const query = searchQuery.trim();
      const searchAddon = searchAddonRef.current;
      if (!query || !searchAddon) {
        searchAddon?.clearDecorations();
        setSearchResults({
          hasSearched: false,
          resultCount: 0,
          resultIndex: -1,
        });
        return;
      }

      const options = terminalSearchOptions(searchCaseSensitive);
      const found =
        direction === "next"
          ? searchAddon.findNext(query, options)
          : searchAddon.findPrevious(query, options);
      setSearchResults((current) => ({
        ...current,
        hasSearched: true,
        ...(found ? {} : { resultCount: 0, resultIndex: -1 }),
      }));
    },
    [searchCaseSensitive, searchQuery],
  );

  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      searchAddonRef.current?.clearDecorations();
      setSearchResults({
        hasSearched: false,
        resultCount: 0,
        resultIndex: -1,
      });
    }
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, []);

  const toggleSearchCaseSensitive = useCallback(() => {
    setSearchCaseSensitive((current) => !current);
    setSearchResults({
      hasSearched: false,
      resultCount: 0,
      resultIndex: -1,
    });
  }, []);

  return (
    <div
      className="relative min-h-0 flex-1 bg-[#f7f7fa] dark:bg-[#1f1f21]"
      onContextMenu={openContextMenu}
    >
      <TerminalCommandBlockRail
        blocks={commandBlockViews}
        onAction={executeCommandBlockAction}
      />
      <div
        aria-label={`${title} xterm 终端`}
        className="h-full min-h-0 w-full overflow-hidden py-2 pl-6 pr-3"
        ref={containerRef}
      />
      {ghostSuggestion ? (
        <div
          aria-label="终端命令灰色提示"
          className="pointer-events-none absolute z-10 select-none overflow-hidden whitespace-pre font-mono text-zinc-400/75 dark:text-zinc-500/85"
          data-provider={ghostSuggestion.candidate.provider}
          style={{
            fontFamily: terminalAppearance.fontFamily,
            fontSize: terminalAppearance.fontSize,
            left: ghostSuggestion.left,
            lineHeight: `${ghostSuggestion.lineHeight}px`,
            maxWidth: ghostSuggestion.maxWidth,
            top: ghostSuggestion.top,
          }}
          title={ghostSuggestion.candidate.description}
        >
          {ghostSuggestion.suffix}
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-2 rounded-md border border-black/8 bg-white/70 px-2 py-1 text-[11px] text-zinc-500 dark:border-white/8 dark:bg-black/30 dark:text-zinc-400">
        {stateLabel(connectionState)}
      </div>
      {logState.active ? (
        <div
          aria-label="终端日志记录状态"
          className="pointer-events-none absolute right-3 top-9 rounded-md border border-sky-500/30 bg-sky-100/80 px-2 py-1 text-[11px] text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/15 dark:text-sky-200"
          title={logState.path}
        >
          记录中
        </div>
      ) : null}
      {logNotice ? (
        <div
          aria-label="终端日志提示"
          className="pointer-events-none absolute bottom-3 left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border border-black/8 bg-white/85 px-2 py-1 text-[11px] text-zinc-500 shadow-sm dark:border-white/8 dark:bg-black/35 dark:text-zinc-300"
          role="status"
          title={logNotice}
        >
          {logNotice}
        </div>
      ) : null}
      {commandBlockNotice ? (
        <div
          aria-label="命令块操作提示"
          className="pointer-events-none absolute left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border border-black/8 bg-white/85 px-2 py-1 text-[11px] text-zinc-500 shadow-sm dark:border-white/8 dark:bg-black/35 dark:text-zinc-300"
          role="status"
          style={{ bottom: logNotice ? 40 : 12 }}
          title={commandBlockNotice}
        >
          {commandBlockNotice}
        </div>
      ) : null}
      {searchOpen ? (
        <TerminalSearchPanel
          caseSensitive={searchCaseSensitive}
          hasSearched={searchResults.hasSearched}
          inputId={searchInputId}
          onClose={closeSearch}
          onQueryChange={updateSearchQuery}
          onSearchNext={() => runSearch("next")}
          onSearchPrevious={() => runSearch("previous")}
          onToggleCaseSensitive={toggleSearchCaseSensitive}
          query={searchQuery}
          resultCount={searchResults.resultCount}
          resultIndex={searchResults.resultIndex}
        />
      ) : null}
      {contextMenu ? (
        <TerminalContextMenu
          canDisconnect={connectionState === "connected"}
          canCopy={contextMenu.canCopy}
          canReconnect={connectionState !== "connecting"}
          isLogging={logState.active}
          onAction={executeContextMenuAction}
          onClose={() => setContextMenu(null)}
          position={contextMenu.position}
        />
      ) : null}
    </div>
  );
}

