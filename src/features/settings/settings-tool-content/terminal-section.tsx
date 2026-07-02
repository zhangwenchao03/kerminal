import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Check,
  MousePointerClick,
  RotateCcw,
  Terminal,
  Type,
} from "lucide-react";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/cn";
import { terminalRendererRegistry } from "../../terminal/terminalRendererRegistry";
import {
  collectTerminalRuntimePerformanceSnapshot,
  subscribeTerminalRuntimeDiagnostics,
} from "../../terminal/terminalRuntimeDiagnosticsStore";
import type { RuntimePerformanceSnapshot } from "../../terminal/terminalRuntimeDiagnostics";
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

interface TerminalSettingsSectionProps {
  normalizedSettings: AppSettings;
  resolvedTheme: ResolvedTheme;
  updateTerminal: (terminal: Partial<TerminalAppearance>) => void;
}

const terminalPanelClassName = "kerminal-solid-surface rounded-2xl border p-5";
const terminalSubpanelClassName =
  "kerminal-muted-surface rounded-xl border p-4";
const terminalInsetPanelClassName =
  "kerminal-muted-surface rounded-xl border p-3";
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
  const [runtimeSnapshot, setRuntimeSnapshot] =
    useState<RuntimePerformanceSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void collectTerminalRuntimePerformanceSnapshot().then((snapshot) => {
        if (!disposed) {
          setRuntimeSnapshot(snapshot);
        }
      });
    };
    refresh();
    const unsubscribe = subscribeTerminalRuntimeDiagnostics(refresh);
    const timerId = window.setInterval(refresh, 1500);
    return () => {
      disposed = true;
      unsubscribe();
      window.clearInterval(timerId);
    };
  }, []);

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

          <div className={cn(terminalInsetPanelClassName, "mt-3")}>
            <dl className="grid gap-2 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-4">
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>GPU 分屏</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {rendererSnapshot.effectiveGpuPanes}/
                  {rendererSnapshot.activeControllers}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>隐藏分屏</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {rendererSnapshot.hiddenControllers}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>WebGL Canvas</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {rendererSnapshot.webglCanvasCount}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>回退</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {rendererSnapshot.suggestedFallback ?? "无"}
                </dd>
              </div>
            </dl>
          </div>
          <div className={cn(terminalInsetPanelClassName, "mt-3")}>
            <dl className="grid gap-2 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-4">
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>输出待写入</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {runtimeSnapshot?.terminalOutput?.totalPendingBytes ?? 0} B
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>PTY 待 flush</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {runtimeSnapshot?.ptyPump?.totalPendingBytes ?? 0} B
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>建议队列</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {runtimeSnapshot?.suggestions?.queued ?? 0}/
                  {runtimeSnapshot?.suggestions?.activeTasks ?? 0}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 sm:block">
                <dt>SFTP 传输</dt>
                <dd className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {runtimeSnapshot?.sftp?.transfers.activeTransfers ?? 0} active
                </dd>
              </div>
            </dl>
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
