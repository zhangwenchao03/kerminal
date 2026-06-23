import type {
  ToolAuditPolicy,
  ToolConfirmationPolicy,
  ToolRiskLevel,
} from "../tool-panel/toolRegistryModel";
import {
  DEFAULT_CUSTOM_SKILLS_DIRECTORY,
  defaultAiSecuritySettings,
  defaultAppearanceSettings,
  defaultAppSettings,
  defaultKeybindings,
  defaultSftpPerformanceSettings,
  defaultTerminalAppearance,
} from "./settingsDefaults";
import {
  AI_CONTEXT_OUTPUT_BYTES_MAX,
  AI_CONTEXT_OUTPUT_BYTES_MIN,
  SFTP_GLOBAL_TRANSFERS_MAX,
  SFTP_GLOBAL_TRANSFERS_MIN,
  SFTP_HOST_TRANSFERS_MAX,
  SFTP_HOST_TRANSFERS_MIN,
  SFTP_PACKET_BYTES_MAX,
  SFTP_PACKET_BYTES_MIN,
  SFTP_PIPELINE_DEPTH_MAX,
  SFTP_PIPELINE_DEPTH_MIN,
  SFTP_TIMEOUT_SECONDS_MAX,
  SFTP_TIMEOUT_SECONDS_MIN,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
} from "./settingsLimits";

export {
  DEFAULT_CUSTOM_SKILLS_DIRECTORY,
  defaultAiSecuritySettings,
  defaultAppearanceSettings,
  defaultAppSettings,
  defaultKeybindings,
  defaultSftpPerformanceSettings,
  defaultTerminalAppearance,
} from "./settingsDefaults";
export {
  AI_CONTEXT_OUTPUT_BYTES_DEFAULT,
  AI_CONTEXT_OUTPUT_BYTES_MAX,
  AI_CONTEXT_OUTPUT_BYTES_MIN,
  SFTP_GLOBAL_TRANSFERS_DEFAULT,
  SFTP_GLOBAL_TRANSFERS_MAX,
  SFTP_GLOBAL_TRANSFERS_MIN,
  SFTP_HOST_TRANSFERS_DEFAULT,
  SFTP_HOST_TRANSFERS_MAX,
  SFTP_HOST_TRANSFERS_MIN,
  SFTP_PACKET_BYTES_DEFAULT,
  SFTP_PACKET_BYTES_MAX,
  SFTP_PACKET_BYTES_MIN,
  SFTP_PIPELINE_DEPTH_DEFAULT,
  SFTP_PIPELINE_DEPTH_MAX,
  SFTP_PIPELINE_DEPTH_MIN,
  SFTP_TIMEOUT_SECONDS_DEFAULT,
  SFTP_TIMEOUT_SECONDS_MAX,
  SFTP_TIMEOUT_SECONDS_MIN,
  TERMINAL_INLINE_SUGGESTION_AUDIT_RETENTION_DAYS_DEFAULT,
  TERMINAL_INLINE_SUGGESTION_FEEDBACK_RETENTION_DAYS_DEFAULT,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
} from "./settingsLimits";

const ERRONEOUS_CODEX_SKILLS_DIRECTORY = "~/.codex/skills";
export {
  backgroundImageFitOptions,
  interfaceDensityOptions,
  interfaceLanguageOptions,
  terminalColorSchemeOptions,
  terminalCursorStyleOptions,
  terminalFontOptions,
  terminalFontWeightOptions,
  terminalRightClickBehaviorOptions,
} from "./settingsOptions";

export type ThemeMode = "dark" | "light" | "system";

export type ResolvedTheme = "dark" | "light";

export type InterfaceLanguage = "system" | "zhCN" | "enUS";
export type BackgroundImageFit = "cover" | "contain" | "tile";
export type InterfaceDensity = "compact" | "comfortable" | "spacious";
export type TerminalColorScheme =
  | "kerminal"
  | "tokyoNight"
  | "solarized"
  | "github";
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type TerminalFontWeight = "normal" | "medium" | "bold";
export type TerminalRightClickBehavior = "none" | "paste" | "menu";
export type TerminalInlineSuggestionAcceptKey = "disabled" | "rightArrow";
export type TerminalInlineSuggestionProductionHostPolicy =
  | "normal"
  | "restricted";
