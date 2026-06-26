import { useEffect, useState } from "react";
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
import { DesktopSettingsSection } from "./settings-tool-content/desktop-section";
import { KeybindingsSettingsSection } from "./settings-tool-content/keybindings-section";
import { McpSkillsSettingsSection } from "./settings-tool-content/mcp-section";
import { settingsSections } from "./settings-tool-content/options";
import { SettingsSaveNotice } from "./settings-tool-content/shared-controls";
import { SftpSettingsSection } from "./settings-tool-content/sftp-section";
import {
  type SettingsToolContentProps,
  type SuggestionCleanupState,
  type SuggestionTelemetryLoadState,
  type VisibleSettingsSectionId,
  visibleSettingsSectionId,
} from "./settings-tool-content/types";

export type {
  SettingsSaveState,
  SettingsSectionId,
} from "./settings-tool-content/types";

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
    useState<VisibleSettingsSectionId>(() =>
      visibleSettingsSectionId(initialSectionId),
    );
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
  const normalizedSettings = normalizeAppSettings(settings);
  const selectedKeybindingPlatformLabel =
    selectedKeybindingPlatform === "mac" ? "macOS" : "Windows";
  const previewResolvedTheme =
    resolvedTheme ?? resolveSettingsPreviewTheme(normalizedSettings.themeMode);

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
    setActiveSectionId(visibleSettingsSectionId(initialSectionId));
  }, [initialSectionId]);

  useEffect(() => {
    if (
      activeSectionId === "settings-appearance" &&
      !suggestionTelemetry &&
      suggestionTelemetryState === "idle"
    ) {
      void loadSuggestionTelemetry();
    }
  }, [activeSectionId, suggestionTelemetry, suggestionTelemetryState]);

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

  return (
    <section className="grid gap-5 lg:grid-cols-[196px_minmax(0,1fr)]">
      <nav aria-label="设置分类" className="lg:sticky lg:top-0 lg:self-start">
        <div className="kerminal-solid-surface rounded-2xl border p-2">
          <div className="px-2 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            功能分类
          </div>
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
            cleanupSuggestionDiagnostics={cleanupSuggestionDiagnostics}
            loadSuggestionTelemetry={loadSuggestionTelemetry}
            normalizedSettings={normalizedSettings}
            resolvedTheme={previewResolvedTheme}
            suggestionCleanupError={suggestionCleanupError}
            suggestionCleanupResult={suggestionCleanupResult}
            suggestionCleanupState={suggestionCleanupState}
            suggestionTelemetry={suggestionTelemetry}
            suggestionTelemetryError={suggestionTelemetryError}
            suggestionTelemetryState={suggestionTelemetryState}
            updateAppearance={updateAppearance}
            updateSettings={updateSettings}
            updateTerminal={updateTerminal}
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
