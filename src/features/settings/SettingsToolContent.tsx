import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { selectLocalFile } from "../../lib/fileDialogApi";
import {
  cleanupTerminalSuggestionDiagnostics,
  getTerminalSuggestionTelemetrySummary,
  type CommandSuggestionDiagnosticsCleanupResult,
  type CommandSuggestionTelemetrySummary,
} from "../../lib/terminalSuggestionApi";
import {
  normalizeAppSettings,
  type AppearanceSettings,
  type AppSettings,
  type DesktopNotificationSettings,
  type ExternalLaunchSettings,
  type KeybindingPlatform,
  type ResolvedTheme,
  type SftpPerformanceSettings,
  type TerminalAppearance,
  type TerminalInlineSuggestionProviderSettings,
  type TerminalInlineSuggestionSettings,
  type ThemeMode,
} from "./settingsModel";
import { shortcutPlatform } from "./keybindingUtils";
import { AboutSettingsSection } from "./settings-tool-content/about-section";
import { AppearanceSettingsSection } from "./settings-tool-content/appearance-section";
import { CommandSuggestionSettingsSection } from "./settings-tool-content/command-suggestions-section";
import { DesktopSettingsSection } from "./settings-tool-content/desktop-section";
import { ExternalLaunchSettingsSection } from "./settings-tool-content/external-launch-section";
import { KeybindingsSettingsSection } from "./settings-tool-content/keybindings-section";
import { McpSkillsSettingsSection } from "./settings-tool-content/mcp-section";
import {
  settingsSearchEntries,
  settingsSections,
} from "./settings-tool-content/options";
import { SettingsSaveNotice } from "./settings-tool-content/shared-controls";
import { SftpSettingsSection } from "./settings-tool-content/sftp-section";
import { SyncSettingsSection } from "./settings-tool-content/sync-section";
import { TerminalSettingsSection } from "./settings-tool-content/terminal-section";
import {
  type SettingsToolContentProps,
  type SuggestionCleanupState,
  type SuggestionTelemetryLoadState,
  type VisibleSettingsSectionId,
} from "./settings-tool-content/types";

export type {
  SettingsSaveState,
  SettingsSectionId,
} from "./settings-tool-content/types";

type SettingsSearchEntry = (typeof settingsSearchEntries)[number];