export type KeybindingScope = "global" | "terminal" | "workspace";
export type KeybindingPlatform = "windows" | "mac";
export type AiCommandApprovalPolicy = "always" | "risky" | "relaxed";
export type CustomMcpTransportKind = "stdio" | "http";

export interface CustomMcpNameValue {
  name: string;
  value: string;
}

export interface CustomMcpServerToolSetting {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRiskLevel;
  confirmation: ToolConfirmationPolicy;
  audit: ToolAuditPolicy;
  enabled: boolean;
  discoveredAt?: number | null;
}

export interface CustomMcpServerSetting {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transport: CustomMcpTransportKind;
  command: string;
  args: string[];
  url: string;
  bearerTokenEnvVar: string;
  env: CustomMcpNameValue[];
  headers: CustomMcpNameValue[];
  tools: CustomMcpServerToolSetting[];
  lastDiscoveredAt?: number | null;
  lastDiscoveryError?: string | null;
}

export interface CustomMcpSkillDirectorySetting {
  id: string;
  path: string;
  enabled: boolean;
}

export interface AiMcpSettings {
  servers: CustomMcpServerSetting[];
  skillDirectories: CustomMcpSkillDirectorySetting[];
}

export interface TerminalInlineSuggestionProviderSettings {
  history: boolean;
  remotePath: boolean;
  remoteCommand: boolean;
  git: boolean;
  spec: boolean;
  ai: boolean;
}

export interface TerminalInlineSuggestionSettings {
  enabled: boolean;
  acceptKey: TerminalInlineSuggestionAcceptKey;
  providers: TerminalInlineSuggestionProviderSettings;
  remoteProbeEnabled: boolean;
  productionHostPolicy: TerminalInlineSuggestionProductionHostPolicy;
  auditRetentionDays: number;
  feedbackRetentionDays: number;
}

export interface TerminalAppearance {
  autoReconnect: boolean;
  colorScheme: TerminalColorScheme;
  cursorStyle: TerminalCursorStyle;
  fontFamily: string;
  fontSize: number;
  fontWeight: TerminalFontWeight;
  darkColorScheme: TerminalColorScheme;
  lightColorScheme: TerminalColorScheme;
  lineHeight: number;
  macOptionIsMeta: boolean;
  rightClickBehavior: TerminalRightClickBehavior;
  selectionCopy: boolean;
  showTabNumbers: boolean;
  confirmCloseTab: boolean;
  cursorBlink: boolean;
  inlineSuggestion: TerminalInlineSuggestionSettings;
  scrollback: number;
}

export interface AppearanceSettings {
  backgroundEnabled: boolean;
  backgroundFit: BackgroundImageFit;
  backgroundImagePath: string;
  backgroundOpacity: number;
  interfaceLanguage: InterfaceLanguage;
  windowOpacity: number;
}

export interface KeybindingSetting {
  action: string;
  label: string;
  description: string;
  binding: string;
  windowsBinding: string;
  macBinding: string;
  scope: KeybindingScope;
  editable: boolean;
}

export interface AiSecuritySettings {
  contextMaxOutputBytes: number;
  includeCommandHistory: boolean;
  requireRemoteApproval: boolean;
  allowDestructiveTools: boolean;
  commandApprovalPolicy: AiCommandApprovalPolicy;
  commandTimeoutSeconds: number;
  terminalTailLines: number;
  customInstructions: string;
  mcp: AiMcpSettings;
}

export interface SftpPerformanceSettings {
  globalTransfers: number;
  hostTransfers: number;
  pipelineDepth: number;
  packetBytes: number;
  timeoutSeconds: number;
}

