import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsToolContent } from "../../../../src/features/settings/SettingsToolContent";
import { defaultAppSettings, type AppSettings } from "../../../../src/features/settings/settingsModel";

const fileDialogMock = vi.hoisted(() => ({
  selectLocalFile: vi.fn(),
}));
const desktopNotificationApiMock = vi.hoisted(() => ({
  currentDesktopNotificationVisibility: vi.fn(),
  sendDesktopNotification: vi.fn(),
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
}));
const updaterApiMock = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
  installPendingAppUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  selectLocalFile: fileDialogMock.selectLocalFile,
}));
vi.mock("../../../../src/lib/desktopNotificationApi", () => desktopNotificationApiMock);
vi.mock("../../../../src/lib/mcpServerApi", () => mcpServerApiMock);
vi.mock("../../../../src/lib/terminalSuggestionApi", () => terminalSuggestionApiMock);
vi.mock("../../../../src/lib/updaterApi", () => updaterApiMock);

describe("SettingsToolContent Kerminal MCP Server page", () => {
  beforeEach(() => {
    fileDialogMock.selectLocalFile.mockReset();
    fileDialogMock.selectLocalFile.mockResolvedValue(null);
    desktopNotificationApiMock.currentDesktopNotificationVisibility.mockReset();
    desktopNotificationApiMock.currentDesktopNotificationVisibility.mockReturnValue(
      "hidden",
    );
    desktopNotificationApiMock.sendDesktopNotification.mockReset();
    desktopNotificationApiMock.sendDesktopNotification.mockResolvedValue({
      reason: "will-send",
      requestedPermission: false,
      sent: true,
    });
    mcpServerApiMock.getMcpHttpServerStatus.mockReset();
    mcpServerApiMock.getMcpHttpServerStatus.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
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
    updaterApiMock.relaunchApp.mockReset();
    updaterApiMock.relaunchApp.mockResolvedValue(undefined);
  });

  it("renders only minimal MCP status, endpoint, and controls", async () => {
    render(<ControlledMcpSettings />);

    expect(await screen.findByRole("heading", { name: "MCP" })).toBeInTheDocument();
    expect(await screen.findByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("endpoint")).not.toBeVisible();
    expect(screen.getByText("JSON")).not.toBeVisible();
    expect(screen.getByText("http://127.0.0.1:30456/mcp")).not.toBeVisible();
    expect(screen.getByLabelText("MCP JSON 配置")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "启动" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制 JSON" })).not.toBeVisible();

    await userEvent.setup().click(screen.getByText("连接信息"));

    expect(screen.getByText("endpoint")).toBeVisible();
    expect(screen.getByText("JSON")).toBeVisible();
    expect(screen.getByText("http://127.0.0.1:30456/mcp")).toBeVisible();
    expect(screen.getByLabelText("MCP JSON 配置")).toHaveTextContent(
      '"mcpServers"',
    );
    expect(screen.getByLabelText("MCP JSON 配置")).toHaveTextContent(
      "http://127.0.0.1:30456/mcp",
    );
    expect(screen.getByRole("button", { name: "复制 JSON" })).toBeEnabled();
    expect(screen.queryByText("外部 Agent 工作目录")).not.toBeInTheDocument();
    expect(screen.queryByText("validator")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex 配置")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude 配置")).not.toBeInTheDocument();
    expect(screen.queryByText("bind")).not.toBeInTheDocument();
    expect(screen.queryByText("port")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制 HTTP MCP endpoint" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新状态" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("MCP 工具目录")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP Resources")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP Prompts")).not.toBeInTheDocument();
    expect(screen.queryByText("受控确认")).not.toBeInTheDocument();
    expect(screen.queryByText("contextual")).not.toBeInTheDocument();
    expect(screen.queryByText("remote")).not.toBeInTheDocument();
    expect(mcpServerApiMock.getMcpHttpServerStatus).toHaveBeenCalled();
  });

  it("notifies when the user starts the MCP server and startup fails", async () => {
    const user = userEvent.setup();
    mcpServerApiMock.getMcpHttpServerStatus.mockResolvedValueOnce({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    mcpServerApiMock.startMcpHttpServer.mockRejectedValueOnce(
      new Error("address already in use: token=secret"),
    );

    render(<ControlledMcpSettings />);

    await user.click(await screen.findByRole("button", { name: "启动" }));

    expect(await screen.findByText("MCP 服务未启动")).toBeVisible();
    const technicalDetail = screen.getByText(/address already in use/);
    expect(technicalDetail).not.toBeVisible();
    expect(technicalDetail).not.toHaveTextContent("token=secret");
    expect(desktopNotificationApiMock.sendDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          kind: "mcp.server.failed",
          notificationKey: "mcp.server.failed:start",
          port: undefined,
        },
        settings: expect.objectContaining({ enabled: true }),
        visibility: "hidden",
      }),
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
    desktopNotifications: {
      ...defaultAppSettings.desktopNotifications,
      enabled: true,
    },
  };
}
