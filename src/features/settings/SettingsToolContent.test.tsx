import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../../package.json";
import { SettingsToolContent } from "./SettingsToolContent";
import { mcpGatewayManifest } from "./SettingsToolContent.testSupport";
import { defaultAppSettings } from "./settingsModel";

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
const clipboardMock = vi.hoisted(() => ({
  writeText: vi.fn(),
}));
const APP_SKILLS_DIRECTORY = "C:\\Users\\dev\\.kerminal\\skills";

vi.mock("../../lib/fileDialogApi", () => ({
  getAppSkillsDirectory: fileDialogMock.getAppSkillsDirectory,
  openLocalDirectory: fileDialogMock.openLocalDirectory,
  selectLocalDirectory: fileDialogMock.selectLocalDirectory,
  selectLocalFile: fileDialogMock.selectLocalFile,
}));
vi.mock("../../lib/toolRegistryApi", () => toolRegistryApiMock);
vi.mock("../../lib/terminalSuggestionApi", () => terminalSuggestionApiMock);
vi.mock("../../lib/updaterApi", () => updaterApiMock);

async function chooseSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  optionName: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(
    screen.getByRole("option", { name: new RegExp(`^${optionName}`) }),
  );
}

function installClipboardMock() {
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

describe("SettingsToolContent", () => {
  beforeEach(() => {
    fileDialogMock.getAppSkillsDirectory.mockReset();
    fileDialogMock.getAppSkillsDirectory.mockResolvedValue(APP_SKILLS_DIRECTORY);
    fileDialogMock.openLocalDirectory.mockReset();
    fileDialogMock.openLocalDirectory.mockResolvedValue(undefined);
    fileDialogMock.selectLocalDirectory.mockReset();
    fileDialogMock.selectLocalDirectory.mockResolvedValue(null);
    fileDialogMock.selectLocalFile.mockReset();
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
  });

  it("renders Chinese appearance, terminal appearance and keybinding settings", () => {
    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "设置分类" }),
    ).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.getByLabelText("界面语言")).toBeInTheDocument();
    expect(screen.getByText("界面密度")).toBeInTheDocument();
    expect(screen.getByText("主页面背景")).toBeInTheDocument();
    expect(screen.getByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("光标形态")).toBeInTheDocument();
    expect(screen.getByText("主机安装")).toBeInTheDocument();
    expect(screen.getByText("不需要插件")).toBeInTheDocument();
    expect(screen.getByText("灰色提示诊断")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /块状光标/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /舒适/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /AI 与模型/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /MCP \/ Skills/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SFTP/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^终端$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /模型配置/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /AI 策略/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("LLM Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 安全策略")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP Resources")).not.toBeInTheDocument();
    expect(screen.queryByText("新建本地终端")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /关于/ })).toBeInTheDocument();
    expect(screen.queryByText("关于 Kerminal")).not.toBeInTheDocument();
  });

  it("can open directly on the AI section and maps the legacy terminal section to appearance", async () => {
    const { rerender } = render(
      <SettingsToolContent
        initialSectionId="settings-ai"
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    expect(screen.getByText("LLM Provider")).toBeInTheDocument();
    expect(screen.getByText("AI 安全策略")).toBeInTheDocument();
    expect(screen.queryByText("外观")).not.toBeInTheDocument();

    rerender(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    expect(await screen.findByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.queryByText("AI 安全策略")).not.toBeInTheDocument();
  });

  it("shows system MCP resources, prompts and skills before custom settings", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: /MCP \/ Skills/ }));

    expect(
      await screen.findByRole("heading", { name: "MCP / Skills" }),
    ).toBeInTheDocument();
    expect(screen.getByText("MCP Resources")).toBeInTheDocument();
    expect(screen.getByText("MCP Prompts")).toBeInTheDocument();
    expect(screen.getByText("系统 MCP 服务 / 外部集成")).toBeInTheDocument();
    expect(
      await screen.findByText("http://127.0.0.1:30456/mcp"),
    ).toBeInTheDocument();
    expect(screen.queryByText("应用内 rmcp 网关")).not.toBeInTheDocument();
    expect(screen.queryByText("本地 stdio MCP Server")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制 HTTP MCP endpoint" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制 HTTP MCP JSON 配置" }),
    ).toBeInTheDocument();
    expect(screen.getByText("MCP 工具目录")).toBeInTheDocument();
    expect(screen.getByText("3 tools exposed")).toBeInTheDocument();
    expect(screen.queryByText("自定义 MCP 工具")).not.toBeInTheDocument();
    expect(screen.queryByText("agent.query")).not.toBeInTheDocument();
    expect(screen.queryByText("server: agent")).not.toBeInTheDocument();
    expect(screen.getByText("Skills 路由")).toBeInTheDocument();
    expect(screen.getByText("kerminal://agent/skills")).toBeInTheDocument();
    expect(screen.queryByText("kerminal://settings/custom-mcp")).not.toBeInTheDocument();
    expect(screen.getByText("kerminal.agent.route")).toBeInTheDocument();
    expect(screen.getByText("SFTP 文件管理与传输")).toBeInTheDocument();
    expect(screen.getByText("3 tools 已覆盖")).toBeInTheDocument();
    expect(screen.getByText("用户自定义 MCP / Skills")).toBeInTheDocument();
    expect(screen.getByText("用户自定义 MCP Servers")).toBeInTheDocument();
    expect(screen.getByText("用户自定义 Skills 文件夹")).toBeInTheDocument();
    const pageText = document.body.textContent ?? "";
    expect(pageText.indexOf("Skills 路由")).toBeLessThan(
      pageText.indexOf("用户自定义 MCP / Skills"),
    );
    expect(toolRegistryApiMock.getMcpGatewayManifest).toHaveBeenCalled();
  });

  it("lets users add MCP servers in a dialog, discover tools, and manage the skills folder", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    function ControlledSettings() {
      const [settings, setSettings] = useState(defaultAppSettings);

      return (
        <SettingsToolContent
          initialSectionId="settings-mcp"
          onSettingsChange={(nextSettings) => {
            setSettings(nextSettings);
            onSettingsChange(nextSettings);
          }}
          settings={settings}
        />
      );
    }

    render(<ControlledSettings />);

    expect(
      await screen.findByRole("heading", { name: "MCP / Skills" }),
    ).toBeInTheDocument();
    expect(screen.getByText("暂无自定义 MCP Server")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加 Server" }));
    const addServerDialog = screen.getByRole("dialog", {
      name: "添加 MCP Server",
    });
    expect(addServerDialog).toBeInTheDocument();

    fireEvent.change(within(addServerDialog).getByLabelText("Server ID"), {
      target: { value: "custom.fs" },
    });
    fireEvent.change(within(addServerDialog).getByLabelText("名称"), {
      target: { value: "Filesystem MCP" },
    });
    await user.click(
      within(addServerDialog).getByRole("button", { name: "保存 Server" }),
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          mcp: expect.objectContaining({
            servers: [
              expect.objectContaining({
                id: "custom.fs",
                name: "Filesystem MCP",
              }),
            ],
          }),
        }),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: /刷新 MCP Server custom\.fs 工具/ }),
    );
    await waitFor(() =>
      expect(toolRegistryApiMock.discoverMcpServerTools).toHaveBeenCalled(),
    );
    expect(await screen.findByText("List files")).toBeInTheDocument();
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          mcp: expect.objectContaining({
            servers: [
              expect.objectContaining({
                id: "custom.fs",
                tools: [
                  expect.objectContaining({
                    name: "list",
                    title: "List files",
                  }),
                ],
              }),
            ],
          }),
        }),
      }),
    );

    expect(
      screen.queryByRole("button", { name: "添加文件夹" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("自动扫描")).toBeInTheDocument();
    expect(
      await screen.findByDisplayValue(APP_SKILLS_DIRECTORY),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开所在文件夹" }));
    expect(fileDialogMock.openLocalDirectory).toHaveBeenLastCalledWith(
      APP_SKILLS_DIRECTORY,
    );

    fileDialogMock.selectLocalDirectory.mockResolvedValueOnce(
      "C:\\Users\\dev\\skills",
    );
    await user.click(screen.getByRole("button", { name: "选择文件夹" }));
    await waitFor(() =>
      expect(fileDialogMock.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          mcp: expect.objectContaining({
            skillDirectories: [
              expect.objectContaining({
                id: "user-skills",
                path: "C:\\Users\\dev\\skills",
              }),
            ],
          }),
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "打开所在文件夹" }));
    expect(fileDialogMock.openLocalDirectory).toHaveBeenLastCalledWith(
      "C:\\Users\\dev\\skills",
    );
  });

  it("shows each settings category only after selecting it from the sidebar", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    expect(screen.getByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /快捷键列表/ }));
    expect(screen.getByText("快捷键")).toBeInTheDocument();
    expect(screen.getByText("新建本地终端")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Windows" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "macOS" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Windows" }));
    expect(screen.getByText("Ctrl+Alt+S")).toBeInTheDocument();
    expect(screen.queryByText("Cmd+,")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "macOS" }));
    expect(screen.getByText("Cmd+,")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Alt+S")).not.toBeInTheDocument();
    expect(
      screen.getByText(/默认按键尽量贴近 IntelliJ IDEA/),
    ).toBeInTheDocument();
    expect(screen.queryByText("终端外观")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /AI 与模型/ }));
    expect(screen.getByText("LLM Provider")).toBeInTheDocument();
    expect(screen.getByText("AI 安全策略")).toBeInTheDocument();
    expect(screen.queryByText("快捷键")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /MCP \/ Skills/ }));
    expect(await screen.findByText("MCP Resources")).toBeInTheDocument();
    expect(screen.queryByText("AI 安全策略")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /SFTP/ }));
    expect(screen.getByText("SFTP 传输")).toBeInTheDocument();
    expect(screen.getByLabelText("全局传输并发")).toBeInTheDocument();
    expect(screen.queryByText("AI 安全策略")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /主题外观/ }));
    expect(screen.getByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("光标形态")).toBeInTheDocument();
  });

  it("shows inline suggestion telemetry in terminal settings", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    expect(screen.getByText("灰色提示诊断")).toBeInTheDocument();
    expect(await screen.findByText("4 次")).toBeInTheDocument();
    expect(screen.getByText("5/1")).toBeInTheDocument();
    expect(screen.getByText("平均 1.5 ms")).toBeInTheDocument();
    expect(
      terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary,
    ).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "复制灰色提示诊断" }));
    await waitFor(() => {
      expect(
        terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport,
      ).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(clipboardMock.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"persisted"'),
      );
    });
    expect(await screen.findByText("已复制")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "清理灰色提示过期诊断" }),
    );
    await waitFor(() => {
      expect(
        terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics,
      ).toHaveBeenCalledWith({
        auditRetentionDays: 30,
        feedbackRetentionDays: 365,
        pruneAuditEvents: true,
        pruneExpiredProviderCache: true,
        pruneFeedback: true,
        resetPersistedTelemetry: false,
      });
    });
    expect(await screen.findByText(/已清理 审计 2/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "重置灰色提示聚合统计" }),
    );
    await waitFor(() => {
      expect(
        terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics,
      ).toHaveBeenLastCalledWith({
        auditRetentionDays: 30,
        feedbackRetentionDays: 365,
        pruneAuditEvents: false,
        pruneExpiredProviderCache: false,
        pruneFeedback: false,
        resetPersistedTelemetry: true,
      });
    });
  });

  it("shows version, update and GitHub information in the about section", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: /关于/ }));

    expect(screen.getByText("关于 Kerminal")).toBeInTheDocument();
    expect(screen.getByText(`v${packageJson.version}`)).toBeInTheDocument();
    expect(screen.getByText("自动更新")).toBeInTheDocument();
    expect(screen.getByText("已启用")).toBeInTheDocument();
    expect(screen.getByText("GitHub Releases")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查更新" }));
    await waitFor(() => {
      expect(updaterApiMock.checkForAppUpdate).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("已是最新版本。")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /github.com\/kongweiguang\/kerminal/,
      }),
    ).toHaveAttribute("href", "https://github.com/kongweiguang/kerminal");
    expect(screen.getByRole("link", { name: /查看更新发布/ })).toHaveAttribute(
      "href",
      "https://github.com/kongweiguang/kerminal/releases",
    );
  });

  it("can install an available update from the about section", async () => {
    const user = userEvent.setup();
    updaterApiMock.checkForAppUpdate.mockResolvedValueOnce({
      currentVersion: packageJson.version,
      kind: "available",
      version: "0.2.0",
    });

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={defaultAppSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: /关于/ }));
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("可更新")).toBeInTheDocument();
    expect(screen.getByText(/发现 v0\.2\.0/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下载并安装" }));

    await waitFor(() => {
      expect(updaterApiMock.installPendingAppUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("updates theme mode and terminal appearance from controls", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    function ControlledSettings() {
      const [settings, setSettings] = useState(defaultAppSettings);

      return (
        <SettingsToolContent
          onSettingsChange={(nextSettings) => {
            setSettings(nextSettings);
            onSettingsChange(nextSettings);
          }}
          settings={settings}
        />
      );
    }

    render(<ControlledSettings />);

    await chooseSelectOption(user, "界面语言", "English");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ interfaceLanguage: "enUS" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "浅色" }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ themeMode: "light" }),
    );

    await user.click(screen.getByRole("button", { name: /紧凑/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ interfaceDensity: "compact" }),
    );

    await user.click(screen.getByLabelText("启用主页面背景"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ backgroundEnabled: true }),
      }),
    );

    fireEvent.change(screen.getByLabelText("背景透明度"), {
      target: { value: "72" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ backgroundOpacity: 72 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /平铺纹理/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ backgroundFit: "tile" }),
      }),
    );

    fireEvent.change(screen.getByLabelText("背景图路径"), {
      target: { value: "C:\\Users\\dev\\Pictures\\bg.png" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          backgroundImagePath: "C:\\Users\\dev\\Pictures\\bg.png",
        }),
      }),
    );

    fileDialogMock.selectLocalFile.mockResolvedValueOnce(
      "C:\\Users\\dev\\Pictures\\picked.png",
    );
    await user.click(screen.getByRole("button", { name: /浏览/ }));
    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          appearance: expect.objectContaining({
            backgroundEnabled: true,
            backgroundImagePath: "C:\\Users\\dev\\Pictures\\picked.png",
          }),
        }),
      );
    });

    await user.click(screen.getAllByRole("button", { name: /Tokyo Night/ })[1]);
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          colorScheme: "tokyoNight",
          darkColorScheme: "tokyoNight",
        }),
      }),
    );
    expect(screen.getByLabelText("终端字体预览")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("字号"), {
      target: { value: "16" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ fontSize: 16 }),
      }),
    );

    fireEvent.change(screen.getByLabelText("行高"), {
      target: { value: "1.5" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ lineHeight: 1.5 }),
      }),
    );

    await chooseSelectOption(user, "终端字重", "中等");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ fontWeight: "medium" }),
      }),
    );

    await user.click(screen.getByLabelText("选中复制"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ selectionCopy: true }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /^粘贴/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rightClickBehavior: "paste" }),
      }),
    );

    await user.click(screen.getByLabelText("显示标签序号"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ showTabNumbers: true }),
      }),
    );

    await user.click(screen.getByLabelText("关闭标签前确认"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ confirmCloseTab: false }),
      }),
    );

    await user.click(screen.getByLabelText("将 macOS Option 键作为 Meta 键"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ macOptionIsMeta: true }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /竖线光标/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ cursorStyle: "bar" }),
      }),
    );

    await user.click(screen.getByLabelText("自动重连"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ autoReconnect: false }),
      }),
    );

    await user.click(screen.getByLabelText("启用灰色提示"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({ enabled: false }),
        }),
      }),
    );

    await user.click(screen.getByLabelText("允许远端只读探测"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            remoteProbeEnabled: false,
          }),
        }),
      }),
    );

    await chooseSelectOption(user, "灰色提示接受按键", "不绑定");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            acceptKey: "disabled",
          }),
        }),
      }),
    );

    await chooseSelectOption(user, "灰色提示生产主机策略", "按普通主机");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            productionHostPolicy: "normal",
          }),
        }),
      }),
    );

    fireEvent.change(screen.getByLabelText("审计保留天数"), {
      target: { value: "45" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            auditRetentionDays: 45,
          }),
        }),
      }),
    );

    fireEvent.change(screen.getByLabelText("反馈保留天数"), {
      target: { value: "730" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            feedbackRetentionDays: 730,
          }),
        }),
      }),
    );

    await user.click(screen.getByLabelText("远端路径"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            providers: expect.objectContaining({ remotePath: false }),
          }),
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /AI 与模型/ }));
    expect(screen.getByLabelText("上下文输出上限")).toHaveValue(12);
    fireEvent.change(screen.getByLabelText("上下文输出上限"), {
      target: { value: "8" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({ contextMaxOutputBytes: 8192 }),
      }),
    );

    await user.click(screen.getByLabelText("纳入命令历史"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({ includeCommandHistory: true }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /放开模式/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({
          commandApprovalPolicy: "relaxed",
          requireRemoteApproval: false,
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /SFTP/ }));
    fireEvent.change(screen.getByLabelText("全局传输并发"), {
      target: { value: "8" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ globalTransfers: 8 }),
      }),
    );
    fireEvent.change(screen.getByLabelText("单主机并发"), {
      target: { value: "3" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ hostTransfers: 3 }),
      }),
    );
    fireEvent.change(screen.getByLabelText("流水线深度"), {
      target: { value: "96" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ pipelineDepth: 96 }),
      }),
    );
    expect(screen.getByLabelText("最大包大小")).toHaveValue(0.25);
    fireEvent.change(screen.getByLabelText("最大包大小"), {
      target: { value: "1" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ packetBytes: 256 * 1024 }),
      }),
    );
    fireEvent.change(screen.getByLabelText("请求超时"), {
      target: { value: "45" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ timeoutSeconds: 45 }),
      }),
    );
  });

  it("shows save state feedback", () => {
    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        saveState="saved"
        settings={defaultAppSettings}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("设置已保存");
  });
});
