import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Cpu,
  FileText,
  History,
  Network,
  PanelsTopLeft,
} from "lucide-react";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  DiagnosticsBundleButton,
  DiagnosticsBundleNotice,
  useDiagnosticsBundleController,
} from "./DiagnosticsBundleCard";
import {
  defaultTerminalAppearance,
  type AppSettings,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settings/settingsModel";
import type { SettingsSectionId } from "../settings/SettingsToolContent";
import type {
  Machine,
  TerminalPane,
  TerminalTab,
  ToolId,
  ToolSummary,
} from "../workspace/types";
import type {
  AddTerminalTabOptions,
  TmuxAttachPlacement,
} from "../workspace/workspaceStore";
import type { TmuxAttachLaunch } from "../../lib/tmuxApi";

interface ToolPanelProps {
  activeTool: ToolId | null;
  activeMachine?: Machine;
  activeTab?: TerminalTab;
  defaultRemoteGroupId?: string;
  defaultRemoteHostId?: string;
  focusedPane?: TerminalPane;
  terminalPanes?: TerminalPane[];
  terminalTabs?: TerminalTab[];
  tools: ToolSummary[];
  settings?: AppSettings;
  snippetConfigRevision?: number;
  resolvedTheme?: ResolvedTheme;
  terminalAppearance?: TerminalAppearance;
  workflowConfigRevision?: number;
  onActiveToolChange: (toolId: ToolId) => void;
  onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
  onFocusTab?: (tabId: string) => void;
  onClosePane?: (paneId: string) => void;
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void;
  onOpenSshTerminal?: (hostId: string) => void;
  onOpenTmuxTerminal?: (
    launch: TmuxAttachLaunch,
    placement?: TmuxAttachPlacement,
  ) => void;
  onRemoteHostCreated?: () => void | Promise<void>;
  onSettingsChange?: (settings: AppSettings) => void;
  onSplitPane?: (direction: "horizontal" | "vertical") => void;
}

const toolIcons: Partial<Record<ToolId, typeof Bot>> = {
  agentLauncher: Bot,
  system: Cpu,
  ports: Network,
  tmux: PanelsTopLeft,
  snippets: FileText,
  logs: History,
};

const ServerInfoToolContent = lazy(async () => ({
  default: (await import("./ServerInfoToolContent")).ServerInfoToolContent,
}));
const PortForwardToolContent = lazy(async () => ({
  default: (await import("./PortForwardToolContent")).PortForwardToolContent,
}));
const SnippetToolContent = lazy(async () => ({
  default: (await import("../snippets/SnippetToolContent")).SnippetToolContent,
}));
const LogToolContent = lazy(async () => ({
  default: (await import("../logs/LogToolContent")).LogToolContent,
}));
const AgentLauncherToolContent = lazy(async () => ({
  default: (await import("./AgentLauncherToolContent"))
    .AgentLauncherToolContent,
}));
const TmuxToolContent = lazy(async () => ({
  default: (await import("./TmuxToolContent")).TmuxToolContent,
}));

export function ToolPanel({
  activeTool,
  activeMachine,
  activeTab,
  focusedPane,
  onClosePane,
  onActiveToolChange,
  onFocusTab,
  onOpenTmuxTerminal,
  resolvedTheme = "dark",
  settings,
  snippetConfigRevision,
  terminalPanes,
  terminalTabs,
  terminalAppearance,
  tools,
}: ToolPanelProps) {
  const railTools = useMemo(
    () => tools.filter((tool) => tool.id !== "sftp"),
    [tools],
  );
  const defaultContentToolId =
    railTools.find((tool) => tool.id !== "settings")?.id ?? null;
  const contentTool =
    activeTool === null
      ? null
      : activeTool === "sftp"
        ? null
      : activeTool === "settings"
        ? defaultContentToolId
        : activeTool;
  const [mountedToolIds, setMountedToolIds] = useState<ToolId[]>(() =>
    contentTool ? [contentTool] : [],
  );
  const renderedToolIds = useMemo(() => {
    const availableToolIds = new Set(railTools.map((tool) => tool.id));
    const nextToolIds = mountedToolIds.filter((toolId) =>
      availableToolIds.has(toolId),
    );
    if (contentTool && !nextToolIds.includes(contentTool)) {
      return [...nextToolIds, contentTool];
    }
    return nextToolIds;
  }, [contentTool, mountedToolIds, railTools]);
  const renderedTools = useMemo(
    () =>
      renderedToolIds
        .map((toolId) => railTools.find((tool) => tool.id === toolId))
        .filter((tool): tool is ToolSummary => Boolean(tool)),
    [renderedToolIds, railTools],
  );
  const diagnosticsBundle = useDiagnosticsBundleController();
  const active = contentTool
    ? (tools.find((tool) => tool.id === contentTool) ?? railTools[0])
    : undefined;
  const drawerOpen = Boolean(contentTool && active);
  const interfaceDensity = settings?.interfaceDensity ?? "comfortable";
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const drawerPaddingClass = compactDensity
    ? "scrollbar-none overflow-y-auto p-3"
    : spaciousDensity
      ? "scrollbar-none overflow-y-auto p-5"
      : "scrollbar-none overflow-y-auto p-4";
  const railClassName = compactDensity
    ? "flex w-11 shrink-0 flex-col items-center gap-1.5 py-2.5"
    : spaciousDensity
      ? "flex w-14 shrink-0 flex-col items-center gap-2 py-4"
      : "flex w-12 shrink-0 flex-col items-center gap-1.5 py-3";
  const railButtonDensityClassName = compactDensity
    ? "h-7 w-7 rounded-lg"
    : spaciousDensity
      ? "h-9 w-9 rounded-xl"
      : "h-8 w-8 rounded-xl";

  useEffect(() => {
    if (!contentTool) {
      return;
    }
    setMountedToolIds((current) =>
      current.includes(contentTool) ? current : [...current, contentTool],
    );
  }, [contentTool]);

  return (
    <aside
      aria-label="工具面板"
      aria-expanded={drawerOpen}
      className="kerminal-material-nav flex h-full w-full min-w-0 border-l"
    >
      {drawerOpen ? (
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {renderedTools.map((tool) => {
            const toolId = tool.id;
            const selected = toolId === contentTool;
            const fullHeightTool = toolId === "agentLauncher";
            return (
              <div
                aria-hidden={!selected}
                className={cn(
                  "absolute inset-0 min-w-0",
                  fullHeightTool
                    ? "flex flex-col overflow-hidden"
                    : drawerPaddingClass,
                )}
                hidden={!selected}
                key={toolId}
              >
                {fullHeightTool ? null : (
                  <header className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-normal text-zinc-500">
                      当前工具
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <h2 className="min-w-0 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                        {tool.title}
                      </h2>
                      {toolId === "logs" ? (
                        <DiagnosticsBundleButton
                          controller={diagnosticsBundle}
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {tool.description}
                    </p>
                  </header>
                )}

                <RenderErrorBoundary
                  fallback={() => (
                    <ToolContentCrashFallback
                      title={tool.title}
                    />
                  )}
                >
                  <Suspense
                    fallback={<ToolContentLoadingFallback title={tool.title} />}
                  >
                    {toolId === "agentLauncher" ? (
                      <AgentLauncherToolContent
                        activeTab={activeTab}
                        desktopNotifications={settings?.desktopNotifications}
                        focusedPane={focusedPane}
                        resolvedTheme={resolvedTheme}
                        terminalAppearance={
                          terminalAppearance ??
                          settings?.terminal ??
                          defaultTerminalAppearance
                        }
                        terminalTabs={terminalTabs}
                      />
                    ) : null}
                    {toolId === "system" ? (
                      <ServerInfoToolContent selectedMachine={activeMachine} />
                    ) : null}
                    {toolId === "ports" ? (
                      <PortForwardToolContent
                        focusedPane={focusedPane}
                        selectedMachine={activeMachine}
                      />
                    ) : null}
                    {toolId === "tmux" ? (
                      <TmuxToolContent
                        activeMachine={activeMachine}
                        activeTab={activeTab}
                        focusedPane={focusedPane}
                        onClosePane={onClosePane}
                        onFocusTab={onFocusTab}
                        onOpenTmuxTerminal={onOpenTmuxTerminal}
                        terminalPanes={terminalPanes}
                        terminalTabs={terminalTabs}
                      />
                    ) : null}
                    {toolId === "snippets" ? (
                      <SnippetToolContent
                        activeTabId={activeTab?.id}
                        configRevision={snippetConfigRevision}
                        focusedPane={focusedPane}
                      />
                    ) : null}
                    {toolId === "logs" ? (
                      <LogToolContent
                        diagnosticsBundleNotice={
                          <DiagnosticsBundleNotice
                            controller={diagnosticsBundle}
                          />
                        }
                        focusedPane={focusedPane}
                      />
                    ) : null}
                  </Suspense>
                </RenderErrorBoundary>
              </div>
            );
          })}
        </div>
      ) : null}
      <nav
        aria-label="工具栏"
        className={cn(
          railClassName,
          drawerOpen && "border-l border-[var(--border-subtle)]",
        )}
      >
        {railTools.map((tool) => {
          const Icon = toolIcons[tool.id];
          const selected = tool.id === activeTool;
          if (!Icon) {
            return null;
          }

          return (
            <Button
              aria-label={`${selected ? "收起" : "打开"} ${tool.title}`}
              aria-pressed={selected}
              className={cn(
                railButtonDensityClassName,
                selected &&
                  "bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100",
              )}
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

function ToolContentLoadingFallback({ title }: { title?: string }) {
  return (
    <div
      aria-live="polite"
      className="kerminal-solid-surface rounded-2xl border px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300"
    >
      <div className="font-medium text-zinc-800 dark:text-zinc-100">
        正在加载{title ?? "工具"}
      </div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        请稍候...
      </div>
    </div>
  );
}

function ToolContentCrashFallback({ title }: { title?: string }) {
  return (
    <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-100">
      <div className="font-medium">{title ?? "工具"}加载失败</div>
      <div className="mt-1 text-xs opacity-80">
        收起右栏后重新打开可重试，详细信息已写入应用日志。
      </div>
    </div>
  );
}
