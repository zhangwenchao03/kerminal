import { lazy, Suspense, useEffect, useState } from "react";
import {
  Bot,
  Cpu,
  Database,
  FileText,
  FolderOpen,
  Network,
  Settings,
} from "lucide-react";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  defaultAppSettings,
  type AppSettings,
} from "../settings/settingsModel";
import type { SettingsSectionId } from "../settings/SettingsToolContent";
import type {
  Machine,
  TerminalPane,
  TerminalTab,
  ToolId,
  ToolSummary,
} from "../workspace/types";
import type { AddTerminalTabOptions } from "../workspace/workspaceStore";

interface ToolPanelProps {
  activeTool: ToolId | null;
  activeTab?: TerminalTab;
  defaultRemoteGroupId?: string;
  defaultRemoteHostId?: string;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  terminalTabs?: TerminalTab[];
  tools: ToolSummary[];
  settings?: AppSettings;
  onActiveToolChange: (toolId: ToolId) => void;
  onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
  onFocusTab?: (tabId: string) => void;
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void;
  onOpenSshTerminal?: (hostId: string) => void;
  onRemoteHostCreated?: () => void | Promise<void>;
  onSettingsChange?: (settings: AppSettings) => void;
  onSplitPane?: (direction: "horizontal" | "vertical") => void;
}

const toolIcons = {
  ai: Bot,
  system: Cpu,
  sftp: FolderOpen,
  ports: Network,
  snippets: FileText,
  logs: Database,
  settings: Settings,
};

const SftpToolContent = lazy(async () => ({
  default: (await import("../sftp/SftpToolContent")).SftpToolContent,
}));
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

type AiToolContentComponent = typeof import("./AiToolContent").AiToolContent;
type AiToolContentProps = Parameters<AiToolContentComponent>[0];

let aiToolContentPromise: Promise<AiToolContentComponent> | undefined;

function loadAiToolContent() {
  aiToolContentPromise ??= import("./AiToolContent").then(
    (module) => module.AiToolContent,
  );
  return aiToolContentPromise;
}

