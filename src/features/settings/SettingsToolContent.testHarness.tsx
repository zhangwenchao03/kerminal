// @author kongweiguang
import { render, screen } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, vi } from "vitest";
import { SettingsToolContent } from "./SettingsToolContent";
import { mcpGatewayManifest } from "./SettingsToolContent.testSupport";
import { defaultAppSettings } from "./settingsModel";
import type { AppSettings } from "./settingsModel";
import type {
  SettingsSaveState,
  SettingsSectionId,
} from "./settings-tool-content/types";

const settingsToolContentMocks = vi.hoisted(() => ({
  clipboardMock: {
    writeText: vi.fn(),
  },
  fileDialogMock: {
    getAppSkillsDirectory: vi.fn(),
    openLocalDirectory: vi.fn(),
    selectLocalDirectory: vi.fn(),
    selectLocalFile: vi.fn(),
  },
  openerApiMock: {
    openUrl: vi.fn(),
  },
  tauriCoreMock: {
    isTauri: vi.fn(),
  },
  terminalSuggestionApiMock: {
    cleanupTerminalSuggestionDiagnostics: vi.fn(),
    getTerminalSuggestionTelemetryExport: vi.fn(),
    getTerminalSuggestionTelemetrySummary: vi.fn(),
  },
  toolRegistryApiMock: {
    discoverMcpServerTools: vi.fn(),
    getMcpGatewayManifest: vi.fn(),
    getMcpHttpServerStatus: vi.fn(),
    startMcpHttpServer: vi.fn(),
  },
  updaterApiMock: {
    checkForAppUpdate: vi.fn(),
    installPendingAppUpdate: vi.fn(),
    relaunchApp: vi.fn(),
  },
}));

export const {
  clipboardMock,
  fileDialogMock,
  openerApiMock,
  tauriCoreMock,
  terminalSuggestionApiMock,
  toolRegistryApiMock,
  updaterApiMock,
} = settingsToolContentMocks;

export const APP_SKILLS_DIRECTORY = "C:\\Users\\dev\\.kerminal\\skills";

vi.mock("../../lib/fileDialogApi", () => ({
  getAppSkillsDirectory:
    settingsToolContentMocks.fileDialogMock.getAppSkillsDirectory,
  openLocalDirectory: settingsToolContentMocks.fileDialogMock.openLocalDirectory,
  selectLocalDirectory:
    settingsToolContentMocks.fileDialogMock.selectLocalDirectory,
  selectLocalFile: settingsToolContentMocks.fileDialogMock.selectLocalFile,
}));

vi.mock(
  "../../lib/toolRegistryApi",
  () => settingsToolContentMocks.toolRegistryApiMock,
);
vi.mock(
  "../../lib/terminalSuggestionApi",
  () => settingsToolContentMocks.terminalSuggestionApiMock,
);
vi.mock("../../lib/updaterApi", () => settingsToolContentMocks.updaterApiMock);
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: settingsToolContentMocks.tauriCoreMock.isTauri,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: settingsToolContentMocks.openerApiMock.openUrl,
}));

interface RenderSettingsToolContentOptions {
  initialSectionId?: SettingsSectionId;
  onSettingsChange?: (settings: AppSettings) => void;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  settings?: AppSettings;
}

export async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(
    screen.getByRole("option", { name: new RegExp(`^${optionName}`) }),
  );
}

export function installClipboardMock() {
  const clipboard = {
    writeText: clipboardMock.writeText,
  };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });
}

export function renderSettingsToolContent({
  initialSectionId,
  onSettingsChange = vi.fn(),
  saveError,
  saveState,
  settings = defaultAppSettings,
}: RenderSettingsToolContentOptions = {}): RenderResult {
  return render(
    <SettingsToolContent
      initialSectionId={initialSectionId}
      onSettingsChange={onSettingsChange}
      saveError={saveError}
      saveState={saveState}
      settings={settings}
    />,
  );
}

