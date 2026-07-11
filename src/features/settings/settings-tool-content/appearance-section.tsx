import { Check, Image, Languages } from "lucide-react";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import {
  backgroundImageFitOptions,
  interfaceDensityOptions,
  interfaceLanguageOptions,
  type AppearanceSettings,
  type AppSettings,
} from "../settingsModel";
import { themeOptions } from "./options";

interface AppearanceSettingsSectionProps {
  chooseBackgroundImage: () => void;
  normalizedSettings: AppSettings;
  updateAppearance: (appearance: Partial<AppearanceSettings>) => void;
  updateSettings: (settings: AppSettings) => void;
}

const appearanceCompactPanelClassName =
  "kerminal-solid-surface rounded-2xl border p-4";
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
  normalizedSettings,
  updateAppearance,
  updateSettings,
}: AppearanceSettingsSectionProps) {
  return (
    <div className="space-y-4" id="settings-appearance-panel">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <section
          className={appearanceCompactPanelClassName}
          id="settings-interface-appearance-panel"
          tabIndex={-1}
        >
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
                  const selected = normalizedSettings.themeMode === option.value;
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

        <section
          className={appearanceCompactPanelClassName}
          id="settings-background-panel"
          tabIndex={-1}
        >
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
                  normalizedSettings.appearance.backgroundFit === option.value;
                return (
                  <button
                    aria-pressed={selected}
                    className={appearanceChoiceButtonClassName(
                      selected,
                      "min-h-24 px-3 py-2.5",
                    )}
                    key={option.value}
                    onClick={() => updateAppearance({ backgroundFit: option.value })}
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
  );
}
