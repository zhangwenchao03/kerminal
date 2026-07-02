import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsToolContent } from "../../../../src/features/settings/SettingsToolContent";
import { defaultAppSettings, type AppSettings } from "../../../../src/features/settings/settingsModel";
import { xtermThemeFor } from "../../../../src/features/settings/terminalTheme";

const fileDialogMock = vi.hoisted(() => ({
  openLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
}));
const mcpServerApiMock = vi.hoisted(() => ({
  getMcpHttpServerStatus: vi.fn(),
  startMcpHttpServer: vi.fn(),
  stopMcpHttpServer: vi.fn(),
}));
const terminalSuggestionApiMock = vi.hoisted(() => ({
  cleanupTerminalSuggestionDiagnostics: vi.fn(),
  getTerminalSuggestionTelemetryExport: vi.fn(),
  getTerminalSuggestionTelemetrySummary: vi.fn(),
  refreshTerminalGitSuggestions: vi.fn(),
  refreshTerminalRemoteCommandSuggestions: vi.fn(),
  refreshTerminalRemoteHistorySuggestions: vi.fn(),
  refreshTerminalRemotePathSuggestions: vi.fn(),
}));
const updaterApiMock = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
  installPendingAppUpdate: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  openLocalDirectory: fileDialogMock.openLocalDirectory,
  selectLocalFile: fileDialogMock.selectLocalFile,
}));
vi.mock("../../../../src/lib/mcpServerApi", () => mcpServerApiMock);
vi.mock("../../../../src/lib/terminalSuggestionApi", () => terminalSuggestionApiMock);
vi.mock("../../../../src/lib/updaterApi", () => updaterApiMock);

describe("SettingsToolContent appearance preview theme resolution", () => {
  beforeEach(() => {
    fileDialogMock.openLocalDirectory.mockReset();
    fileDialogMock.openLocalDirectory.mockResolvedValue(undefined);
    fileDialogMock.selectLocalFile.mockReset();
    fileDialogMock.selectLocalFile.mockResolvedValue(null);
    mcpServerApiMock.getMcpHttpServerStatus.mockReset();
    mcpServerApiMock.getMcpHttpServerStatus.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    mcpServerApiMock.startMcpHttpServer.mockReset();
    mcpServerApiMock.startMcpHttpServer.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
    });
    mcpServerApiMock.stopMcpHttpServer.mockReset();
    mcpServerApiMock.stopMcpHttpServer.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
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
    terminalSuggestionApiMock.refreshTerminalGitSuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalGitSuggestions.mockResolvedValue([]);
    terminalSuggestionApiMock.refreshTerminalRemoteCommandSuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalRemoteCommandSuggestions.mockResolvedValue([]);
    terminalSuggestionApiMock.refreshTerminalRemoteHistorySuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalRemoteHistorySuggestions.mockResolvedValue([]);
    terminalSuggestionApiMock.refreshTerminalRemotePathSuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalRemotePathSuggestions.mockResolvedValue([]);
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
        initialSectionId="settings-terminal"
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
        initialSectionId="settings-terminal"
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
        initialSectionId="settings-terminal"
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
        initialSectionId="settings-terminal"
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

  it("saves terminal renderer mode changes", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    render(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={onSettingsChange}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByText("终端渲染")).toBeInTheDocument();
    expect(screen.getByText("GPU 分屏")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /保持默认渲染路径/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rendererType: "cpu" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /强制尝试 WebGL/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rendererType: "gpu" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /失败时自动回退/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rendererType: "auto" }),
      }),
    );
  });

  it("searches settings and opens the matching section", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    await user.type(screen.getByLabelText("搜索设置"), "WebGL");
    await user.click(screen.getByRole("button", { name: "打开设置项：终端渲染" }));

    expect(screen.getByText("终端渲染")).toBeInTheDocument();
    expect(screen.getByText("GPU 分屏")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索设置")).toHaveValue("");
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