export function renderControlledSettings({
  initialSectionId,
  onSettingsChange,
}: {
  initialSectionId?: SettingsSectionId;
  onSettingsChange: (settings: AppSettings) => void;
}): RenderResult {
  function ControlledSettings() {
    const [settings, setSettings] = useState(defaultAppSettings);

    return (
      <SettingsToolContent
        initialSectionId={initialSectionId}
        onSettingsChange={(nextSettings) => {
          setSettings(nextSettings);
          onSettingsChange(nextSettings);
        }}
        settings={settings}
      />
    );
  }

  return render(<ControlledSettings />);
}

export function resetSettingsToolContentMocks() {
  fileDialogMock.getAppSkillsDirectory.mockReset();
  fileDialogMock.getAppSkillsDirectory.mockResolvedValue(
    APP_SKILLS_DIRECTORY,
  );
  fileDialogMock.openLocalDirectory.mockReset();
  fileDialogMock.openLocalDirectory.mockResolvedValue(undefined);
  fileDialogMock.selectLocalDirectory.mockReset();
  fileDialogMock.selectLocalDirectory.mockResolvedValue(null);
  fileDialogMock.selectLocalFile.mockReset();

  openerApiMock.openUrl.mockReset();
  openerApiMock.openUrl.mockResolvedValue(undefined);
  tauriCoreMock.isTauri.mockReset();
  tauriCoreMock.isTauri.mockReturnValue(true);

  toolRegistryApiMock.discoverMcpServerTools.mockReset();
  toolRegistryApiMock.discoverMcpServerTools.mockResolvedValue([
    {
      audit: "summary",
      confirmation: "always",
      description: "Read filesystem entries",
      discoveredAt: 1,
      enabled: true,
      inputSchema: { properties: {}, required: [], type: "object" },
      name: "list",
      risk: "remote",
      title: "List files",
    },
  ]);
  toolRegistryApiMock.getMcpGatewayManifest.mockReset();
  toolRegistryApiMock.getMcpGatewayManifest.mockResolvedValue(
    mcpGatewayManifest,
  );
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

  clipboardMock.writeText.mockReset();
  clipboardMock.writeText.mockResolvedValue(undefined);
  installClipboardMock();

  terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockReset();
  terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockResolvedValue(
    {
      auditEvents: [],
      generatedAtUnixMs: 1760000000200,
      persisted: {
        generatedAtUnixMs: 1760000000200,
        providers: [],
        startedAtUnixMs: 1760000000000,
        totalCandidateCount: 6,
        totalQueryCount: 4,
      },
      runtime: {
        generatedAtUnixMs: 1760000000200,
        providers: [],
        startedAtUnixMs: 1760000000100,
        totalCandidateCount: 6,
        totalQueryCount: 4,
      },
    },
  );
  terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockReset();
  terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockResolvedValue(
    {
      auditEventsDeleted: 2,
      feedbackDeleted: 1,
      generatedAtUnixMs: 1760000000300,
      providerCacheDeleted: 3,
      telemetryRowsDeleted: 0,
    },
  );
  terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockReset();
  terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockResolvedValue(
    {
      generatedAtUnixMs: 1760000000100,
      providers: [
        {
          averageElapsedMs: 1.5,
          cacheHitCount: 5,
          cacheMissCount: 1,
          candidateCount: 6,
          feedbackAcceptedCount: 2,
          feedbackDismissedCount: 1,
          feedbackSkippedCount: 0,
          lastEventUnixMs: 1760000000100,
          provider: "remoteCommand",
          queryCount: 4,
          refreshFailureCount: 0,
          refreshSuccessCount: 1,
          totalElapsedMs: 6,
        },
      ],
      startedAtUnixMs: 1760000000000,
      totalCandidateCount: 6,
      totalQueryCount: 4,
    },
  );

  updaterApiMock.checkForAppUpdate.mockReset();
  updaterApiMock.checkForAppUpdate.mockResolvedValue({ kind: "up-to-date" });
  updaterApiMock.installPendingAppUpdate.mockReset();
  updaterApiMock.installPendingAppUpdate.mockResolvedValue(undefined);
  updaterApiMock.relaunchApp.mockReset();
  updaterApiMock.relaunchApp.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetSettingsToolContentMocks();
});

export { SettingsToolContent, defaultAppSettings };
