import type { AppSettings, ResolvedTheme } from "../settingsModel";
import type { McpGatewayManifest } from "../../tool-panel/toolRegistryModel";

export type SettingsSaveState = "idle" | "saving" | "saved" | "error";
export type McpManifestLoadState = "idle" | "loading" | "error";
export type McpHttpServerLoadState = "idle" | "loading" | "error";
export type SuggestionTelemetryLoadState = "idle" | "loading" | "error";
export type SuggestionCleanupState = "idle" | "running" | "done" | "error";
export type McpCopyTarget = "endpoint" | "config";
export type McpTransportDefinition = McpGatewayManifest["transports"][number];

export interface SettingsToolContentProps {
  initialSectionId?: SettingsSectionId;
  resolvedTheme?: ResolvedTheme;
  settings: AppSettings;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  onSettingsChange: (settings: AppSettings) => void;
}

export type SettingsSectionId =
  | "settings-appearance"
  | "settings-ai"
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
  return sectionId === "settings-terminal" ? "settings-appearance" : sectionId;
}