export interface AppSettings {
  appearance: AppearanceSettings;
  interfaceDensity: InterfaceDensity;
  themeMode: ThemeMode;
  terminal: TerminalAppearance;
  keybindings: KeybindingSetting[];
  ai: AiSecuritySettings;
  sftp: SftpPerformanceSettings;
}

export function normalizeAppSettings(
  settings?: Partial<AppSettings>,
): AppSettings {
  const appearance = settings?.appearance ?? defaultAppearanceSettings;
  const terminal = settings?.terminal ?? defaultTerminalAppearance;
  const keybindings = normalizeKeybindings(settings?.keybindings);
  const ai = settings?.ai ?? defaultAiSecuritySettings;
  const sftp = settings?.sftp ?? defaultSftpPerformanceSettings;
  const sftpGlobalTransfers = clampNumber(
    sftp.globalTransfers,
    SFTP_GLOBAL_TRANSFERS_MIN,
    SFTP_GLOBAL_TRANSFERS_MAX,
    defaultSftpPerformanceSettings.globalTransfers,
  );
  const sftpHostTransfers = Math.min(
    sftpGlobalTransfers,
    clampNumber(
      sftp.hostTransfers,
      SFTP_HOST_TRANSFERS_MIN,
      SFTP_HOST_TRANSFERS_MAX,
      defaultSftpPerformanceSettings.hostTransfers,
    ),
  );

  return {
    ai: {
      allowDestructiveTools:
        ai.allowDestructiveTools ??
        defaultAiSecuritySettings.allowDestructiveTools,
      commandApprovalPolicy: normalizeCommandApprovalPolicy(
        ai.commandApprovalPolicy,
        ai.requireRemoteApproval,
      ),
      commandTimeoutSeconds: clampNumber(
        ai.commandTimeoutSeconds,
        5,
        600,
        defaultAiSecuritySettings.commandTimeoutSeconds,
      ),
      contextMaxOutputBytes: clampNumber(
        ai.contextMaxOutputBytes,
        AI_CONTEXT_OUTPUT_BYTES_MIN,
        AI_CONTEXT_OUTPUT_BYTES_MAX,
        defaultAiSecuritySettings.contextMaxOutputBytes,
      ),
      customInstructions:
        typeof ai.customInstructions === "string"
          ? ai.customInstructions.slice(0, 8000)
          : defaultAiSecuritySettings.customInstructions,
      includeCommandHistory:
        ai.includeCommandHistory ??
        defaultAiSecuritySettings.includeCommandHistory,
      mcp: normalizeAiMcpSettings(ai.mcp),
      requireRemoteApproval:
        ai.requireRemoteApproval ??
        defaultAiSecuritySettings.requireRemoteApproval,
      terminalTailLines: clampNumber(
        ai.terminalTailLines,
        10,
        500,
        defaultAiSecuritySettings.terminalTailLines,
      ),
    },
    appearance: {
      backgroundEnabled:
        appearance.backgroundEnabled ??
        defaultAppearanceSettings.backgroundEnabled,
      backgroundFit: normalizeBackgroundImageFit(appearance.backgroundFit),
      backgroundImagePath:
        typeof appearance.backgroundImagePath === "string"
          ? appearance.backgroundImagePath.trim().slice(0, 1024)
          : defaultAppearanceSettings.backgroundImagePath,
      backgroundOpacity: clampNumber(
        appearance.backgroundOpacity,
        0,
        100,
        defaultAppearanceSettings.backgroundOpacity,
      ),
      interfaceLanguage: normalizeInterfaceLanguage(
        appearance.interfaceLanguage,
      ),
      windowOpacity: clampNumber(
        appearance.windowOpacity,
        35,
        100,
        defaultAppearanceSettings.windowOpacity,
      ),
    },
    interfaceDensity: normalizeInterfaceDensity(settings?.interfaceDensity),
    keybindings,
    sftp: {
      globalTransfers: sftpGlobalTransfers,
      hostTransfers: sftpHostTransfers,
      packetBytes: clampNumber(
        sftp.packetBytes,
        SFTP_PACKET_BYTES_MIN,
        SFTP_PACKET_BYTES_MAX,
        defaultSftpPerformanceSettings.packetBytes,
      ),
      pipelineDepth: clampNumber(
        sftp.pipelineDepth,
        SFTP_PIPELINE_DEPTH_MIN,
        SFTP_PIPELINE_DEPTH_MAX,
        defaultSftpPerformanceSettings.pipelineDepth,
      ),
      timeoutSeconds: clampNumber(
        sftp.timeoutSeconds,
        SFTP_TIMEOUT_SECONDS_MIN,
        SFTP_TIMEOUT_SECONDS_MAX,
        defaultSftpPerformanceSettings.timeoutSeconds,
      ),
    },
    terminal: {
      autoReconnect:
        terminal.autoReconnect ?? defaultTerminalAppearance.autoReconnect,
      colorScheme: normalizeTerminalColorScheme(terminal.colorScheme),
      confirmCloseTab:
        terminal.confirmCloseTab ?? defaultTerminalAppearance.confirmCloseTab,
      cursorBlink:
        terminal.cursorBlink ?? defaultTerminalAppearance.cursorBlink,
      cursorStyle: normalizeTerminalCursorStyle(terminal.cursorStyle),
      darkColorScheme: normalizeTerminalColorScheme(
        terminal.darkColorScheme ?? terminal.colorScheme,
      ),
      fontFamily: terminal.fontFamily || defaultTerminalAppearance.fontFamily,
      fontSize: clampNumber(
        terminal.fontSize,
        10,
        24,
        defaultTerminalAppearance.fontSize,
      ),
      fontWeight: normalizeTerminalFontWeight(terminal.fontWeight),
      inlineSuggestion: normalizeTerminalInlineSuggestion(
        terminal.inlineSuggestion,
      ),
      lightColorScheme: normalizeTerminalColorScheme(
        terminal.lightColorScheme ?? terminal.colorScheme,
      ),
      lineHeight: clampNumber(
        terminal.lineHeight,
        1,
        1.8,
        defaultTerminalAppearance.lineHeight,
      ),
      macOptionIsMeta:
        terminal.macOptionIsMeta ?? defaultTerminalAppearance.macOptionIsMeta,
      rightClickBehavior: normalizeTerminalRightClickBehavior(
        terminal.rightClickBehavior,
      ),
      scrollback: clampNumber(
        terminal.scrollback,
        1000,
        50000,
        defaultTerminalAppearance.scrollback,
      ),
      selectionCopy:
        terminal.selectionCopy ?? defaultTerminalAppearance.selectionCopy,
      showTabNumbers:
        terminal.showTabNumbers ?? defaultTerminalAppearance.showTabNumbers,
    },
    themeMode: normalizeThemeMode(settings?.themeMode),
  };
}

