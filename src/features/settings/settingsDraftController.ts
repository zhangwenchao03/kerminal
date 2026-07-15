import {
  normalizeAppSettings,
  type AppearanceSettings,
  type AppSettings,
  type DesktopNotificationSettings,
  type ExternalLaunchSettings,
  type SftpPerformanceSettings,
  type TerminalAppearance,
  type TerminalInlineSuggestionProviderSettings,
  type TerminalInlineSuggestionSettings,
} from "./settingsModel";

export interface SettingsDraftController {
  replace: (next: AppSettings) => void;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  updateDesktopNotifications: (patch: Partial<DesktopNotificationSettings>) => void;
  updateExternalLaunch: (patch: Partial<ExternalLaunchSettings>) => void;
  updateSftp: (patch: Partial<SftpPerformanceSettings>) => void;
  updateTerminal: (patch: Partial<TerminalAppearance>) => void;
  updateTerminalInlineSuggestion: (
    patch: Partial<TerminalInlineSuggestionSettings>,
  ) => void;
  updateTerminalInlineSuggestionProvider: (
    provider: keyof TerminalInlineSuggestionProviderSettings,
    enabled: boolean,
  ) => void;
}

/**
 * 设置视图的 draft command controller。
 * 所有嵌套 patch 都基于同一份规范化快照，保证 section 组件不会各自实现合并规则。
 */
export function createSettingsDraftController(
  settings: AppSettings,
  onChange: (next: AppSettings) => void,
): SettingsDraftController {
  const normalized = normalizeAppSettings(settings);
  const replace = (next: AppSettings) => onChange(normalizeAppSettings(next));

  const updateTerminal = (patch: Partial<TerminalAppearance>) => {
    replace({
      ...normalized,
      terminal: { ...normalized.terminal, ...patch },
    });
  };

  const updateTerminalInlineSuggestion = (
    patch: Partial<TerminalInlineSuggestionSettings>,
  ) => {
    updateTerminal({
      inlineSuggestion: {
        ...normalized.terminal.inlineSuggestion,
        ...patch,
        providers: {
          ...normalized.terminal.inlineSuggestion.providers,
          ...(patch.providers ?? {}),
        },
      },
    });
  };

  return {
    replace,
    updateAppearance: (patch) => {
      replace({
        ...normalized,
        appearance: { ...normalized.appearance, ...patch },
      });
    },
    updateDesktopNotifications: (patch) => {
      replace({
        ...normalized,
        desktopNotifications: {
          ...normalized.desktopNotifications,
          ...patch,
        },
      });
    },
    updateExternalLaunch: (patch) => {
      replace({
        ...normalized,
        externalLaunch: {
          ...normalized.externalLaunch,
          ...patch,
          disabledTools: patch.disabledTools ?? normalized.externalLaunch.disabledTools,
          shimBridge: {
            ...normalized.externalLaunch.shimBridge,
            ...(patch.shimBridge ?? {}),
          },
        },
      });
    },
    updateSftp: (patch) => {
      replace({
        ...normalized,
        sftp: { ...normalized.sftp, ...patch },
      });
    },
    updateTerminal,
    updateTerminalInlineSuggestion,
    updateTerminalInlineSuggestionProvider: (provider, enabled) => {
      updateTerminalInlineSuggestion({
        providers: {
          ...normalized.terminal.inlineSuggestion.providers,
          [provider]: enabled,
        },
      });
    },
  };
}