export function ToolPanel({
  activeTool,
  activeTab,
  defaultRemoteGroupId,
  defaultRemoteHostId,
  focusedPane,
  onActiveToolChange,
  onCreateTerminal,
  onFocusTab,
  onOpenSettingsSection,
  onOpenSshTerminal,
  onRemoteHostCreated,
  onSettingsChange,
  onSplitPane,
  selectedMachine,
  settings = defaultAppSettings,
  terminalTabs,
  tools,
}: ToolPanelProps) {
  const railTools = tools.filter((tool) => tool.id !== "settings");
  const contentTool =
    activeTool === null
      ? null
      : activeTool === "settings"
        ? railTools[0]?.id
        : activeTool;
  const active = contentTool
    ? (tools.find((tool) => tool.id === contentTool) ?? railTools[0])
    : undefined;
  const drawerOpen = Boolean(contentTool && active);

  return (
    <aside
      aria-label="工具面板"
      aria-expanded={drawerOpen}
      className="flex h-full w-full min-w-0 border-l border-black/8 bg-white/72 backdrop-blur-xl dark:border-white/8 dark:bg-zinc-950/72"
    >
      {drawerOpen ? (
        <div
          className={cn(
            "min-w-0 flex-1",
            contentTool === "ai" || contentTool === "sftp"
              ? "flex flex-col overflow-hidden"
              : "scrollbar-none overflow-y-auto p-4",
          )}
        >
          {contentTool !== "ai" && contentTool !== "sftp" ? (
            <header className="mb-4">
              <p className="text-xs font-medium uppercase tracking-normal text-zinc-500">
                当前工具
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                {active?.title}
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {active?.description}
              </p>
            </header>
          ) : null}

          <RenderErrorBoundary
            fallback={(error) => (
              <ToolContentCrashFallback error={error} title={active?.title} />
            )}
            key={`${contentTool}:${selectedMachine?.id ?? "none"}`}
          >
            {contentTool === "ai" ? (
              <AiToolContentLoader
                activeTab={activeTab}
                defaultRemoteGroupId={defaultRemoteGroupId}
                defaultRemoteHostId={defaultRemoteHostId}
                focusedPane={focusedPane}
                availableTabs={terminalTabs}
                onCreateTerminal={onCreateTerminal}
                onFocusTab={onFocusTab}
                onOpenSettingsSection={onOpenSettingsSection}
                onOpenTool={onActiveToolChange}
                onOpenSshTerminal={onOpenSshTerminal}
                onRemoteHostCreated={onRemoteHostCreated}
                onSettingsChange={onSettingsChange}
                onSplitPane={onSplitPane}
                selectedMachine={selectedMachine}
                settings={settings}
                title={active?.title}
              />
            ) : (
              <Suspense
                fallback={<ToolContentLoadingFallback title={active?.title} />}
              >
                {contentTool === "system" ? (
                  <ServerInfoToolContent selectedMachine={selectedMachine} />
                ) : null}
                {contentTool === "sftp" ? (
                  <SftpToolContent
                    followedRemotePath={
                      focusedPane?.mode === "ssh" &&
                      focusedPane.remoteHostId === selectedMachine?.id
                        ? focusedPane.currentCwd
                        : focusedPane?.mode === "container" &&
                            focusedPane.machineId === selectedMachine?.id
                          ? focusedPane.currentCwd
                          : undefined
                    }
                    selectedMachine={selectedMachine}
                  />
                ) : null}
                {contentTool === "ports" ? (
                  <PortForwardToolContent selectedMachine={selectedMachine} />
                ) : null}
                {contentTool === "snippets" ? (
                  <SnippetToolContent
                    activeTabId={activeTab?.id}
                    focusedPane={focusedPane}
                  />
                ) : null}
                {contentTool === "logs" ? (
                  <LogToolContent focusedPane={focusedPane} />
                ) : null}
              </Suspense>
            )}
          </RenderErrorBoundary>
        </div>
      ) : null}
      <nav
        aria-label="工具栏"
        className={cn(
          "flex w-16 shrink-0 flex-col items-center gap-2 py-4",
          drawerOpen && "border-l border-black/8 dark:border-white/8",
        )}
      >
        {railTools.map((tool) => {
          const Icon = toolIcons[tool.id];
          const selected = tool.id === activeTool;

          return (
            <Button
              aria-label={`${selected ? "收起" : "打开"} ${tool.title}`}
              aria-pressed={selected}
              className={cn(
                "rounded-2xl",
                selected &&
                  "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100",
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

function AiToolContentLoader({
  title,
  ...props
}: AiToolContentProps & { title?: string }) {
  const [Component, setComponent] = useState<AiToolContentComponent | null>(
    null,
  );
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoadError(null);
    void loadAiToolContent()
      .then((nextComponent) => {
        if (!disposed) {
          setComponent(() => nextComponent);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoadError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  if (loadError) {
    throw loadError;
  }

  if (!Component) {
    return <ToolContentLoadingFallback title={title} />;
  }

  return <Component {...props} />;
}

function ToolContentLoadingFallback({ title }: { title?: string }) {
  return (
    <div
      aria-live="polite"
      className="rounded-2xl border border-black/8 bg-white/70 px-4 py-3 text-sm text-zinc-600 shadow-sm dark:border-white/10 dark:bg-zinc-900/70 dark:text-zinc-300"
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

function ToolContentCrashFallback({
  error,
  title,
}: {
  error: Error | null;
  title?: string;
}) {
  return (
    <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-100">
      <div className="font-medium">{title ?? "工具"}加载失败</div>
      <div className="mt-1 text-xs opacity-80">切换工具或重新打开后可重试。</div>
      {error?.message ? (
        <pre className="mt-3 max-h-32 overflow-auto rounded-xl bg-black/10 p-2 text-xs dark:bg-black/20">
          {error.message}
        </pre>
      ) : null}
    </div>
  );
}