export function normalizeAiMcpSettings(
  settings?: Partial<AiMcpSettings>,
): AiMcpSettings {
  const skillDirectories = Array.isArray(settings?.skillDirectories)
    ? settings.skillDirectories
        .slice(0, 8)
        .map((directory, index) =>
          normalizeCustomMcpSkillDirectory(directory, index),
        )
    : defaultAiSecuritySettings.mcp.skillDirectories;
  return {
    servers: Array.isArray(settings?.servers)
      ? settings.servers
          .slice(0, 12)
          .map((server, index) => normalizeCustomMcpServer(server, index))
      : [],
    skillDirectories:
      skillDirectories.length > 0
        ? skillDirectories
        : defaultAiSecuritySettings.mcp.skillDirectories,
  };
}

function normalizeCustomMcpServer(
  server: Partial<CustomMcpServerSetting>,
  index: number,
): CustomMcpServerSetting {
  return {
    args: normalizeStringList(server.args, 120, 500),
    bearerTokenEnvVar: normalizeIdentifier(server.bearerTokenEnvVar, ""),
    command: readString(server.command).slice(0, 500),
    description: readString(server.description).slice(0, 500),
    enabled: server.enabled ?? true,
    env: normalizeNameValues(server.env),
    headers: normalizeNameValues(server.headers),
    lastDiscoveredAt: normalizeOptionalNumber(server.lastDiscoveredAt),
    lastDiscoveryError:
      readString(server.lastDiscoveryError).slice(0, 500) || null,
    id: normalizeIdentifier(server.id, `custom-server-${index + 1}`),
    name: readString(server.name).slice(0, 120) || `Custom MCP ${index + 1}`,
    transport: normalizeCustomMcpTransportKind(server.transport),
    tools: Array.isArray(server.tools)
      ? server.tools
          .slice(0, 200)
          .map((tool, toolIndex) =>
            normalizeCustomMcpServerTool(tool, toolIndex),
          )
      : [],
    url: readString(server.url).slice(0, 1000),
  };
}

