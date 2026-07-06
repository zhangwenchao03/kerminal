import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  MousePointerClick,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Type,
} from "lucide-react";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/cn";
import { terminalRendererRegistry } from "../../terminal/terminalRendererRegistry";
import {
  terminalCursorStyleOptions,
  terminalFontOptions,
  terminalFontWeightOptions,
  terminalRendererTypeOptions,
  terminalRightClickBehaviorOptions,
  type AppSettings,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settingsModel";
import { NumberSetting, PolicyToggle } from "./shared-controls";
import {
  CursorStylePreview,
  TerminalAppearancePreview,
  TerminalSchemePicker,
} from "./terminal-preview";
import {
  collectTerminalRuntimePerformanceSnapshot,
  subscribeTerminalRuntimeDiagnostics,
} from "../../terminal/terminalRuntimeDiagnosticsStore";
import {
  evaluateRuntimeProductionReadinessGate,
  type RuntimePerformanceSnapshot,
} from "../../terminal/terminalRuntimeDiagnostics";

interface TerminalSettingsSectionProps {
  normalizedSettings: AppSettings;
  resolvedTheme: ResolvedTheme;
  updateTerminal: (terminal: Partial<TerminalAppearance>) => void;
}

const terminalPanelClassName =
  "kerminal-solid-surface min-w-0 overflow-hidden rounded-2xl border p-5";
const terminalSubpanelClassName =
  "kerminal-muted-surface min-w-0 rounded-xl border p-4";
const terminalBadgeClassName =
  "kerminal-muted-surface rounded-full border px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400";

function terminalChoiceButtonClassName(selected: boolean, className?: string) {
  return cn(
    "kerminal-focus-ring kerminal-pressable rounded-xl border text-left transition",
    selected
      ? "border-sky-500/45 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 dark:border-sky-300/35 dark:text-sky-100 dark:ring-sky-300/15"
      : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
    className,
  );
}

export function TerminalSettingsSection({
  normalizedSettings,
  resolvedTheme,
  updateTerminal,
}: TerminalSettingsSectionProps) {
  const rendererSnapshot = useSyncExternalStore(
    terminalRendererRegistry.subscribe,
    terminalRendererRegistry.getSnapshot,
    terminalRendererRegistry.getSnapshot,
  );
  const [runtimeDiagnostics, setRuntimeDiagnostics] =
    useState<RuntimePerformanceSnapshot | null>(null);
  const [runtimeDiagnosticsError, setRuntimeDiagnosticsError] = useState<
    string | null
  >(null);
  const [runtimeDiagnosticsLoading, setRuntimeDiagnosticsLoading] =
    useState(false);
  const runtimeGate = useMemo(
    () =>
      runtimeDiagnostics
        ? evaluateRuntimeProductionReadinessGate(runtimeDiagnostics)
        : null,
    [runtimeDiagnostics],
  );

  const refreshRuntimeDiagnostics = useCallback(async () => {
    setRuntimeDiagnosticsLoading(true);
    setRuntimeDiagnosticsError(null);
    try {
      setRuntimeDiagnostics(await collectTerminalRuntimePerformanceSnapshot());
    } catch (error) {
      setRuntimeDiagnostics(null);
      setRuntimeDiagnosticsError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRuntimeDiagnosticsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const snapshot = await collectTerminalRuntimePerformanceSnapshot();
        if (!mounted) {
          return;
        }
        setRuntimeDiagnostics(snapshot);
        setRuntimeDiagnosticsError(null);
      } catch (error) {
        if (!mounted) {
          return;
        }
        setRuntimeDiagnostics(null);
        setRuntimeDiagnosticsError(
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    void load();
    const unsubscribe = subscribeTerminalRuntimeDiagnostics(() => {
      void load();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const runtimeQueueDepth = useMemo(
    () => runtimeDiagnosticsQueueDepth(runtimeDiagnostics),
    [runtimeDiagnostics],
  );
  const runtimeCleanupState = useMemo(
    () => runtimeDiagnosticsCleanupState(runtimeDiagnostics),
    [runtimeDiagnostics],
  );

  return (
    <section className={terminalPanelClassName} id="settings-terminal-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Terminal className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            终端
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            统一设置终端主题、字体、渲染和交互。
          </p>
        </div>
        <span className={terminalBadgeClassName}>终端设置</span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section
            className={terminalSubpanelClassName}
            id="settings-terminal-theme-panel"
            tabIndex={-1}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <Terminal className="h-4 w-4 text-zinc-400" />
              终端主题
            </div>
            <div className="mt-4 space-y-4">
              <TerminalSchemePicker
                label="浅色终端主题"
                onSelect={(lightColorScheme) =>
                  updateTerminal({ colorScheme: lightColorScheme, lightColorScheme })
                }
                value={normalizedSettings.terminal.lightColorScheme}
              />
              <TerminalSchemePicker
                label="暗色终端主题"
                onSelect={(darkColorScheme) =>
                  updateTerminal({ colorScheme: darkColorScheme, darkColorScheme })
                }
                value={normalizedSettings.terminal.darkColorScheme}
              />
            </div>
          </section>

          <section
            className={terminalSubpanelClassName}
            id="settings-terminal-font-panel"
            tabIndex={-1}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <Type className="h-4 w-4 text-zinc-400" />
              字体配置
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(96px,0.7fr)_minmax(96px,0.7fr)]">
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  终端字体
                </span>
                <Select
                  aria-label="终端字体"
                  className="mt-1"
                  onValueChange={(fontFamily) => updateTerminal({ fontFamily })}
                  options={terminalFontOptions}
                  value={normalizedSettings.terminal.fontFamily}
                />
              </label>
              <NumberSetting
                label="字号"
                max={24}
                min={10}
                onChange={(fontSize) => updateTerminal({ fontSize })}
                suffix="px"
                value={normalizedSettings.terminal.fontSize}
              />
              <NumberSetting
                label="行高"
                max={1.8}
                min={1}
                onChange={(lineHeight) => updateTerminal({ lineHeight })}
                step={0.05}
                value={normalizedSettings.terminal.lineHeight}
              />
              <label className="block md:col-span-3">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  字重
                </span>
                <Select
                  aria-label="终端字重"
                  className="mt-1"
                  onValueChange={(fontWeight) =>
                    updateTerminal({
                      fontWeight: fontWeight as TerminalAppearance["fontWeight"],
                    })
                  }
                  options={terminalFontWeightOptions}
                  value={normalizedSettings.terminal.fontWeight}
                />
              </label>
            </div>
            <TerminalAppearancePreview
              resolvedTheme={resolvedTheme}
              terminal={normalizedSettings.terminal}
            />
          </section>
        </div>

        <section
          className={terminalSubpanelClassName}
          id="settings-terminal-renderer-panel"
          tabIndex={-1}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Terminal className="h-4 w-4 text-zinc-400" />
                终端渲染
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                控制 xterm 绘制路径，高输出场景优先释放主线程压力。
              </p>
            </div>
            <span className={terminalBadgeClassName}>
              {rendererSnapshot.suggestedFallback === "cpu"
                ? "自动回退"
                : "运行正常"}
            </span>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {terminalRendererTypeOptions.map((option) => {
              const selected =
                normalizedSettings.terminal.rendererType === option.value;
              return (
                <button
                  aria-pressed={selected}
                  className={terminalChoiceButtonClassName(selected, "min-h-24 p-3")}
                  key={option.value}
                  onClick={() => updateTerminal({ rendererType: option.value })}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{option.label}</span>
                    {selected ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 opacity-80">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className={terminalSubpanelClassName}
          data-testid="managed-ssh-runtime-diagnostics"
          id="settings-terminal-runtime-diagnostics-panel"
          tabIndex={-1}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Activity className="h-4 w-4 text-zinc-400" />
                运行诊断
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Managed SSH、fallback、队列和重连状态。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  terminalBadgeClassName,
                  runtimeGate?.ready
                    ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-200"
                    : "border-amber-500/30 text-amber-700 dark:text-amber-200",
                )}
              >
                {runtimeGate?.statusLabel ?? "诊断加载中"}
              </span>
              <button
                aria-label="刷新运行诊断"
                className="kerminal-focus-ring kerminal-pressable flex h-8 w-8 items-center justify-center rounded-lg border text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
                disabled={runtimeDiagnosticsLoading}
                onClick={() => void refreshRuntimeDiagnostics()}
                type="button"
              >
                <RotateCcw
                  className={cn(
                    "h-4 w-4",
                    runtimeDiagnosticsLoading ? "animate-spin" : "",
                  )}
                />
              </button>
            </div>
          </div>

          {runtimeDiagnosticsError ? (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-100">
              {runtimeDiagnosticsError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <RuntimeMetric label="Managed sessions" value={runtimeDiagnostics?.managedSsh?.activeSessions ?? 0} />
            <RuntimeMetric label="Active channels" value={runtimeDiagnostics?.managedSsh?.activeChannels ?? 0} />
            <RuntimeMetric label="Queue depth" value={runtimeQueueDepth} />
            <RuntimeMetric label="Reconnecting" value={runtimeDiagnostics?.ssh?.reconnecting ?? 0} />
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="kerminal-solid-surface min-w-0 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                {runtimeGate?.ready ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                默认启用门禁
              </div>
              <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                <div className="flex justify-between gap-3">
                  <span>Fallback rate</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-100">
                    {formatPercent(runtimeGate?.fallbackRate ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Unknown errors</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-100">
                    {runtimeGate?.unknownErrorClassCount ?? 0}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Missing diagnostics</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-100">
                    {runtimeGate?.missingDiagnostics.length ?? 0}
                  </span>
                </div>
                {runtimeGate?.issues.length ? (
                  <ul className="space-y-1 pt-1">
                    {runtimeGate.issues.map((issue) => (
                      <li
                        className="rounded-lg bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-100"
                        key={`${issue.kind}:${issue.message}`}
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="kerminal-solid-surface min-w-0 rounded-xl border p-3">
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                错误分类与清理
              </div>
              <div className="mt-3 space-y-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                <RuntimeKeyValueRows
                  emptyLabel="无 SSH 错误分类"
                  rows={Object.entries(runtimeDiagnostics?.ssh?.errorClasses ?? {})}
                />
                <div className="flex justify-between gap-3 border-t border-zinc-200/70 pt-2 dark:border-zinc-800">
                  <span>Session cleanup</span>
                  <span className="font-mono text-zinc-800 dark:text-zinc-100">
                    {runtimeCleanupState}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <RuntimeSessionList snapshot={runtimeDiagnostics} />
            <RuntimeFallbackList snapshot={runtimeDiagnostics} />
          </div>
        </section>

        <section
          className={terminalSubpanelClassName}
          id="settings-terminal-interaction-panel"
          tabIndex={-1}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <MousePointerClick className="h-4 w-4 text-zinc-400" />
            终端交互
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
            <div className="grid gap-2 md:grid-cols-2">
              <PolicyToggle
                checked={normalizedSettings.terminal.selectionCopy}
                icon={MousePointerClick}
                label="选中复制"
                onChange={(selectionCopy) => updateTerminal({ selectionCopy })}
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.showTabNumbers}
                icon={Terminal}
                label="显示标签序号"
                onChange={(showTabNumbers) => updateTerminal({ showTabNumbers })}
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.confirmCloseTab}
                icon={RotateCcw}
                label="关闭标签前确认"
                onChange={(confirmCloseTab) =>
                  updateTerminal({ confirmCloseTab })
                }
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.macOptionIsMeta}
                icon={Terminal}
                label="将 macOS Option 键作为 Meta 键"
                onChange={(macOptionIsMeta) =>
                  updateTerminal({ macOptionIsMeta })
                }
              />
              <label className="kerminal-muted-surface block rounded-xl border px-3 py-2 md:col-span-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  右键行为
                </span>
                <Select
                  aria-label="终端右键行为"
                  className="mt-1"
                  onValueChange={(rightClickBehavior) =>
                    updateTerminal({
                      rightClickBehavior:
                        rightClickBehavior as TerminalAppearance["rightClickBehavior"],
                    })
                  }
                  options={terminalRightClickBehaviorOptions}
                  value={normalizedSettings.terminal.rightClickBehavior}
                />
              </label>
            </div>
            <div className="space-y-3">
              <PolicyToggle
                checked={normalizedSettings.terminal.cursorBlink}
                icon={Type}
                label="光标闪烁"
                onChange={(cursorBlink) => updateTerminal({ cursorBlink })}
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.autoReconnect}
                icon={RotateCcw}
                label="自动重连"
                onChange={(autoReconnect) => updateTerminal({ autoReconnect })}
              />
              <NumberSetting
                label="滚屏缓冲"
                max={50000}
                min={1000}
                onChange={(scrollback) => updateTerminal({ scrollback })}
                step={500}
                suffix="行"
                value={normalizedSettings.terminal.scrollback}
              />
            </div>
          </div>
        </section>

        <section
          className={terminalSubpanelClassName}
          id="settings-terminal-cursor-panel"
          tabIndex={-1}
        >
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            光标形态
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {terminalCursorStyleOptions.map((option) => {
              const selected =
                normalizedSettings.terminal.cursorStyle === option.value;
              return (
                <button
                  aria-label={`${option.label}光标：${option.description}`}
                  aria-pressed={selected}
                  className={terminalChoiceButtonClassName(selected, "p-3.5")}
                  key={option.value}
                  onClick={() => updateTerminal({ cursorStyle: option.value })}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{option.label}</span>
                    {selected ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <span className="mt-1.5 block min-h-10 text-xs leading-5 opacity-80">
                    {option.description}
                  </span>
                  <CursorStylePreview
                    blink={normalizedSettings.terminal.cursorBlink}
                    cursorStyle={option.value}
                  />
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="kerminal-solid-surface min-w-0 rounded-xl border px-3 py-2">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </div>
    </div>
  );
}

function RuntimeKeyValueRows({
  emptyLabel,
  rows,
}: {
  emptyLabel: string;
  rows: Array<[string, number]>;
}) {
  if (rows.length === 0) {
    return <div>{emptyLabel}</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <div className="flex justify-between gap-3" key={label}>
          <span className="min-w-0 truncate">{label}</span>
          <span className="font-mono text-zinc-800 dark:text-zinc-100">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function RuntimeSessionList({
  snapshot,
}: {
  snapshot: RuntimePerformanceSnapshot | null;
}) {
  const sessions = snapshot?.managedSsh?.sessions ?? [];
  return (
    <div className="kerminal-solid-surface min-w-0 rounded-xl border p-3">
      <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        Managed sessions
      </div>
      <div className="mt-3 space-y-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {sessions.length === 0 ? (
          <div>无活动 managed SSH session</div>
        ) : (
          sessions.map((session) => (
            <div
              className="rounded-lg border border-zinc-200/70 px-2 py-2 dark:border-zinc-800"
              key={session.sessionId}
            >
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{session.key.target}</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-100">
                  {session.state}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono">
                <span>channels={session.activeChannels}</span>
                <span>opened={session.openedChannels}</span>
                <span>pendingExec={session.pendingExecRequests}</span>
                <span>maxExec={session.maxConcurrentExecChannels}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(session.channelCounts).map(([channel, count]) => (
                  <span key={channel}>
                    {channel}:{count}
                  </span>
                ))}
              </div>
              {session.key.runtimeFlags.length > 0 ? (
                <div className="mt-1 truncate">
                  flags={session.key.runtimeFlags.join(",")}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RuntimeFallbackList({
  snapshot,
}: {
  snapshot: RuntimePerformanceSnapshot | null;
}) {
  const fallbacks = snapshot?.managedSsh?.recentLegacyFallbacks ?? [];
  return (
    <div className="kerminal-solid-surface min-w-0 rounded-xl border p-3">
      <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        Fallback reasons
      </div>
      <div className="mt-3 space-y-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        {fallbacks.length === 0 ? (
          <div>无 recent legacy fallback</div>
        ) : (
          fallbacks.map((fallback) => (
            <div
              className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-2 text-amber-800 dark:text-amber-100"
              key={`${fallback.capability}:${fallback.reason}:${fallback.lastAt}`}
            >
              <div className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{fallback.capability}</span>
                <span className="font-mono">{fallback.count}</span>
              </div>
              <div className="mt-1 break-words font-mono">{fallback.reason}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function runtimeDiagnosticsQueueDepth(
  snapshot: RuntimePerformanceSnapshot | null,
) {
  if (!snapshot) {
    return 0;
  }

  const pendingExec =
    snapshot.managedSsh?.sessions.reduce(
      (sum, session) => sum + session.pendingExecRequests,
      0,
    ) ?? 0;
  return (
    pendingExec +
    (snapshot.sftp?.preflight?.queued ?? 0) +
    (snapshot.suggestions?.queued ?? 0)
  );
}

function runtimeDiagnosticsCleanupState(
  snapshot: RuntimePerformanceSnapshot | null,
) {
  const sessions = snapshot?.managedSsh?.sessions ?? [];
  const closing = sessions.filter((session) => session.state === "closing").length;
  const failed = sessions.filter((session) => session.state === "failed").length;
  if (closing > 0 || failed > 0) {
    return `closing=${closing} failed=${failed}`;
  }
  return "idle";
}

function formatPercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}
