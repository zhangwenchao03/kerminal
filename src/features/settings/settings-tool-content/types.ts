import type { AppSettings, ResolvedTheme } from "../settingsModel";

export type SettingsSaveState = "idle" | "saving" | "saved" | "error";
export type McpHttpServerLoadState = "idle" | "loading" | "error";
export type SuggestionTelemetryLoadState = "idle" | "loading" | "error";
export type SuggestionCleanupState = "idle" | "running" | "done" | "error";

export interface SettingsToolContentProps {
  externalChangeNotice?: string | null;
  initialSectionId?: SettingsSectionId;
  resolvedTheme?: ResolvedTheme;
  settings: AppSettings;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  onSettingsChange: (settings: AppSettings) => void;
}

export type SettingsSectionId =
  | "settings-appearance"
  | "settings-desktop"
  | "settings-mcp"
  | "settings-sftp"
  | "settings-terminal"
  | "settings-keybindings"
  | "settings-about";

export type VisibleSettingsSectionId = Exclude<
  SettingsSectionId,
  "settings-terminal"
>;

export function visibleSettingsSectionId(
  sectionId: SettingsSectionId,
): VisibleSettingsSectionId {
  if (sectionId === "settings-terminal") {
    return "settings-appearance";
  }

  return sectionId;
}