function normalizeCustomMcpServerTool(
  tool: Partial<CustomMcpServerToolSetting>,
  index: number,
): CustomMcpServerToolSetting {
  return {
    audit: normalizeToolAuditPolicy(tool.audit),
    confirmation: normalizeToolConfirmationPolicy(tool.confirmation),
    description: readString(tool.description).slice(0, 1200),
    discoveredAt: normalizeOptionalNumber(tool.discoveredAt),
    enabled: tool.enabled ?? true,
    inputSchema: normalizeMcpInputSchema(tool.inputSchema),
    name: normalizeToolName(tool.name, `tool-${index + 1}`),
    risk: normalizeToolRiskLevel(tool.risk),
    title: readString(tool.title).slice(0, 120),
  };
}

function normalizeCustomMcpSkillDirectory(
  directory: Partial<CustomMcpSkillDirectorySetting>,
  index: number,
): CustomMcpSkillDirectorySetting {
  const path = readString(directory.path).slice(0, 1000);
  return {
    enabled: directory.enabled ?? true,
    id: normalizeIdentifier(directory.id, `skills-${index + 1}`),
    path:
      normalizeCustomMcpSkillDirectoryPath(path) ||
      (index === 0 ? DEFAULT_CUSTOM_SKILLS_DIRECTORY : ""),
  };
}

function normalizeCustomMcpSkillDirectoryPath(path: string) {
  return path === ERRONEOUS_CODEX_SKILLS_DIRECTORY
    ? DEFAULT_CUSTOM_SKILLS_DIRECTORY
    : path;
}

function normalizeKeybindings(
  keybindings: Partial<KeybindingSetting>[] | undefined,
): KeybindingSetting[] {
  if (!keybindings || keybindings.length === 0) {
    return defaultKeybindings;
  }

  const defaultsByAction = new Map(
    defaultKeybindings.map((keybinding) => [keybinding.action, keybinding]),
  );
  const normalizedByAction = new Map<string, KeybindingSetting>();

  for (const keybinding of defaultKeybindings) {
    normalizedByAction.set(keybinding.action, keybinding);
  }

  for (const keybinding of keybindings) {
    if (!keybinding || typeof keybinding.action !== "string") {
      continue;
    }

    const fallback = defaultsByAction.get(keybinding.action);
    const binding =
      readString(keybinding.binding) ||
      readString(keybinding.windowsBinding) ||
      fallback?.binding ||
      "";
    const windowsBinding =
      readString(keybinding.windowsBinding) ||
      fallback?.windowsBinding ||
      binding;
    const macBinding =
      readString(keybinding.macBinding) || fallback?.macBinding || binding;

    normalizedByAction.set(keybinding.action, {
      action: keybinding.action,
      binding,
      description:
        readString(keybinding.description) || fallback?.description || "",
      editable: keybinding.editable ?? fallback?.editable ?? false,
      label:
        readString(keybinding.label) || fallback?.label || keybinding.action,
      macBinding,
      scope:
        normalizeKeybindingScope(keybinding.scope) ??
        fallback?.scope ??
        "global",
      windowsBinding,
    });
  }

  return [
    ...defaultKeybindings.map(
      (keybinding) => normalizedByAction.get(keybinding.action) ?? keybinding,
    ),
    ...[...normalizedByAction.values()].filter(
      (keybinding) => !defaultsByAction.has(keybinding.action),
    ),
  ];
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeIdentifier(value: unknown, fallback: string) {
  const text = readString(value)
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return text || fallback;
}

function normalizeToolName(value: unknown, fallback: string) {
  const text = readString(value)
    .replace(/[^A-Za-z0-9._:/-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);
  return text || fallback;
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const numberValue = normalizeOptionalNumber(value);
  if (numberValue === null) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(numberValue), min), max);
}

