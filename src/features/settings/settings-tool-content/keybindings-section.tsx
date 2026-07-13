import { Keyboard, RotateCcw } from "lucide-react";
import { cn } from "../../../lib/cn";
import { bindingForPlatform } from "../keybindingUtils";
import {
  defaultKeybindings,
  type AppSettings,
  type KeybindingPlatform,
  type KeybindingScope,
  type KeybindingSetting,
} from "../settingsModel";
import { keybindingPlatformOptions } from "./options";
import {
  KeybindingCell,
  scopeLabel,
} from "./shared-controls";

interface KeybindingsSettingsSectionProps {
  normalizedSettings: AppSettings;
  selectedKeybindingPlatform: KeybindingPlatform;
  selectedKeybindingPlatformLabel: string;
  setSelectedKeybindingPlatform: (platform: KeybindingPlatform) => void;
  updateSettings: (settings: AppSettings) => void;
}

const keybindingsPanelClassName =
  "kerminal-solid-surface rounded-[var(--radius-panel)] border p-4";
const keybindingsSubpanelClassName =
  "border-t border-[var(--border-subtle)] pt-3";
const keybindingsTabListClassName =
  "kerminal-muted-surface inline-grid grid-cols-2 rounded-[var(--radius-control)] border p-0.5";
const keybindingsBadgeClassName =
  "kerminal-muted-surface rounded-full border px-2 py-0.5 text-[11px] text-zinc-500 dark:text-zinc-400";
const keybindingsInputClassName =
  "kerminal-field-surface h-9 w-full rounded-[var(--radius-control)] border px-2.5 font-mono text-xs text-[var(--text-primary)] placeholder:text-zinc-400 dark:placeholder:text-zinc-500";
const keybindingsIconButtonClassName =
  "kerminal-focus-ring kerminal-pressable inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-field)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50";

function keybindingsTabClassName(selected: boolean) {
  return cn(
    "kerminal-focus-ring kerminal-pressable h-8 rounded-[var(--radius-control)] px-3 text-[13px] font-medium transition",
    selected
      ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
  );
}

export function KeybindingsSettingsSection({
  normalizedSettings,
  selectedKeybindingPlatform,
  selectedKeybindingPlatformLabel,
  setSelectedKeybindingPlatform,
  updateSettings,
}: KeybindingsSettingsSectionProps) {
  const defaultKeybindingsByAction = new Map(
    defaultKeybindings.map((keybinding) => [keybinding.action, keybinding]),
  );
  const updateKeybinding = (
    keybinding: KeybindingSetting,
    platform: KeybindingPlatform,
    binding: string,
  ) => {
    const nextKeybinding = {
      ...keybinding,
      binding: platform === "windows" ? binding : keybinding.binding,
      macBinding: platform === "mac" ? binding : keybinding.macBinding,
      windowsBinding:
        platform === "windows" ? binding : keybinding.windowsBinding,
    };

    updateSettings({
      ...normalizedSettings,
      keybindings: normalizedSettings.keybindings.map((item) =>
        item.action === keybinding.action ? nextKeybinding : item,
      ),
    });
  };
  const resetKeybinding = (keybinding: KeybindingSetting) => {
    const defaultKeybinding = defaultKeybindingsByAction.get(keybinding.action);
    if (!defaultKeybinding) {
      return;
    }

    updateSettings({
      ...normalizedSettings,
      keybindings: normalizedSettings.keybindings.map((item) =>
        item.action === keybinding.action ? defaultKeybinding : item,
      ),
    });
  };

  return (
    <section
      className={keybindingsPanelClassName}
      id="settings-keybindings-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <Keyboard className="h-4 w-4 text-sky-500 dark:text-sky-300" />
          快捷键
        </div>
        <div
          aria-label="快捷键平台"
          className={keybindingsTabListClassName}
          role="tablist"
        >
          {keybindingPlatformOptions.map((platform) => {
            const selected = selectedKeybindingPlatform === platform.value;
            return (
              <button
                aria-selected={selected}
                className={keybindingsTabClassName(selected)}
                key={platform.value}
                onClick={() => setSelectedKeybindingPlatform(platform.value)}
                role="tab"
                type="button"
              >
                {platform.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {(["global", "terminal", "workspace"] as KeybindingScope[]).map(
          (scope) => {
            const scopedKeybindings = normalizedSettings.keybindings.filter(
              (keybinding) => keybinding.scope === scope,
            );

            if (scopedKeybindings.length === 0) {
              return null;
            }

            return (
              <section className={keybindingsSubpanelClassName} key={scope}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {scopeLabel(scope)}快捷键
                  </div>
                  <span className={keybindingsBadgeClassName}>
                    {scopedKeybindings.length} 项
                  </span>
                </div>
                <div className="mt-3 divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)]">
                  {scopedKeybindings.map((keybinding) => {
                    const currentBinding = bindingForPlatform(
                      keybinding,
                      selectedKeybindingPlatform,
                    );
                    const defaultBinding = bindingForPlatform(
                      defaultKeybindingsByAction.get(keybinding.action) ??
                        keybinding,
                      selectedKeybindingPlatform,
                    );
                    const customized = currentBinding !== defaultBinding;

                    return (
                      <div
                        className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(150px,0.3fr)]"
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
                            <span className={keybindingsBadgeClassName}>
                              {scopeLabel(keybinding.scope)}
                            </span>
                            <span
                              className={cn(
                                keybindingsBadgeClassName,
                                "font-mono",
                              )}
                            >
                              {keybinding.action}
                            </span>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {selectedKeybindingPlatformLabel}
                          </div>
                          {keybinding.editable ? (
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                              <input
                                aria-label={`${keybinding.label} ${selectedKeybindingPlatformLabel} 快捷键`}
                                className={keybindingsInputClassName}
                                onChange={(event) =>
                                  updateKeybinding(
                                    keybinding,
                                    selectedKeybindingPlatform,
                                    event.currentTarget.value,
                                  )
                                }
                                placeholder="留空表示禁用"
                                spellCheck={false}
                                value={currentBinding}
                              />
                              <button
                                aria-label={`恢复 ${keybinding.label} 默认快捷键`}
                                className={keybindingsIconButtonClassName}
                                disabled={!customized}
                                onClick={() => resetKeybinding(keybinding)}
                                title="恢复默认"
                                type="button"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <KeybindingCell
                              label={selectedKeybindingPlatformLabel}
                              value={currentBinding}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          },
        )}
      </div>
      <p className="mt-4 border-t border-[var(--border-subtle)] px-1 pt-3 text-xs leading-5 text-[var(--text-secondary)]">
        使用 Ctrl+Shift+T 格式；留空表示禁用。
      </p>
    </section>
  );
}
