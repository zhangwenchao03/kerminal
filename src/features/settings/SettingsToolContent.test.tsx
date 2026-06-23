import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  APP_SKILLS_DIRECTORY,
  clipboardMock,
  fileDialogMock,
  installClipboardMock,
  renderControlledSettings,
  renderSettingsToolContent,
  terminalSuggestionApiMock,
  toolRegistryApiMock,
} from "./SettingsToolContent.testHarness";

describe("SettingsToolContent", () => {
  it("renders Chinese appearance, terminal appearance and keybinding settings", () => {
    renderSettingsToolContent();

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
    const { unmount } = renderSettingsToolContent({
      initialSectionId: "settings-ai",
    });

    expect(screen.getByText("LLM Provider")).toBeInTheDocument();
    expect(screen.getByText("AI 安全策略")).toBeInTheDocument();
    expect(screen.queryByText("外观")).not.toBeInTheDocument();

    unmount();
    renderSettingsToolContent({ initialSectionId: "settings-terminal" });

    expect(await screen.findByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.queryByText("AI 安全策略")).not.toBeInTheDocument();
  });

  it("shows system MCP resources, prompts and skills before custom settings", async () => {
    const user = userEvent.setup();

    renderSettingsToolContent();

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
    expect(
      screen.queryByText("kerminal://settings/custom-mcp"),
    ).not.toBeInTheDocument();
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

    renderControlledSettings({
      initialSectionId: "settings-mcp",
      onSettingsChange,
    });

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

    renderSettingsToolContent();

    expect(screen.getByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /快捷键列表/ }));
    expect(screen.getByText("快捷键")).toBeInTheDocument();
    expect(screen.getByText("新建本地终端")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Windows" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "macOS" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Windows" }));
    expect(screen.getByLabelText("打开设置 Windows 快捷键")).toHaveValue(
      "Ctrl+Alt+S",
    );
    expect(screen.queryByText("Cmd+,")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "macOS" }));
    expect(screen.getByLabelText("打开设置 macOS 快捷键")).toHaveValue("Cmd+,");
    expect(screen.queryByText("Ctrl+Alt+S")).not.toBeInTheDocument();
    expect(
      screen.getByText(/默认按键尽量贴近 IntelliJ IDEA/),
    ).toBeInTheDocument();
    expect(screen.getByText("可编辑")).toBeInTheDocument();
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

  it("lets users edit and reset persisted keybindings", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    renderControlledSettings({
      initialSectionId: "settings-keybindings",
      onSettingsChange,
    });

    const openSettingsBinding =
      screen.getByLabelText("打开设置 Windows 快捷键");
    fireEvent.change(openSettingsBinding, {
      target: { value: "Ctrl+Alt+," },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keybindings: expect.arrayContaining([
          expect.objectContaining({
            action: "settings.open",
            binding: "Ctrl+Alt+,",
            windowsBinding: "Ctrl+Alt+,",
            macBinding: "Cmd+,",
          }),
        ]),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "恢复 打开设置 默认快捷键" }),
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keybindings: expect.arrayContaining([
          expect.objectContaining({
            action: "settings.open",
            binding: "Ctrl+Shift+T",
            windowsBinding: "Ctrl+Alt+S",
            macBinding: "Cmd+,",
          }),
        ]),
      }),
    );
  });

  it("shows inline suggestion telemetry in terminal settings", async () => {
    const user = userEvent.setup();
    installClipboardMock();
    renderSettingsToolContent();

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

  it("shows save state feedback", () => {
    renderSettingsToolContent({ saveState: "saved" });

    expect(screen.getByRole("status")).toHaveTextContent("设置已保存");
  });
});