export function SettingsToolContent({
  externalChangeNotice,
  initialSectionId = "settings-appearance",
  onSettingsChange,
  resolvedTheme,
  saveError,
  saveState = "idle",
  settings,
}: SettingsToolContentProps) {
  const [activeSectionId, setActiveSectionId] =
    useState<VisibleSettingsSectionId>(initialSectionId);
  const [suggestionTelemetry, setSuggestionTelemetry] =
    useState<CommandSuggestionTelemetrySummary | null>(null);
  const [suggestionTelemetryError, setSuggestionTelemetryError] = useState<
    string | null
  >(null);
  const [suggestionTelemetryState, setSuggestionTelemetryState] =
    useState<SuggestionTelemetryLoadState>("idle");
  const [suggestionCleanupError, setSuggestionCleanupError] = useState<
    string | null
  >(null);
  const [suggestionCleanupResult, setSuggestionCleanupResult] =
    useState<CommandSuggestionDiagnosticsCleanupResult | null>(null);
  const [suggestionCleanupState, setSuggestionCleanupState] =
    useState<SuggestionCleanupState>("idle");
  const [selectedKeybindingPlatform, setSelectedKeybindingPlatform] =
    useState<KeybindingPlatform>(() => shortcutPlatform());
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [pendingSearchTargetId, setPendingSearchTargetId] = useState<
    string | null
  >(null);
  const normalizedSettings = normalizeAppSettings(settings);
  const selectedKeybindingPlatformLabel =
    selectedKeybindingPlatform === "mac" ? "macOS" : "Windows";
  const previewResolvedTheme =
    resolvedTheme ?? resolveSettingsPreviewTheme(normalizedSettings.themeMode);
  const trimmedSettingsSearchQuery = settingsSearchQuery.trim();
  const settingsSearchResults = useMemo(
    () => searchSettings(trimmedSettingsSearchQuery),
    [trimmedSettingsSearchQuery],
  );

  const loadSuggestionTelemetry = async () => {
    setSuggestionTelemetryState("loading");
    setSuggestionTelemetryError(null);
    try {
      setSuggestionTelemetry(await getTerminalSuggestionTelemetrySummary());
      setSuggestionTelemetryState("idle");
    } catch (nextError) {
      setSuggestionTelemetry(null);
      setSuggestionTelemetryError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setSuggestionTelemetryState("error");
    }
  };

  const cleanupSuggestionDiagnostics = async (
    resetPersistedTelemetry: boolean,
  ) => {
    setSuggestionCleanupState("running");
    setSuggestionCleanupError(null);
    try {
      const result = await cleanupTerminalSuggestionDiagnostics({
        auditRetentionDays:
          normalizedSettings.terminal.inlineSuggestion.auditRetentionDays,
        feedbackRetentionDays:
          normalizedSettings.terminal.inlineSuggestion.feedbackRetentionDays,
        pruneAuditEvents: !resetPersistedTelemetry,
        pruneExpiredProviderCache: !resetPersistedTelemetry,
        pruneFeedback: !resetPersistedTelemetry,
        resetPersistedTelemetry,
      });
      setSuggestionCleanupResult(result);
      setSuggestionCleanupState("done");
      await loadSuggestionTelemetry();
    } catch (nextError) {
      setSuggestionCleanupError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setSuggestionCleanupState("error");
    }
  };

  useEffect(() => {
    setActiveSectionId(initialSectionId);
  }, [initialSectionId]);

  useEffect(() => {
    if (
      activeSectionId === "settings-suggestions" &&
      !suggestionTelemetry &&
      suggestionTelemetryState === "idle"
    ) {
      void loadSuggestionTelemetry();
    }
  }, [activeSectionId, suggestionTelemetry, suggestionTelemetryState]);

  useEffect(() => {
    if (!pendingSearchTargetId) {
      return;
    }

    const focusTarget = () => {
      const target = document.getElementById(pendingSearchTargetId);
      if (!target) {
        setPendingSearchTargetId(null);
        return;
      }

      target.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
      target.focus?.({
        preventScroll: true,
      });
      setPendingSearchTargetId(null);
    };

    if (typeof window.requestAnimationFrame !== "function") {
      const timeout = window.setTimeout(focusTarget, 0);
      return () => window.clearTimeout(timeout);
    }

    const frame = window.requestAnimationFrame(focusTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSectionId, pendingSearchTargetId]);

  const updateSettings = (next: AppSettings) => {
    onSettingsChange(normalizeAppSettings(next));
  };

  const updateAppearance = (appearance: Partial<AppearanceSettings>) => {
    updateSettings({
      ...normalizedSettings,
      appearance: {
        ...normalizedSettings.appearance,
        ...appearance,
      },
    });
  };

  const updateTerminal = (terminal: Partial<TerminalAppearance>) => {
    updateSettings({
      ...normalizedSettings,
      terminal: {
        ...normalizedSettings.terminal,
        ...terminal,
      },
    });
  };

  const updateTerminalInlineSuggestion = (
    inlineSuggestion: Partial<TerminalInlineSuggestionSettings>,
  ) => {
    updateTerminal({
      inlineSuggestion: {
        ...normalizedSettings.terminal.inlineSuggestion,
        ...inlineSuggestion,
        providers: {
          ...normalizedSettings.terminal.inlineSuggestion.providers,
          ...(inlineSuggestion.providers ?? {}),
        },
      },
    });
  };

  const updateTerminalInlineSuggestionProvider = (
    provider: keyof TerminalInlineSuggestionProviderSettings,
    enabled: boolean,
  ) => {
    updateTerminalInlineSuggestion({
      providers: {
        ...normalizedSettings.terminal.inlineSuggestion.providers,
        [provider]: enabled,
      },
    });
  };

  const chooseBackgroundImage = () => {
    void selectLocalFile().then((backgroundImagePath) => {
      if (!backgroundImagePath) {
        return;
      }
      updateAppearance({
        backgroundEnabled: true,
        backgroundImagePath,
      });
    });
  };

  const updateSftp = (sftp: Partial<SftpPerformanceSettings>) => {
    updateSettings({
      ...normalizedSettings,
      sftp: {
        ...normalizedSettings.sftp,
        ...sftp,
      },
    });
  };

  const updateDesktopNotifications = (
    desktopNotifications: Partial<DesktopNotificationSettings>,
  ) => {
    updateSettings({
      ...normalizedSettings,
      desktopNotifications: {
        ...normalizedSettings.desktopNotifications,
        ...desktopNotifications,
      },
    });
  };

  const updateExternalLaunch = (
    externalLaunch: Partial<ExternalLaunchSettings>,
  ) => {
    updateSettings({
      ...normalizedSettings,
      externalLaunch: {
        ...normalizedSettings.externalLaunch,
        ...externalLaunch,
        disabledTools:
          externalLaunch.disabledTools ??
          normalizedSettings.externalLaunch.disabledTools,
        shimBridge: {
          ...normalizedSettings.externalLaunch.shimBridge,
          ...(externalLaunch.shimBridge ?? {}),
        },
      },
    });
  };

  const navigateToSearchResult = (result: SettingsSearchEntry) => {
    setActiveSectionId(result.sectionId);
    setPendingSearchTargetId(result.targetId);
    setSettingsSearchQuery("");
  };

  return (
    <section className="grid gap-5 lg:grid-cols-[196px_minmax(0,1fr)]">
      <nav aria-label="设置分类" className="lg:sticky lg:top-0 lg:self-start">
        <div className="kerminal-solid-surface rounded-2xl border p-2">
          <label className="kerminal-field-surface flex h-10 items-center gap-2 rounded-xl border px-2 text-sm text-zinc-950 dark:text-zinc-100">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              aria-label="搜索设置"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              onChange={(event) =>
                setSettingsSearchQuery(event.currentTarget.value)
              }
              placeholder="搜索设置"
              value={settingsSearchQuery}
            />
            {settingsSearchQuery ? (
              <button
                aria-label="清除设置搜索"
                className="kerminal-focus-ring kerminal-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
                onClick={() => setSettingsSearchQuery("")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <div className="px-2 pb-2 pt-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            功能分类
          </div>
          {trimmedSettingsSearchQuery ? (
            <div className="space-y-1">
              {settingsSearchResults.length > 0 ? (
                settingsSearchResults.map((result) => (
                  <button
                    aria-label={`打开设置项：${result.title}`}
                    className="kerminal-focus-ring kerminal-pressable kerminal-muted-surface block w-full rounded-xl border px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50"
                    key={`${result.sectionId}:${result.targetId}:${result.title}`}
                    onClick={() => navigateToSearchResult(result)}
                    type="button"
                  >
                    <span className="block truncate font-medium">
                      {result.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {sectionLabelFor(result.sectionId)} ·{" "}
                      {result.description}
                    </span>
                  </button>
                ))
              ) : (
                <div className="kerminal-muted-surface rounded-xl border px-3 py-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  没有找到匹配设置。
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                const selected = activeSectionId === section.id;

                return (
                  <button
                    aria-controls={`${section.id}-panel`}
                    aria-pressed={selected}
                    className={cn(
                      "kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm",
                      selected
                        ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                        : "text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
                    )}
                    key={section.id}
                    onClick={() => setActiveSectionId(section.id)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        selected
                          ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                          : "bg-[var(--surface-muted)] text-sky-600 dark:text-sky-300",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {section.label}
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-500">
                        {section.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="min-w-0 space-y-5">
        {externalChangeNotice ? (
          <div
            className="rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 font-mono text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100"
            role="status"
          >
            {externalChangeNotice}
          </div>
        ) : null}

        {activeSectionId === "settings-appearance" ? (
          <AppearanceSettingsSection
            chooseBackgroundImage={chooseBackgroundImage}
            normalizedSettings={normalizedSettings}
            updateAppearance={updateAppearance}
            updateSettings={updateSettings}
          />
        ) : null}

        {activeSectionId === "settings-terminal" ? (
          <TerminalSettingsSection
            normalizedSettings={normalizedSettings}
            resolvedTheme={previewResolvedTheme}
            updateTerminal={updateTerminal}
          />
        ) : null}

        {activeSectionId === "settings-suggestions" ? (
          <CommandSuggestionSettingsSection
            cleanupSuggestionDiagnostics={cleanupSuggestionDiagnostics}
            loadSuggestionTelemetry={loadSuggestionTelemetry}
            normalizedSettings={normalizedSettings}
            suggestionCleanupError={suggestionCleanupError}
            suggestionCleanupResult={suggestionCleanupResult}
            suggestionCleanupState={suggestionCleanupState}
            suggestionTelemetry={suggestionTelemetry}
            suggestionTelemetryError={suggestionTelemetryError}
            suggestionTelemetryState={suggestionTelemetryState}
            updateTerminalInlineSuggestion={updateTerminalInlineSuggestion}
            updateTerminalInlineSuggestionProvider={
              updateTerminalInlineSuggestionProvider
            }
          />
        ) : null}

        {activeSectionId === "settings-mcp" ? (
          <div className="space-y-4" id="settings-mcp-panel">
            <McpSkillsSettingsSection
              desktopNotifications={normalizedSettings.desktopNotifications}
            />
          </div>
        ) : null}

        {activeSectionId === "settings-sync" ? <SyncSettingsSection /> : null}

        {activeSectionId === "settings-desktop" ? (
          <DesktopSettingsSection
            normalizedSettings={normalizedSettings}
            updateDesktopNotifications={updateDesktopNotifications}
          />
        ) : null}

        {activeSectionId === "settings-sftp" ? (
          <SftpSettingsSection
            normalizedSettings={normalizedSettings}
            updateSftp={updateSftp}
          />
        ) : null}

        {activeSectionId === "settings-external-launch" ? (
          <ExternalLaunchSettingsSection
            externalLaunch={normalizedSettings.externalLaunch}
            updateExternalLaunch={updateExternalLaunch}
          />
        ) : null}

        {activeSectionId === "settings-keybindings" ? (
          <KeybindingsSettingsSection
            normalizedSettings={normalizedSettings}
            selectedKeybindingPlatform={selectedKeybindingPlatform}
            selectedKeybindingPlatformLabel={selectedKeybindingPlatformLabel}
            setSelectedKeybindingPlatform={setSelectedKeybindingPlatform}
            updateSettings={updateSettings}
          />
        ) : null}

        {activeSectionId === "settings-about" ? (
          <AboutSettingsSection
            desktopNotifications={normalizedSettings.desktopNotifications}
          />
        ) : null}

        <SettingsSaveNotice saveError={saveError} saveState={saveState} />
      </div>
    </section>
  );
}

function resolveSettingsPreviewTheme(themeMode: ThemeMode): ResolvedTheme {
  if (themeMode === "dark" || themeMode === "light") {
    return themeMode;
  }

  if (typeof document !== "undefined") {
    const documentTheme = document.documentElement.dataset.theme;
    if (documentTheme === "dark" || documentTheme === "light") {
      return documentTheme;
    }
  }

  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}

function searchSettings(query: string): SettingsSearchEntry[] {
  if (!query) {
    return [];
  }

  const normalizedQuery = query.toLocaleLowerCase();
  return settingsSearchEntries
    .filter((entry) =>
      [
        entry.title,
        entry.description,
        sectionLabelFor(entry.sectionId),
        ...entry.keywords,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
    .slice(0, 8);
}

function sectionLabelFor(sectionId: VisibleSettingsSectionId): string {
  return (
    settingsSections.find((section) => section.id === sectionId)?.label ??
    "设置"
  );
}
