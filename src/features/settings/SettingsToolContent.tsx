import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { selectLocalFile } from "../../lib/fileDialogApi";
import { getMcpGatewayManifest } from "../../lib/toolRegistryApi";
import {
  cleanupTerminalSuggestionDiagnostics,
  getTerminalSuggestionTelemetrySummary,
  type CommandSuggestionDiagnosticsCleanupResult,
  type CommandSuggestionTelemetrySummary,
} from "../../lib/terminalSuggestionApi";
import type { McpGatewayManifest } from "../tool-panel/toolRegistryModel";
import {
  normalizeAiMcpSettings,
  normalizeAppSettings,
  type AiCommandApprovalPolicy,
  type AiMcpSettings,
  type AiSecuritySettings,
  type AppearanceSettings,
  type AppSettings,
  type KeybindingPlatform,
  type SftpPerformanceSettings,
  type TerminalAppearance,
  type TerminalInlineSuggestionProviderSettings,
  type TerminalInlineSuggestionSettings,
} from "./settingsModel";
import { shortcutPlatform } from "./keybindingUtils";
import { AboutSettingsSection } from "./settings-tool-content/about-section";
import { AiSettingsSection } from "./settings-tool-content/ai-section";
import { AppearanceSettingsSection } from "./settings-tool-content/appearance-section";
import { KeybindingsSettingsSection } from "./settings-tool-content/keybindings-section";
import { McpSkillsSettingsSection } from "./settings-tool-content/mcp-section";
import { settingsSections } from "./settings-tool-content/options";
import { SettingsSaveNotice } from "./settings-tool-content/shared-controls";
import { SftpSettingsSection } from "./settings-tool-content/sftp-section";
import {
  type McpManifestLoadState,
  type SettingsToolContentProps,
  type SuggestionCleanupState,
  type SuggestionTelemetryLoadState,
  type VisibleSettingsSectionId,
  visibleSettingsSectionId,
} from "./settings-tool-content/types";

export type { SettingsSaveState, SettingsSectionId } from "./settings-tool-content/types";

export function SettingsToolContent({
  initialSectionId = "settings-appearance",
  onSettingsChange,
  saveError,
  saveState = "idle",
  settings,
}: SettingsToolContentProps) {
  const [activeSectionId, setActiveSectionId] =
    useState<VisibleSettingsSectionId>(() =>
      visibleSettingsSectionId(initialSectionId),
    );
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpManifest, setMcpManifest] = useState<McpGatewayManifest | null>(null);
  const [mcpState, setMcpState] = useState<McpManifestLoadState>("idle");
  const [suggestionTelemetry, setSuggestionTelemetry] =
    useState<CommandSuggestionTelemetrySummary | null>(null);
  const [suggestionTelemetryError, setSuggestionTelemetryError] = useState<string | null>(null);
  const [suggestionTelemetryState, setSuggestionTelemetryState] =
    useState<SuggestionTelemetryLoadState>("idle");
  const [suggestionCleanupError, setSuggestionCleanupError] = useState<string | null>(null);
  const [suggestionCleanupResult, setSuggestionCleanupResult] =
    useState<CommandSuggestionDiagnosticsCleanupResult | null>(null);
  const [suggestionCleanupState, setSuggestionCleanupState] =
    useState<SuggestionCleanupState>("idle");
  const [selectedKeybindingPlatform, setSelectedKeybindingPlatform] =
    useState<KeybindingPlatform>(() => shortcutPlatform());
  const normalizedSettings = normalizeAppSettings(settings);
  const selectedKeybindingPlatformLabel =
    selectedKeybindingPlatform === "mac" ? "macOS" : "Windows";

  const loadMcpManifest = async () => {
    setMcpState("loading");
    setMcpError(null);
    try {
      setMcpManifest(await getMcpGatewayManifest());
      setMcpState("idle");
    } catch (nextError) {
      setMcpManifest(null);
      setMcpError(nextError instanceof Error ? nextError.message : String(nextError));
      setMcpState("error");
    }
  };

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

  const cleanupSuggestionDiagnostics = async (resetPersistedTelemetry: boolean) => {
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
      activeSectionId === "settings-mcp" &&
      !mcpManifest &&
      mcpState === "idle"
    ) {
      void loadMcpManifest();
    }
  }, [activeSectionId, mcpManifest, mcpState]);

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

  const updateAi = (ai: Partial<AiSecuritySettings>) => {
    updateSettings({
      ...normalizedSettings,
      ai: {
        ...normalizedSettings.ai,
        ...ai,
      },
    });
  };

  const updateMcp = (mcp: AiMcpSettings) => {
    updateAi({ mcp: normalizeAiMcpSettings(mcp) });
  };

  const updateAiCommandApprovalPolicy = (
    commandApprovalPolicy: AiCommandApprovalPolicy,
  ) => {
    updateAi({
      commandApprovalPolicy,
      requireRemoteApproval: commandApprovalPolicy !== "relaxed",
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

  return (
    <section className="grid gap-5 lg:grid-cols-[196px_minmax(0,1fr)]">
      <nav aria-label="设置分类" className="lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-2xl border border-black/8 bg-white/70 p-2 shadow-sm shadow-black/5 dark:border-white/8 dark:bg-white/6 dark:shadow-black/20">
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
                    "flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-500/15",
                    selected
                      ? "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-100"
                      : "text-zinc-600 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/8 dark:hover:text-zinc-50",
                  )}
                  key={section.id}
                  onClick={() => setActiveSectionId(section.id)}
                  type="button"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      selected
                        ? "bg-sky-500/15 text-sky-700 dark:bg-sky-300/15 dark:text-sky-100"
                        : "bg-black/[0.04] text-sky-600 dark:bg-white/8 dark:text-sky-300",
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
        {activeSectionId === "settings-appearance" ? (
          <AppearanceSettingsSection
            chooseBackgroundImage={chooseBackgroundImage}
            cleanupSuggestionDiagnostics={cleanupSuggestionDiagnostics}
            loadSuggestionTelemetry={loadSuggestionTelemetry}
            normalizedSettings={normalizedSettings}
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

        {activeSectionId === "settings-ai" ? (
          <AiSettingsSection
            normalizedSettings={normalizedSettings}
            updateAi={updateAi}
            updateAiCommandApprovalPolicy={updateAiCommandApprovalPolicy}
          />
        ) : null}

        {activeSectionId === "settings-mcp" ? (
          <div className="space-y-4" id="settings-mcp-panel">
            <McpSkillsSettingsSection
              error={mcpError}
              manifest={mcpManifest}
              mcp={normalizedSettings.ai.mcp}
              onChange={updateMcp}
              onRefresh={() => void loadMcpManifest()}
              state={mcpState}
            />
          </div>
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
          />
        ) : null}

        {activeSectionId === "settings-about" ? <AboutSettingsSection /> : null}

        <SettingsSaveNotice saveError={saveError} saveState={saveState} />
      </div>
    </section>
  );
}
