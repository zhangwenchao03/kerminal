import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsToolContent } from "./SettingsToolContent";
import { defaultAppSettings, type AppSettings } from "./settingsModel";
import { xtermThemeFor } from "./terminalTheme";

const fileDialogMock = vi.hoisted(() => ({
  getAppSkillsDirectory: vi.fn(),
  openLocalDirectory: vi.fn(),
  selectLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
}));
const toolRegistryApiMock = vi.hoisted(() => ({
  discoverMcpServerTools: vi.fn(),
  getMcpGatewayManifest: vi.fn(),
  getMcpHttpServerStatus: vi.fn(),
  startMcpHttpServer: vi.fn(),
}));
const terminalSuggestionApiMock = vi.hoisted(() => ({
  cleanupTerminalSuggestionDiagnostics: vi.fn(),
  getTerminalSuggestionTelemetryExport: vi.fn(),
  getTerminalSuggestionTelemetrySummary: vi.fn(),
}));
const updaterApiMock = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
  installPendingAppUpdate: vi.fn(),
}));

vi.mock("../../lib/fileDialogApi", () => ({
  getAppSkillsDirectory: fileDialogMock.getAppSkillsDirectory,
  openLocalDirectory: fileDialogMock.openLocalDirectory,
  selectLocalDirectory: fileDialogMock.selectLocalDirectory,
  selectLocalFile: fileDialogMock.selectLocalFile,
}));
vi.mock("../../lib/toolRegistryApi", () => toolRegistryApiMock);
vi.mock("../../lib/terminalSuggestionApi", () => terminalSuggestionApiMock);
vi.mock("../../lib/updaterApi", () => updaterApiMock);

describe("SettingsToolContent appearance preview theme resolution", () => {
  beforeEach(() => {
    fileDialogMock.getAppSkillsDirectory.mockReset();
    fileDialogMock.getAppSkillsDirectory.mockResolvedValue(
      "C:\\Users\\dev\\.kerminal\\skills",
    );
    fileDialogMock.openLocalDirectory.mockReset();
    fileDialogMock.openLocalDirectory.mockResolvedValue(undefined);
    fileDialogMock.selectLocalDirectory.mockReset();
    fileDialogMock.selectLocalDirectory.mockResolvedValue(null);
    fileDialogMock.selectLocalFile.mockReset();
    fileDialogMock.selectLocalFile.mockResolvedValue(null);
    toolRegistryApiMock.discoverMcpServerTools.mockReset();
    toolRegistryApiMock.discoverMcpServerTools.mockResolvedValue([]);
    toolRegistryApiMock.getMcpGatewayManifest.mockReset();
    toolRegistryApiMock.getMcpGatewayManifest.mockResolvedValue(null);
    toolRegistryApiMock.getMcpHttpServerStatus.mockReset();
    toolRegistryApiMock.getMcpHttpServerStatus.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    toolRegistryApiMock.startMcpHttpServer.mockReset();
    toolRegistryApiMock.startMcpHttpServer.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
    });
    terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockReset();
    terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockResolvedValue(
      {
        auditEventsDeleted: 0,
        feedbackDeleted: 0,
        generatedAtUnixMs: 1760000000300,
        providerCacheDeleted: 0,
        telemetryRowsDeleted: 0,
      },
    );
    terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockResolvedValue(
      {
        auditEvents: [],
        generatedAtUnixMs: 1760000000200,
        persisted: {
          generatedAtUnixMs: 1760000000200,
          providers: [],
          startedAtUnixMs: 1760000000000,
          totalCandidateCount: 0,
          totalQueryCount: 0,
        },
        runtime: {
          generatedAtUnixMs: 1760000000200,
          providers: [],
          startedAtUnixMs: 1760000000100,
          totalCandidateCount: 0,
          totalQueryCount: 0,
        },
      },
    );
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockResolvedValue(
      {
        generatedAtUnixMs: 1760000000100,
        providers: [],
        startedAtUnixMs: 1760000000000,
        totalCandidateCount: 0,
        totalQueryCount: 0,
      },
    );
    updaterApiMock.checkForAppUpdate.mockReset();
    updaterApiMock.checkForAppUpdate.mockResolvedValue({ kind: "up-to-date" });
    updaterApiMock.installPendingAppUpdate.mockReset();
    updaterApiMock.installPendingAppUpdate.mockResolvedValue(undefined);
    delete document.documentElement.dataset.theme;
    mockPrefersDark(false);
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it("uses the document dark theme when system mode has no explicit resolved theme", () => {
    document.documentElement.dataset.theme = "dark";
    mockPrefersDark(false);

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: xtermThemeFor("dark", "tokyoNight").background,
      color: xtermThemeFor("dark", "tokyoNight").foreground,
    });
  });

  it("uses the document light theme before matchMedia when system mode has no explicit resolved theme", () => {
    document.documentElement.dataset.theme = "light";
    mockPrefersDark(true);

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: xtermThemeFor("light", "github").background,
      color: xtermThemeFor("light", "github").foreground,
    });
  });

  it("falls back to matchMedia when the document theme is not available", () => {
    mockPrefersDark(true);

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: xtermThemeFor("dark", "tokyoNight").background,
      color: xtermThemeFor("dark", "tokyoNight").foreground,
    });
  });

  it("uses the explicit resolved system theme for the terminal appearance preview", () => {
    const expectedTheme = xtermThemeFor("light", "github");

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        resolvedTheme="light"
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: expectedTheme.background,
      color: expectedTheme.foreground,
    });
  });
});

function systemThemeSettings(): AppSettings {
  return {
    ...defaultAppSettings,
    terminal: {
      ...defaultAppSettings.terminal,
      colorScheme: "tokyoNight",
      darkColorScheme: "tokyoNight",
      lightColorScheme: "github",
    },
    themeMode: "system",
  };
}

function mockPrefersDark(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: query === "(prefers-color-scheme: dark)" ? matches : false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}
