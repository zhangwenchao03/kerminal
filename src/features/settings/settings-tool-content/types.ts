import type { AppSettings, ResolvedTheme } from "../settingsModel";

export type SettingsSaveState = "idle" | "saving" | "saved" | "error";
export type McpHttpServerLoadState = "idle" | "loading" | "error";
export type SuggestionTelemetryLoadState = "idle" | "loading" | "error";
export type SuggestionCleanupState = "idle" | "running" | "done" | "error";

export interface SettingsToolContentProps {
  externalChangeNotice?: string | null;
  initialSectionId?: VisibleSettingsSectionId;
  resolvedTheme?: ResolvedTheme;
  settings: AppSettings;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  onSettingsChange: (settings: AppSettings) => void;
}

export type SettingsSectionId =
  | "settings-appearance"
  | "settings-terminal"
  | "settings-suggestions"
  | "settings-external-launch"
  | "settings-desktop"
  | "settings-mcp"
  | "settings-sync"
  | "settings-sftp"
  | "settings-keybindings"
  | "settings-about";

export type VisibleSettingsSectionId = SettingsSectionId;
