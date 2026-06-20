import { Info, Keyboard, MonitorCog } from "lucide-react";
import { cn } from "../../../lib/cn";
import { bindingForPlatform } from "../keybindingUtils";
import type { AppSettings, KeybindingPlatform, KeybindingScope } from "../settingsModel";
import { keybindingPlatformOptions } from "./options";
import { KeybindingCell, SettingsMetricItem, scopeLabel } from "./shared-controls";

interface KeybindingsSettingsSectionProps {
  normalizedSettings: AppSettings;
  selectedKeybindingPlatform: KeybindingPlatform;
  selectedKeybindingPlatformLabel: string;
  setSelectedKeybindingPlatform: (platform: KeybindingPlatform) => void;
}

export function KeybindingsSettingsSection({
  normalizedSettings,
  selectedKeybindingPlatform,
  selectedKeybindingPlatformLabel,
  setSelectedKeybindingPlatform,
}: KeybindingsSettingsSectionProps) {
  return (
          <section
            className="rounded-2xl border border-black/8 bg-white/80 p-5 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20"
            id="settings-keybindings-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  <Keyboard className="h-4 w-4 text-sky-500 dark:text-sky-300" />
                  快捷键
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  默认按键尽量贴近 IntelliJ IDEA
                  keymap，同时保留终端高频操作的通用习惯。使用上方切换查看不同平台。
                </p>
              </div>
              <div
                aria-label="快捷键平台"
                className="inline-grid grid-cols-2 rounded-xl border border-black/8 bg-black/[0.03] p-1 dark:border-white/8 dark:bg-black/20"
                role="tablist"
              >
                {keybindingPlatformOptions.map((platform) => {
                  const selected =
                    selectedKeybindingPlatform === platform.value;
                  return (
                    <button
                      aria-selected={selected}
                      className={cn(
                        "h-8 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-500/15",
                        selected
                          ? "bg-white text-sky-700 shadow-sm dark:bg-white/12 dark:text-sky-100"
                          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                      )}
                      key={platform.value}
                      onClick={() =>
                        setSelectedKeybindingPlatform(platform.value)
                      }
                      role="tab"
                      type="button"
                    >
                      {platform.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <SettingsMetricItem
                description="当前展示这一平台的组合键。"
                icon={MonitorCog}
                label="当前平台"
                value={selectedKeybindingPlatformLabel}
              />
              <SettingsMetricItem
                description="默认习惯保持一致，降低迁移成本。"
                icon={Keyboard}
                label="默认风格"
                value="IntelliJ IDEA"
              />
              <SettingsMetricItem
                description="当前版本展示固定默认映射。"
                icon={Info}
                label="编辑状态"
                value="只读预览"
              />
            </div>

            <div className="mt-5 space-y-4">
              {(["global", "terminal", "workspace"] as KeybindingScope[]).map(
                (scope) => {
                  const scopedKeybindings =
                    normalizedSettings.keybindings.filter(
                      (keybinding) => keybinding.scope === scope,
                    );

                  if (scopedKeybindings.length === 0) {
                    return null;
                  }

                  return (
                    <section
                      className="rounded-xl border border-black/8 bg-black/[0.025] p-3 dark:border-white/8 dark:bg-black/20"
                      key={scope}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          {scopeLabel(scope)}快捷键
                        </div>
                        <span className="rounded-full border border-black/8 bg-white/70 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-white/8 dark:bg-white/8 dark:text-zinc-400">
                          {scopedKeybindings.length} 项
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {scopedKeybindings.map((keybinding) => (
                          <div
                            className="grid gap-3 rounded-xl border border-black/8 bg-white/70 px-3 py-3 dark:border-white/8 dark:bg-white/6 lg:grid-cols-[minmax(0,1fr)_minmax(150px,0.3fr)]"
                            key={keybinding.action}
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                {keybinding.label}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                                {keybinding.description}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
                                <span className="rounded-full border border-black/8 bg-black/[0.03] px-2 py-0.5 dark:border-white/8 dark:bg-black/20">
                                  {scopeLabel(keybinding.scope)}
                                </span>
                                <span className="rounded-full border border-black/8 bg-black/[0.03] px-2 py-0.5 font-mono dark:border-white/8 dark:bg-black/20">
                                  {keybinding.action}
                                </span>
                              </div>
                            </div>
                            <KeybindingCell
                              label={selectedKeybindingPlatformLabel}
                              value={bindingForPlatform(
                                keybinding,
                                selectedKeybindingPlatform,
                              )}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                },
              )}
            </div>
            <p className="mt-4 rounded-xl border border-black/8 bg-black/[0.025] px-3 py-2 text-xs leading-5 text-zinc-500 dark:border-white/8 dark:bg-black/20 dark:text-zinc-400">
              当前版本先锁定默认快捷键；完整编辑、冲突检测和自定义 keymap
              会在后续切片接入。
            </p>
          </section>
  );
}
