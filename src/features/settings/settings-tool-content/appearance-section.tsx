import {
  Check,
  Clipboard,
  Hash,
  Image,
  Languages,
  MonitorCog,
  MousePointerClick,
  Network,
  Puzzle,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Type,
} from "lucide-react";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import type {
  CommandSuggestionDiagnosticsCleanupResult,
  CommandSuggestionTelemetrySummary,
} from "../../../lib/terminalSuggestionApi";
import {
  backgroundImageFitOptions,
  interfaceDensityOptions,
  interfaceLanguageOptions,
  terminalCursorStyleOptions,
  terminalFontOptions,
  terminalFontWeightOptions,
  terminalRightClickBehaviorOptions,
  type AppearanceSettings,
  type AppSettings,
  type ResolvedTheme,
  type TerminalAppearance,
  type TerminalInlineSuggestionAcceptKey,
  type TerminalInlineSuggestionProductionHostPolicy,
  type TerminalInlineSuggestionProviderSettings,
  type TerminalInlineSuggestionSettings,
} from "../settingsModel";
import {
  inlineSuggestionAcceptKeyOptions,
  inlineSuggestionProductionHostPolicyOptions,
  inlineSuggestionProviderOptions,
  themeOptions,
} from "./options";
import {
  InlineSuggestionPolicyStatus,
  InlineSuggestionProviderToggle,
  InlineSuggestionTelemetryPanel,
} from "./inline-suggestions";
import { NumberSetting, PolicyToggle } from "./shared-controls";
import {
  CursorStylePreview,
  TerminalAppearancePreview,
  TerminalSchemePicker,
} from "./terminal-preview";
import type {
  SuggestionCleanupState,
  SuggestionTelemetryLoadState,
} from "./types";

interface AppearanceSettingsSectionProps {
  chooseBackgroundImage: () => void;
  cleanupSuggestionDiagnostics: (
    resetPersistedTelemetry: boolean,
  ) => Promise<void>;
  loadSuggestionTelemetry: () => Promise<void>;
  normalizedSettings: AppSettings;
  resolvedTheme: ResolvedTheme;
  suggestionCleanupError: string | null;
  suggestionCleanupResult: CommandSuggestionDiagnosticsCleanupResult | null;
  suggestionCleanupState: SuggestionCleanupState;
  suggestionTelemetry: CommandSuggestionTelemetrySummary | null;
  suggestionTelemetryError: string | null;
  suggestionTelemetryState: SuggestionTelemetryLoadState;
  updateAppearance: (appearance: Partial<AppearanceSettings>) => void;
  updateSettings: (settings: AppSettings) => void;
  updateTerminal: (terminal: Partial<TerminalAppearance>) => void;
  updateTerminalInlineSuggestion: (
    inlineSuggestion: Partial<TerminalInlineSuggestionSettings>,
  ) => void;
  updateTerminalInlineSuggestionProvider: (
    provider: keyof TerminalInlineSuggestionProviderSettings,
    enabled: boolean,
  ) => void;
}

const appearancePanelClassName = "kerminal-solid-surface rounded-2xl border p-5";
const appearanceCompactPanelClassName =
  "kerminal-solid-surface rounded-2xl border p-4";
const appearanceSubpanelClassName =
  "kerminal-muted-surface rounded-xl border p-4";
const appearanceInsetPanelClassName =
  "kerminal-muted-surface rounded-xl border p-3";
const appearanceBadgeClassName =
  "kerminal-muted-surface rounded-full border px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400";
const appearanceSmallBadgeClassName =
  "kerminal-muted-surface rounded-full border px-2 py-1 text-[11px] text-zinc-500 dark:text-zinc-400";
const appearanceInlineButtonClassName =
  "kerminal-focus-ring kerminal-pressable kerminal-muted-surface inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200";
const appearanceFieldClassName =
  "kerminal-field-surface mt-1 h-10 w-full rounded-xl border px-3 text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

function appearanceChoiceButtonClassName(
  selected: boolean,
  className?: string,
) {
  return cn(
    "kerminal-focus-ring kerminal-pressable rounded-xl border text-left transition",
    selected
      ? "border-sky-500/45 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 dark:border-sky-300/35 dark:text-sky-100 dark:ring-sky-300/15"
      : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
    className,
  );
}

