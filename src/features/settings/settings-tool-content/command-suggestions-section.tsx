import { Network, Puzzle, ShieldCheck, Terminal } from "lucide-react";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import type {
  AppSettings,
  TerminalInlineSuggestionAcceptKey,
  TerminalInlineSuggestionProductionHostPolicy,
  TerminalInlineSuggestionProviderSettings,
  TerminalInlineSuggestionSettings,
} from "../settingsModel";
import {
  inlineSuggestionAcceptKeyOptions,
  inlineSuggestionProductionHostPolicyOptions,
  inlineSuggestionProviderOptions,
} from "./options";
import {
  InlineSuggestionPolicyStatus,
  InlineSuggestionProviderToggle,
} from "./inline-suggestions";

interface CommandSuggestionSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateTerminalInlineSuggestion: (
    inlineSuggestion: Partial<TerminalInlineSuggestionSettings>,
  ) => void;
  updateTerminalInlineSuggestionProvider: (
    provider: keyof TerminalInlineSuggestionProviderSettings,
    enabled: boolean,
  ) => void;
}

const suggestionsPanelClassName =
  "kerminal-solid-surface rounded-2xl border p-5";
const suggestionsSubpanelClassName =
  "kerminal-muted-surface rounded-xl border p-4";
const suggestionsInsetPanelClassName =
  "kerminal-muted-surface rounded-xl border p-3";
const suggestionsBadgeClassName =
  "kerminal-muted-surface rounded-full border px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400";

export function CommandSuggestionSettingsSection({
  normalizedSettings,
  updateTerminalInlineSuggestion,
  updateTerminalInlineSuggestionProvider,
}: CommandSuggestionSettingsSectionProps) {
  const inlineSuggestion = normalizedSettings.terminal.inlineSuggestion;

  return (
    <section
      className={suggestionsPanelClassName}
      id="settings-suggestions-panel"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Terminal className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            命令提示
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            控制灰色命令提示的来源、接受策略和远端探测。
          </p>
        </div>
        <span className={suggestionsBadgeClassName}>主机免安装</span>
      </div>

      <section
        className={cn(suggestionsSubpanelClassName, "mt-5")}
        id="settings-command-suggestions-policy-panel"
        tabIndex={-1}
      >
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
              inlineSuggestion.enabled
                ? "border-sky-500/30 bg-[var(--surface-selected)] text-sky-800 shadow-sm shadow-sky-950/5 dark:border-sky-300/25 dark:text-sky-100"
                : "kerminal-muted-surface text-zinc-600 dark:text-zinc-300",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span className="truncate">
                  {inlineSuggestion.enabled ? "灰色提示已启用" : "灰色提示已暂停"}
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
              checked={inlineSuggestion.enabled}
              onCheckedChange={(enabled) =>
                updateTerminalInlineSuggestion({ enabled })
              }
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
          <div className={suggestionsInsetPanelClassName}>
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
                      acceptKey: value as TerminalInlineSuggestionAcceptKey,
                    })
                  }
                  options={inlineSuggestionAcceptKeyOptions}
                  value={inlineSuggestion.acceptKey}
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
                  value={inlineSuggestion.productionHostPolicy}
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
                  checked={inlineSuggestion.remoteProbeEnabled}
                  onCheckedChange={(remoteProbeEnabled) =>
                    updateTerminalInlineSuggestion({
                      remoteProbeEnabled,
                    })
                  }
                />
              </div>
            </div>
            <InlineSuggestionPolicyStatus inlineSuggestion={inlineSuggestion} />
          </div>

          <div
            className={suggestionsInsetPanelClassName}
            id="settings-command-suggestions-providers-panel"
            tabIndex={-1}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              <Puzzle className="h-3.5 w-3.5 text-zinc-400" />
              Provider 开关
            </div>
            <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 xl:grid-cols-1">
              {inlineSuggestionProviderOptions.map((option) => (
                <InlineSuggestionProviderToggle
                  checked={inlineSuggestion.providers[option.key]}
                  icon={option.icon}
                  key={option.key}
                  label={option.label}
                  onChange={(enabled) =>
                    updateTerminalInlineSuggestionProvider(option.key, enabled)
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
