// @author kongweiguang

import { Bot, Cpu, FileText, FolderOpen, History, Network, PanelsTopLeft, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { cn } from "../lib/cn";
import type { ToolId } from "../features/workspace/types";
import { tools } from "../features/workspace/workspaceData";
import type { ConfigChangeNotice } from "./configRefreshCoordinator";

const shellToolRailIcons: Partial<Record<ToolId, typeof Bot>> = {
  agentLauncher: Bot,
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
          .filter((tool) => tool.id !== "settings")
          .map((tool) => {
            const Icon = shellToolRailIcons[tool.id];
            if (!Icon) {
              return null;
            }
            return (
              <Button
                aria-label={`打开 ${tool.title}`}
                className="h-8 w-8 rounded-xl"
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