export function AppearanceSettingsSection({
  chooseBackgroundImage,
  cleanupSuggestionDiagnostics,
  loadSuggestionTelemetry,
  normalizedSettings,
  resolvedTheme,
  suggestionCleanupError,
  suggestionCleanupResult,
  suggestionCleanupState,
  suggestionTelemetry,
  suggestionTelemetryError,
  suggestionTelemetryState,
  updateAppearance,
  updateSettings,
  updateTerminal,
  updateTerminalInlineSuggestion,
  updateTerminalInlineSuggestionProvider,
}: AppearanceSettingsSectionProps) {
  return (
    <>
      <div className="space-y-4" id="settings-appearance-panel">
        <section className={appearancePanelClassName}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                <MonitorCog className="h-4 w-4 text-sky-500 dark:text-sky-300" />
                外观
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                语言、主题、背景和终端视觉会立即保存。
              </p>
            </div>
            <div className={appearanceBadgeClassName}>
              主题外观
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <section className={appearanceCompactPanelClassName}>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Languages className="h-4 w-4 text-zinc-400" />
              基础外观
            </div>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  界面语言
                </span>
                <Select
                  aria-label="界面语言"
                  className="mt-1"
                  onValueChange={(value) =>
                    updateAppearance({
                      interfaceLanguage:
                        value as AppearanceSettings["interfaceLanguage"],
                    })
                  }
                  options={interfaceLanguageOptions}
                  value={normalizedSettings.appearance.interfaceLanguage}
                />
              </label>

              <div>
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  应用外观
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {themeOptions.map((option) => {
                    const selected =
                      normalizedSettings.themeMode === option.value;
                    const Icon = option.icon;

                    return (
                      <button
                        aria-pressed={selected}
                        className={appearanceChoiceButtonClassName(
                          selected,
                          "flex min-h-20 flex-col items-center justify-center gap-2 px-2 text-sm",
                        )}
                        key={option.value}
                        onClick={() =>
                          updateSettings({
                            ...normalizedSettings,
                            themeMode: option.value,
                          })
                        }
                        type="button"
                      >
                        <Icon className="h-4 w-4" />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="flex items-center justify-between gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  界面透明度
                  <span className="text-sm text-zinc-700 dark:text-zinc-200">
                    {normalizedSettings.appearance.windowOpacity}%
                  </span>
                </span>
                <input
                  aria-label="界面透明度"
                  className="mt-3 h-2 w-full accent-sky-500"
                  max={100}
                  min={35}
                  onChange={(event) =>
                    updateAppearance({
                      windowOpacity: Number(event.currentTarget.value),
                    })
                  }
                  type="range"
                  value={normalizedSettings.appearance.windowOpacity}
                />
              </label>

              <div>
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  界面密度
                </div>
                <div className="mt-2 grid gap-2">
                  {interfaceDensityOptions.map((option) => {
                    const selected =
                      normalizedSettings.interfaceDensity === option.value;
                    return (
                      <button
                        aria-pressed={selected}
                        className={appearanceChoiceButtonClassName(
                          selected,
                          "px-3 py-2.5",
                        )}
                        key={option.value}
                        onClick={() =>
                          updateSettings({
                            ...normalizedSettings,
                            interfaceDensity: option.value,
                          })
                        }
                        type="button"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">
                            {option.label}
                          </span>
                          {selected ? (
                            <Check className="h-4 w-4 text-sky-500 dark:text-sky-200" />
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs leading-5 opacity-80">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className={appearanceCompactPanelClassName}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <Image className="h-4 w-4 text-zinc-400" />
                  主页面背景
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  在工作台底层显示本地图片。
                </p>
              </div>
              <Switch
                aria-label="启用主页面背景"
                checked={normalizedSettings.appearance.backgroundEnabled}
                onCheckedChange={(backgroundEnabled) =>
                  updateAppearance({
                    backgroundEnabled,
                  })
                }
              />
            </div>

            <label className="mt-5 block">
              <span className="flex items-center justify-between gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                背景透明度
                <span className="text-sm text-zinc-700 dark:text-zinc-200">
                  {normalizedSettings.appearance.backgroundOpacity}%
                </span>
              </span>
              <input
                aria-label="背景透明度"
                className="mt-3 h-2 w-full accent-sky-500"
                max={100}
                min={0}
                onChange={(event) =>
                  updateAppearance({
                    backgroundOpacity: Number(event.currentTarget.value),
                  })
                }
                type="range"
                value={normalizedSettings.appearance.backgroundOpacity}
              />
            </label>

            <div className="mt-5">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                背景铺放
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {backgroundImageFitOptions.map((option) => {
                  const selected =
                    normalizedSettings.appearance.backgroundFit ===
                    option.value;
                  return (
                    <button
                      aria-pressed={selected}
                      className={appearanceChoiceButtonClassName(
                        selected,
                        "min-h-24 px-3 py-2.5",
                      )}
                      key={option.value}
                      onClick={() =>
                        updateAppearance({ backgroundFit: option.value })
                      }
                      type="button"
                    >
                      <span className="block text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs leading-5 opacity-80">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  背景图路径
                </span>
                <input
                  aria-label="背景图路径"
                  className={appearanceFieldClassName}
                  onChange={(event) =>
                    updateAppearance({
                      backgroundImagePath: event.currentTarget.value,
                    })
                  }
                  placeholder="例如 C:\\Users\\name\\Pictures\\bg.png"
                  value={normalizedSettings.appearance.backgroundImagePath}
                />
              </label>
              <button
                className={cn("mt-auto", appearanceInlineButtonClassName)}
                onClick={chooseBackgroundImage}
                type="button"
              >
                <Image className="h-4 w-4" />
                浏览
              </button>
            </div>
          </section>
        </div>
      </div>
      <section
        className={appearancePanelClassName}
        id="settings-terminal-panel"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              <Terminal className="h-4 w-4 text-sky-500 dark:text-sky-300" />
              终端外观
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              统一设置终端主题、字体、光标和交互。
            </p>
          </div>
          <span className={appearanceBadgeClassName}>
            终端设置
          </span>
        </div>

        <div className="mt-5 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className={appearanceSubpanelClassName}>
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Terminal className="h-4 w-4 text-zinc-400" />
                终端主题
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                浅色、暗色分别保存。
              </p>
              <div className="mt-4 space-y-4">
                <TerminalSchemePicker
                  label="浅色终端主题"
                  onSelect={(lightColorScheme) =>
                    updateTerminal({
                      colorScheme: lightColorScheme,
                      lightColorScheme,
                    })
                  }
                  value={normalizedSettings.terminal.lightColorScheme}
                />

                <TerminalSchemePicker
                  label="暗色终端主题"
                  onSelect={(darkColorScheme) =>
                    updateTerminal({
                      colorScheme: darkColorScheme,
                      darkColorScheme,
                    })
                  }
                  value={normalizedSettings.terminal.darkColorScheme}
                />
              </div>
            </section>

            <section className={appearanceSubpanelClassName}>
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
                    onValueChange={(fontFamily) =>
                      updateTerminal({ fontFamily })
                    }
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
                <div className="md:col-span-3">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    终端字重
                  </span>
                  <Select
                    aria-label="终端字重"
                    className="mt-1"
                    onValueChange={(value) =>
                      updateTerminal({
                        fontWeight: value as TerminalAppearance["fontWeight"],
                      })
                    }
                    options={terminalFontWeightOptions}
                    value={normalizedSettings.terminal.fontWeight}
                  />
                </div>
              </div>
              <TerminalAppearancePreview
                resolvedTheme={resolvedTheme}
                terminal={normalizedSettings.terminal}
              />
            </section>
          </div>

          <section className={appearanceSubpanelClassName}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <MousePointerClick className="h-4 w-4 text-zinc-400" />
                  终端交互
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  输入、鼠标和会话设置。
                </p>
              </div>
              <span className={appearanceSmallBadgeClassName}>
                实时预览
              </span>
            </div>

            <div className="mt-4 space-y-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      常用行为
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <PolicyToggle
                        checked={normalizedSettings.terminal.selectionCopy}
                        icon={Clipboard}
                        label="选中复制"
                        onChange={(selectionCopy) =>
                          updateTerminal({ selectionCopy })
                        }
                      />
                      <PolicyToggle
                        checked={normalizedSettings.terminal.showTabNumbers}
                        icon={Hash}
                        label="显示标签序号"
                        onChange={(showTabNumbers) =>
                          updateTerminal({ showTabNumbers })
                        }
                      />
                      <PolicyToggle
                        checked={normalizedSettings.terminal.confirmCloseTab}
                        label="关闭标签前确认"
                        onChange={(confirmCloseTab) =>
                          updateTerminal({ confirmCloseTab })
                        }
                      />
                      <PolicyToggle
                        checked={normalizedSettings.terminal.macOptionIsMeta}
                        label="将 macOS Option 键作为 Meta 键"
                        onChange={(macOptionIsMeta) =>
                          updateTerminal({ macOptionIsMeta })
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      右键行为
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      {terminalRightClickBehaviorOptions.map((option) => {
                        const selected =
                          normalizedSettings.terminal.rightClickBehavior ===
                          option.value;
                        return (
                          <button
                            aria-pressed={selected}
                            className={appearanceChoiceButtonClassName(
                              selected,
                              "min-h-24 px-3 py-2.5",
                            )}
                            key={option.value}
                            onClick={() =>
                              updateTerminal({
                                rightClickBehavior: option.value,
                              })
                            }
                            type="button"
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {option.label}
                              </span>
                              {selected ? (
                                <Check className="h-4 w-4 text-sky-500 dark:text-sky-200" />
                              ) : null}
                            </span>
                            <span className="mt-1 block text-xs leading-5 opacity-80">
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      会话辅助
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      <PolicyToggle
                        checked={normalizedSettings.terminal.cursorBlink}
                        icon={Type}
                        label="光标闪烁"
                        onChange={(cursorBlink) =>
                          updateTerminal({ cursorBlink })
                        }
                      />
                      <PolicyToggle
                        checked={normalizedSettings.terminal.autoReconnect}
                        icon={RotateCcw}
                        label="自动重连"
                        onChange={(autoReconnect) =>
                          updateTerminal({ autoReconnect })
                        }
                      />
                    </div>
                  </div>

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

              <section className={appearanceSubpanelClassName}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      <Terminal className="h-4 w-4 text-zinc-400" />
                      命令灰色提示
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      控制历史、CLI spec、远端预热和反馈。
                    </p>
                  </div>
                  <div
                    className={cn(
                      "flex min-w-[240px] items-center justify-between gap-3 rounded-xl border px-3 py-2",
                      normalizedSettings.terminal.inlineSuggestion.enabled
                        ? "border-sky-500/30 bg-[var(--surface-selected)] text-sky-800 shadow-sm shadow-sky-950/5 dark:border-sky-300/25 dark:text-sky-100"
                        : "kerminal-muted-surface text-zinc-600 dark:text-zinc-300",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <span className="truncate">
                          {normalizedSettings.terminal.inlineSuggestion.enabled
                            ? "灰色提示已启用"
                            : "灰色提示已暂停"}
                        </span>
                        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                          主机免安装
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        生成、接受和反馈受控
                      </div>
                    </div>
                    <Switch
                      aria-label="启用灰色提示"
                      checked={
                        normalizedSettings.terminal.inlineSuggestion.enabled
                      }
                      onCheckedChange={(enabled) =>
                        updateTerminalInlineSuggestion({ enabled })
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
                  <div className={appearanceInsetPanelClassName}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                      策略与接受
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <label className="kerminal-muted-surface block rounded-xl border px-3 py-2">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          接受按键
                        </span>
                        <Select
                          aria-label="灰色提示接受按键"
                          className="mt-1"
                          onValueChange={(value) =>
                            updateTerminalInlineSuggestion({
                              acceptKey:
                                value as TerminalInlineSuggestionAcceptKey,
                            })
                          }
                          options={inlineSuggestionAcceptKeyOptions}
                          value={
                            normalizedSettings.terminal.inlineSuggestion
                              .acceptKey
                          }
                        />
                      </label>
                      <label className="kerminal-muted-surface block rounded-xl border px-3 py-2">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          生产主机策略
                        </span>
                        <Select
                          aria-label="灰色提示生产主机策略"
                          className="mt-1"
                          onValueChange={(value) =>
                            updateTerminalInlineSuggestion({
                              productionHostPolicy:
                                value as TerminalInlineSuggestionProductionHostPolicy,
                            })
                          }
                          options={inlineSuggestionProductionHostPolicyOptions}
                          value={
                            normalizedSettings.terminal.inlineSuggestion
                              .productionHostPolicy
                          }
                        />
                      </label>
                      <div className="kerminal-muted-surface flex min-h-10 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Network className="h-4 w-4 shrink-0 text-zinc-400" />
                          <span className="min-w-0 truncate text-left leading-5">
                            允许远端只读探测
                          </span>
                        </span>
                        <Switch
                          aria-label="允许远端只读探测"
                          checked={
                            normalizedSettings.terminal.inlineSuggestion
                              .remoteProbeEnabled
                          }
                          onCheckedChange={(remoteProbeEnabled) =>
                            updateTerminalInlineSuggestion({
                              remoteProbeEnabled,
                            })
                          }
                        />
                      </div>
                    </div>
                    <InlineSuggestionPolicyStatus
                      inlineSuggestion={
                        normalizedSettings.terminal.inlineSuggestion
                      }
                    />
                  </div>

                  <div className={appearanceInsetPanelClassName}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      <Puzzle className="h-3.5 w-3.5 text-zinc-400" />
                      Provider 开关
                    </div>
                    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 xl:grid-cols-1">
                      {inlineSuggestionProviderOptions.map((option) => (
                        <InlineSuggestionProviderToggle
                          checked={
                            normalizedSettings.terminal.inlineSuggestion
                              .providers[option.key]
                          }
                          icon={option.icon}
                          key={option.key}
                          label={option.label}
                          onChange={(enabled) =>
                            updateTerminalInlineSuggestionProvider(
                              option.key,
                              enabled,
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <InlineSuggestionTelemetryPanel
                    auditRetentionDays={
                      normalizedSettings.terminal.inlineSuggestion
                        .auditRetentionDays
                    }
                    cleanupError={suggestionCleanupError}
                    cleanupResult={suggestionCleanupResult}
                    cleanupState={suggestionCleanupState}
                    error={suggestionTelemetryError}
                    feedbackRetentionDays={
                      normalizedSettings.terminal.inlineSuggestion
                        .feedbackRetentionDays
                    }
                    onAuditRetentionDaysChange={(auditRetentionDays) =>
                      updateTerminalInlineSuggestion({ auditRetentionDays })
                    }
                    onCleanupExpired={() =>
                      void cleanupSuggestionDiagnostics(false)
                    }
                    onFeedbackRetentionDaysChange={(feedbackRetentionDays) =>
                      updateTerminalInlineSuggestion({
                        feedbackRetentionDays,
                      })
                    }
                    onRefresh={() => void loadSuggestionTelemetry()}
                    onResetTelemetry={() =>
                      void cleanupSuggestionDiagnostics(true)
                    }
                    state={suggestionTelemetryState}
                    telemetry={suggestionTelemetry}
                  />
                </div>
              </section>

              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      光标形态
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      直接看输入点在命令行里的占位方式。
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {terminalCursorStyleOptions.map((option) => {
                    const selected =
                      normalizedSettings.terminal.cursorStyle === option.value;
                    return (
                      <button
                        aria-label={`${option.label}光标：${option.description}`}
                        aria-pressed={selected}
                        className={appearanceChoiceButtonClassName(
                          selected,
                          "rounded-2xl p-3.5",
                        )}
                        key={option.value}
                        onClick={() =>
                          updateTerminal({ cursorStyle: option.value })
                        }
                        type="button"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">
                            {option.label}
                          </span>
                          {selected ? (
                            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white dark:bg-sky-300 dark:text-zinc-950">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
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
              </div>
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