function normalizeStringList(
  values: unknown,
  maxItems: number,
  maxLength: number,
) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => readString(value).slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeNameValues(values: unknown): CustomMcpNameValue[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const item = value as Partial<CustomMcpNameValue>;
      const name = readString(item.name).slice(0, 120);
      if (!name) {
        return null;
      }
      return {
        name,
        value: readString(item.value).slice(0, 1000),
      };
    })
    .filter((item): item is CustomMcpNameValue => item !== null)
    .slice(0, 60);
}

function normalizeMcpInputSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { properties: {}, required: [], type: "object" };
}

function normalizeCustomMcpTransportKind(
  value: CustomMcpTransportKind | "sse" | "webSocket" | undefined,
): CustomMcpTransportKind {
  if (value === "stdio" || value === "http") {
    return value;
  }
  if (value === "sse" || value === "webSocket") {
    return "http";
  }
  return "stdio";
}

function normalizeToolRiskLevel(
  value: ToolRiskLevel | undefined,
): ToolRiskLevel {
  if (
    value === "read" ||
    value === "write" ||
    value === "remote" ||
    value === "batch" ||
    value === "destructive"
  ) {
    return value;
  }
  return "remote";
}

function normalizeToolConfirmationPolicy(
  value: ToolConfirmationPolicy | undefined,
): ToolConfirmationPolicy {
  if (value === "auto" || value === "contextual" || value === "always") {
    return value;
  }
  return "always";
}

function normalizeToolAuditPolicy(
  value: ToolAuditPolicy | undefined,
): ToolAuditPolicy {
  if (value === "summary" || value === "full") {
    return value;
  }
  return "summary";
}

function normalizeTerminalInlineSuggestion(
  settings: Partial<TerminalInlineSuggestionSettings> | undefined,
): TerminalInlineSuggestionSettings {
  const defaults = defaultTerminalAppearance.inlineSuggestion;
  const providers: Partial<TerminalInlineSuggestionProviderSettings> =
    settings?.providers ?? {};
  return {
    acceptKey: normalizeTerminalInlineSuggestionAcceptKey(settings?.acceptKey),
    enabled: readBoolean(settings?.enabled, defaults.enabled),
    productionHostPolicy: normalizeTerminalInlineSuggestionProductionHostPolicy(
      settings?.productionHostPolicy,
    ),
    providers: {
      ai: readBoolean(providers.ai, defaults.providers.ai),
      git: readBoolean(providers.git, defaults.providers.git),
      history: readBoolean(providers.history, defaults.providers.history),
      remoteCommand: readBoolean(
        providers.remoteCommand,
        defaults.providers.remoteCommand,
      ),
      remotePath: readBoolean(
        providers.remotePath,
        defaults.providers.remotePath,
      ),
      spec: readBoolean(providers.spec, defaults.providers.spec),
    },
    remoteProbeEnabled: readBoolean(
      settings?.remoteProbeEnabled,
      defaults.remoteProbeEnabled,
    ),
    auditRetentionDays: normalizeBoundedInteger(
      settings?.auditRetentionDays,
      defaults.auditRetentionDays,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
    ),
    feedbackRetentionDays: normalizeBoundedInteger(
      settings?.feedbackRetentionDays,
      defaults.feedbackRetentionDays,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
    ),
  };
}

