import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsToolContent } from "./SettingsToolContent";
import { defaultAppSettings, type AppSettings } from "./settingsModel";

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

describe("SettingsToolContent MCP server discovery", () => {
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
    terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockResolvedValue({
      auditEventsDeleted: 0,
      feedbackDeleted: 0,
      generatedAtUnixMs: 1760000000300,
      providerCacheDeleted: 0,
      telemetryRowsDeleted: 0,
    });
    terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockResolvedValue({
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
    });
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockResolvedValue({
      generatedAtUnixMs: 1760000000100,
      providers: [],
      startedAtUnixMs: 1760000000000,
      totalCandidateCount: 0,
      totalQueryCount: 0,
    });
    updaterApiMock.checkForAppUpdate.mockReset();
    updaterApiMock.checkForAppUpdate.mockResolvedValue({ kind: "up-to-date" });
    updaterApiMock.installPendingAppUpdate.mockReset();
    updaterApiMock.installPendingAppUpdate.mockResolvedValue(undefined);
  });

  it("announces custom MCP server discovery failures", async () => {
    const user = userEvent.setup();
    toolRegistryApiMock.discoverMcpServerTools.mockRejectedValueOnce(
      new Error("server refused tools/list"),
    );

    render(<ControlledMcpSettings />);

    expect(
      await screen.findByRole("heading", { name: "MCP / Skills" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /刷新 MCP Server custom\.fail 工具/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "server refused tools/list",
    );
  });
});

function ControlledMcpSettings() {
  const [settings, setSettings] = useState(settingsWithFailingServer());

  return (
    <SettingsToolContent
      initialSectionId="settings-mcp"
      onSettingsChange={setSettings}
      settings={settings}
    />
  );
}

function settingsWithFailingServer(): AppSettings {
  return {
    ...defaultAppSettings,
    ai: {
      ...defaultAppSettings.ai,
      mcp: {
        ...defaultAppSettings.ai.mcp,
        servers: [
          {
            args: [],
            bearerTokenEnvVar: "",
            command: "npx",
            description: "",
            enabled: true,
            env: [],
            headers: [],
            id: "custom.fail",
            lastDiscoveredAt: null,
            lastDiscoveryError: null,
            name: "Failing MCP",
            tools: [],
            transport: "stdio",
            url: "",
          },
        ],
      },
    },
  };
}
