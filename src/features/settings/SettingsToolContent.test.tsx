import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_MCP_ENDPOINT,
  clipboardMock,
  installClipboardMock,
  renderControlledSettings,
  renderSettingsToolContent,
  terminalSuggestionApiMock,
  mcpServerApiMock,
} from "./__tests__/support/SettingsToolContent.testHarness";

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
      screen.getByRole("button", { name: /MCP/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /桌面/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /SFTP/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^终端$/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("MCP Resources")).not.toBeInTheDocument();
    expect(screen.queryByText("新建本地终端")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /关于/ })).toBeInTheDocument();
    expect(screen.queryByText("关于 Kerminal")).not.toBeInTheDocument();
  });

  it("maps legacy terminal section links to current visible sections", async () => {
    renderSettingsToolContent({ initialSectionId: "settings-terminal" });

    expect(await screen.findByText("终端外观")).toBeInTheDocument();
    expect(screen.getByText("外观")).toBeInTheDocument();
  });

  it("shows minimal MCP server status, endpoint and controls", async () => {
    const user = userEvent.setup();

    renderSettingsToolContent();

    await user.click(screen.getByRole("button", { name: /MCP/ }));

    expect(await screen.findByRole("heading", { name: "MCP" })).toBeInTheDocument();
    expect(screen.getByText("状态")).toBeInTheDocument();
    expect(screen.getByText("endpoint")).toBeInTheDocument();
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(await screen.findByText("运行中")).toBeInTheDocument();
    expect(screen.getByText(AGENT_MCP_ENDPOINT)).toBeInTheDocument();
    expect(screen.getByLabelText("MCP JSON 配置")).toHaveTextContent(
      '"mcpServers"',
    );
    expect(screen.getByLabelText("MCP JSON 配置")).toHaveTextContent(
      AGENT_MCP_ENDPOINT,
    );
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "启动" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制 JSON" })).toBeEnabled();
    expect(screen.queryByText("外部 Agent 工作目录")).not.toBeInTheDocument();
    expect(screen.queryByText("Codex 配置")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude 配置")).not.toBeInTheDocument();
    expect(screen.queryByText("bind")).not.toBeInTheDocument();
    expect(screen.queryByText("port")).not.toBeInTheDocument();
    expect(screen.queryByText("应用内 rmcp 网关")).not.toBeInTheDocument();
    expect(screen.queryByText("本地 stdio MCP Server")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制 HTTP MCP endpoint" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("MCP 工具目录")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP Resources")).not.toBeInTheDocument();
    expect(screen.queryByText("MCP Prompts")).not.toBeInTheDocument();
    expect(screen.queryByText("kerminal://agent/skills")).not.toBeInTheDocument();
    expect(screen.queryByText("kerminal.agent.route")).not.toBeInTheDocument();
    expect(screen.queryByText("SFTP 文件管理与传输")).not.toBeInTheDocument();
    expect(screen.queryByText("受控确认")).not.toBeInTheDocument();
    expect(mcpServerApiMock.getMcpHttpServerStatus).toHaveBeenCalled();
  });

  it("copies MCP JSON without changing settings", async () => {
    const onSettingsChange = vi.fn();

    renderControlledSettings({
      initialSectionId: "settings-mcp",
      onSettingsChange,
    });

    expect(await screen.findByRole("heading", { name: "MCP" })).toBeInTheDocument();
    expect(await screen.findByText(AGENT_MCP_ENDPOINT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制 JSON" }));
    await waitFor(() =>
      expect(clipboardMock.writeText).toHaveBeenLastCalledWith(
        expect.stringContaining('"mcpServers"'),
      ),
    );
    expect(clipboardMock.writeText).toHaveBeenLastCalledWith(
      expect.stringContaining(AGENT_MCP_ENDPOINT),
    );
    expect(await screen.findByText("已复制")).toBeInTheDocument();
    expect(onSettingsChange).not.toHaveBeenCalled();
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
    expect(screen.getByText("IntelliJ IDEA")).toBeInTheDocument();
    expect(screen.getByText("默认沿用 IntelliJ IDEA。")).toBeInTheDocument();
    expect(screen.getByText("可编辑")).toBeInTheDocument();
    expect(screen.queryByText("终端外观")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /MCP/ }));
    expect(await screen.findByRole("heading", { name: "MCP" })).toBeInTheDocument();
    expect(screen.queryByText("MCP Resources")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /桌面/ }));
    expect(screen.getByText("桌面通知")).toBeInTheDocument();
    expect(screen.getByLabelText("启用桌面通知")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "MCP" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /SFTP/ }));
    expect(screen.getByText("SFTP 传输")).toBeInTheDocument();
    expect(screen.getByLabelText("全局传输并发")).toBeInTheDocument();

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