function normalizeTerminalInlineSuggestionAcceptKey(
  value: TerminalInlineSuggestionAcceptKey | undefined,
): TerminalInlineSuggestionAcceptKey {
  if (value === "disabled" || value === "rightArrow") {
    return value;
  }
  return defaultTerminalAppearance.inlineSuggestion.acceptKey;
}

function normalizeTerminalInlineSuggestionProductionHostPolicy(
  value: TerminalInlineSuggestionProductionHostPolicy | undefined,
): TerminalInlineSuggestionProductionHostPolicy {
  if (value === "normal" || value === "restricted") {
    return value;
  }
  return defaultTerminalAppearance.inlineSuggestion.productionHostPolicy;
}

function normalizeKeybindingScope(
  value: KeybindingScope | undefined,
): KeybindingScope | undefined {
  if (value === "global" || value === "terminal" || value === "workspace") {
    return value;
  }
  return undefined;
}

export function terminalColorSchemeForTheme(
  terminal: TerminalAppearance,
  resolvedTheme: ResolvedTheme,
) {
  return resolvedTheme === "light"
    ? terminal.lightColorScheme
    : terminal.darkColorScheme;
}

export function terminalFontWeightValue(fontWeight: TerminalFontWeight) {
  if (fontWeight === "bold") {
    return 600;
  }
  if (fontWeight === "medium") {
    return 500;
  }
  return 400;
}

function normalizeInterfaceLanguage(
  value: InterfaceLanguage | undefined,
): InterfaceLanguage {
  if (value === "system" || value === "zhCN" || value === "enUS") {
    return value;
  }
  return defaultAppearanceSettings.interfaceLanguage;
}

function normalizeBackgroundImageFit(
  value: BackgroundImageFit | undefined,
): BackgroundImageFit {
  if (value === "cover" || value === "contain" || value === "tile") {
    return value;
  }
  return defaultAppearanceSettings.backgroundFit;
}

function normalizeThemeMode(value: ThemeMode | undefined): ThemeMode {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return defaultAppSettings.themeMode;
}

function normalizeInterfaceDensity(
  value: InterfaceDensity | undefined,
): InterfaceDensity {
  if (value === "compact" || value === "comfortable" || value === "spacious") {
    return value;
  }
  return defaultAppSettings.interfaceDensity;
}

function normalizeTerminalColorScheme(
  value: TerminalColorScheme | undefined,
): TerminalColorScheme {
  if (
    value === "kerminal" ||
    value === "tokyoNight" ||
    value === "solarized" ||
    value === "github"
  ) {
    return value;
  }
  return defaultTerminalAppearance.colorScheme;
}

function normalizeTerminalCursorStyle(
  value: TerminalCursorStyle | undefined,
): TerminalCursorStyle {
  if (value === "block" || value === "bar" || value === "underline") {
    return value;
  }
  return defaultTerminalAppearance.cursorStyle;
}

function normalizeTerminalFontWeight(
  value: TerminalFontWeight | undefined,
): TerminalFontWeight {
  if (value === "normal" || value === "medium" || value === "bold") {
    return value;
  }
  return defaultTerminalAppearance.fontWeight;
}

function normalizeTerminalRightClickBehavior(
  value: TerminalRightClickBehavior | undefined,
): TerminalRightClickBehavior {
  if (value === "none" || value === "paste" || value === "menu") {
    return value;
  }
  return defaultTerminalAppearance.rightClickBehavior;
}

function normalizeCommandApprovalPolicy(
  value: AiCommandApprovalPolicy | undefined,
  requireRemoteApproval: boolean | undefined,
): AiCommandApprovalPolicy {
  if (value === "always" || value === "risky" || value === "relaxed") {
    return value;
  }
  return requireRemoteApproval === false ? "relaxed" : "risky";
}

export function resolveThemeMode(
  themeMode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (themeMode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return themeMode;
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}
