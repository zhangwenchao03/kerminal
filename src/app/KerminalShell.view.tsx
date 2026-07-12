// @author kongweiguang

import {
  Bot,
  Cpu,
  FileText,
  FolderOpen,
  History,
  Network,
  PanelsTopLeft,
  ScanSearch,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import {
  claimAgentSendRequestAutoOpen,
  useAgentSendRequestSnapshot,
} from "../features/agent-workflow/agentSendRequestStore";
import { cn } from "../lib/cn";
import type { DesktopPlatform } from "../lib/desktopPlatform";
import type { WindowFrameState } from "../lib/useTauriWindowFrameState";
import type { ToolId } from "../features/workspace/types";
import { tools } from "../features/workspace/workspaceData";
import { AppTitleBar } from "./AppTitleBar";
import type { ConfigChangeNotice } from "./configRefreshCoordinator";

const shellToolRailIcons: Partial<Record<ToolId, typeof Bot>> = {
  agentLauncher: Bot,
  context: ScanSearch,
  logs: History,
  ports: Network,
  sftp: FolderOpen,
  snippets: FileText,
  system: Cpu,
  tmux: PanelsTopLeft,
};

function shellNoticeClassName(level: ConfigChangeNotice["level"] | "warning") {
  return cn(
    "absolute bottom-3 left-1/2 z-20 flex max-w-[min(720px,calc(100%-32px))] -translate-x-1/2 items-start gap-2 rounded-xl border px-3 py-2 font-mono text-xs shadow-lg shadow-black/20",
    level === "info" &&
      "border-emerald-300/25 bg-emerald-50/95 text-emerald-900 dark:border-emerald-300/20 dark:bg-emerald-950/85 dark:text-emerald-100",
    level === "warning" &&
      "border-amber-300/30 bg-amber-50/95 text-amber-900 dark:border-amber-300/20 dark:bg-amber-950/85 dark:text-amber-100",
    level === "error" &&
      "border-rose-300/30 bg-rose-50/95 text-rose-900 dark:border-rose-300/20 dark:bg-rose-950/85 dark:text-rose-100",
  );
}

export function ShellToolRail({
  onActiveToolChange,
}: {
  onActiveToolChange: (toolId: ToolId) => void;
}) {
  const agentSendRequest = useAgentSendRequestSnapshot().request;
  useEffect(() => {
    if (
      agentSendRequest &&
      claimAgentSendRequestAutoOpen(agentSendRequest.id)
    ) {
      onActiveToolChange("agentLauncher");
    }
  }, [agentSendRequest, onActiveToolChange]);

  return (
    <aside
      aria-expanded={false}
      aria-label="工具面板"
      className="kerminal-material-nav flex h-full w-full min-w-0 justify-center overflow-hidden border-l"
    >
      <nav
        aria-label="工具栏"
        className="flex w-full min-w-0 flex-col items-center gap-1.5 py-2.5"
      >
        {tools
          .map((tool) => {
            const Icon = shellToolRailIcons[tool.id];
            if (!Icon) {
              return null;
            }
            return (
              <Button
                aria-label={`打开 ${tool.title}`}
                className={cn(
                  "h-8 w-8 rounded-lg",
                  tool.id === "logs" && "mt-auto",
                )}
                data-shell-tool-id={tool.id}
                key={tool.id}
                onClick={() => onActiveToolChange(tool.id)}
                size="icon"
                title={tool.title}
                variant="ghost"
              >
                <Icon className="h-4 w-4" />
              </Button>
            );
          })}
      </nav>
    </aside>
  );
}

/**
 * 紧凑布局使用覆盖式工具抽屉，避免把终端工作区压缩到不可用宽度。
 * 抽屉保留 ToolPanel 自身工具栏，并提供遮罩与 Escape 两种关闭路径。
 */
export function ShellCompactToolPanel({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusableElements = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      if (!firstFocusable || !lastFocusable) {
        return;
      }

      // 模态抽屉打开时，Tab 只能在抽屉内部循环，避免焦点落到被遮罩的终端。
      const activeElement = document.activeElement;
      if (
        event.shiftKey &&
        (activeElement === firstFocusable || !panel.contains(activeElement))
      ) {
        event.preventDefault();
        lastFocusable.focus();
        return;
      }
      if (
        !event.shiftKey &&
        (activeElement === lastFocusable || !panel.contains(activeElement))
      ) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <>
      <button
        aria-label="关闭紧凑工具面板"
        className="absolute inset-x-0 bottom-0 top-9 z-30 bg-zinc-950/18 backdrop-blur-[1px] dark:bg-black/35"
        onClick={onClose}
        type="button"
      />
      <section
        aria-modal="true"
        aria-label="紧凑工具面板"
        className="kerminal-floating-enter absolute bottom-0 right-0 top-9 z-40 w-[min(440px,calc(100%-12px))] overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-overlay)] shadow-[var(--shadow-floating)]"
        ref={panelRef}
        role="dialog"
      >
        <header className="flex h-10 items-center justify-end border-b border-[var(--border-subtle)] px-2">
          <Button
            aria-label="关闭工具面板"
            className="h-8 w-8 rounded-lg"
            onClick={onClose}
            size="icon"
            title="关闭"
            variant="ghost"
          >
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>
        <div className="h-[calc(100%-2.5rem)] min-h-0">{children}</div>
      </section>
    </>
  );
}

/** 在桌面固定侧栏与紧凑覆盖抽屉之间复用同一份 ToolPanel。 */
export function ShellResponsiveToolPanel({
  activeTool,
  compact,
  panel,
  rail,
  onClose,
}: {
  activeTool: ToolId | null;
  compact: boolean;
  panel: ReactNode;
  rail: ReactNode;
  onClose: () => void;
}) {
  const lastActiveToolRef = useRef<ToolId | null>(activeTool);
  const open = activeTool !== null;

  useEffect(() => {
    if (activeTool) {
      lastActiveToolRef.current = activeTool;
      return;
    }
    const toolId = lastActiveToolRef.current;
    if (!toolId) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-shell-tool-id="${toolId}"]`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [activeTool]);

  return (
    <>
      <div
        className="relative z-20 h-full overflow-hidden"
        style={{ gridColumn: "5 / 6", gridRow: "2 / 3" }}
      >
        {open ? (compact ? null : panel) : rail}
      </div>
      {compact && open ? (
        <ShellCompactToolPanel onClose={onClose}>
          {panel}
        </ShellCompactToolPanel>
      ) : null}
    </>
  );
}

/** 主窗口顶部材质、拖拽区域和平台标题栏。 */
export function ShellWindowChrome({
  desktopPlatform,
  leftPanelCollapsed,
  onLeftPanelCollapsedChange,
  resolvedTheme,
  rightToolRailTitleBarFillWidth,
  windowFrameState,
}: {
  desktopPlatform: DesktopPlatform;
  leftPanelCollapsed: boolean;
  onLeftPanelCollapsedChange: (collapsed: boolean) => void;
  resolvedTheme: "dark" | "light";
  rightToolRailTitleBarFillWidth: number;
  windowFrameState: WindowFrameState;
}) {
  return (
    <>
      <div
        className="kerminal-material-nav col-[1/2] row-[1/2]"
        data-tauri-drag-region
      />
      <div
        className="kerminal-material-nav col-[2/6] row-[1/2] border-b"
        data-tauri-drag-region
      />
      <div
        className="pointer-events-none relative z-10 col-[2/6] row-[1/2] justify-self-end kerminal-material-nav"
        data-right-tool-rail-titlebar-fill
        style={{
          height: "calc(100% + 1px)",
          width: rightToolRailTitleBarFillWidth,
        }}
      />
      <AppTitleBar
        className="pointer-events-none col-[1/-1] row-[1/2] z-50 border-b-0 bg-transparent"
        desktopPlatform={desktopPlatform}
        leftPanelCollapsed={leftPanelCollapsed}
        onLeftPanelCollapsedChange={onLeftPanelCollapsedChange}
        resolvedTheme={resolvedTheme}
        surface={false}
        windowFrameState={windowFrameState}
      />
    </>
  );
}

export function KerminalShellNotices({
  configNotice,
  onConfigNoticeDismiss,
  onShellNoticeDismiss,
  shellNoticeMessage,
  shellNoticeVisible,
}: {
  configNotice: ConfigChangeNotice | null;
  onConfigNoticeDismiss: () => void;
  onShellNoticeDismiss: () => void;
  shellNoticeMessage?: string | null;
  shellNoticeVisible: boolean;
}) {
  if (configNotice) {
    return (
      <div
        aria-live="polite"
        className={shellNoticeClassName(configNotice.level)}
        role={configNotice.level === "error" ? "alert" : "status"}
      >
        <span className="min-w-0 flex-1 truncate">{configNotice.text}</span>
        <button
          aria-label="关闭提示"
          className="rounded-md p-1 opacity-75 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          onClick={onConfigNoticeDismiss}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!shellNoticeMessage || !shellNoticeVisible) {
    return null;
  }

  return (
    <div className={shellNoticeClassName("warning")} role="alert">
      <span className="min-w-0 flex-1">{shellNoticeMessage}</span>
      <button
        aria-label="关闭提示"
        className="rounded-md p-1 opacity-75 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        onClick={onShellNoticeDismiss}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
