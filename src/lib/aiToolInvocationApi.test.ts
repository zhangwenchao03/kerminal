import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("aiToolInvocationApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("prepares tool invocations through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      argumentsSummary: "themeMode=dark",
      audit: "summary",
      confirmation: "contextual",
      createdAt: "1",
      id: "tool-call-1",
      reason: "切换深色主题",
      requestedBy: "test",
      requiresConfirmation: true,
      risk: "write",
      status: "pending",
      toolId: "settings.update_theme",
      toolTitle: "更新主题",
    });
    const { prepareAiToolInvocation } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: { themeMode: "dark" },
      conversationId: " conv-theme ",
      conversationSlotJson: ' {"slotKey":"no-context"} ',
      reason: "切换深色主题",
      requestedBy: "test",
      toolId: " settings.update_theme ",
    });

    expect(pending.id).toBe("tool-call-1");
    expect(invokeMock).toHaveBeenCalledWith("ai_tool_prepare", {
      request: {
        arguments: { themeMode: "dark" },
        conversationId: "conv-theme",
        conversationSlotJson: '{"slotKey":"no-context"}',
        reason: "切换深色主题",
        requestedBy: "test",
        runId: null,
        stepId: null,
        toolId: "settings.update_theme",
      },
    });
  });

  it("confirms tool invocations through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      auditContext: {
        conversationId: "conversation-prod",
        contextSnapshotId: "ctx-prod",
      },
      argumentsSummary: "themeMode=dark",
      completedAt: "2",
      confirmation: "contextual",
      createdAt: "1",
      error: null,
      id: "tool-audit-1",
      invocationId: "tool-call-1",
      resultSummary: "主题已更新为 Dark。",
      risk: "write",
      status: "succeeded",
      toolId: "settings.update_theme",
      toolTitle: "更新主题",
    });
    const { confirmAiToolInvocation } = await import("./aiToolInvocationApi");

    const audit = await confirmAiToolInvocation({
      approved: true,
      auditContext: {
        conversationId: "conversation-prod",
        contextSnapshotId: "ctx-prod",
      },
      invocationId: "tool-call-1",
    });

    expect(audit.status).toBe("succeeded");
    expect(audit.auditContext).toMatchObject({
      conversationId: "conversation-prod",
      contextSnapshotId: "ctx-prod",
    });
    expect(invokeMock).toHaveBeenCalledWith("ai_tool_confirm", {
      request: {
        approved: true,
        auditContext: {
          conversationId: "conversation-prod",
          contextSnapshotId: "ctx-prod",
        },
        invocationId: "tool-call-1",
      },
    });
  });

  it("lists audit records through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([]);
    const { listAiToolAudits } = await import("./aiToolInvocationApi");

    await expect(listAiToolAudits()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("ai_tool_audit_list");
  });

  it("lists pending tool invocations through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([]);
    const { listAiToolPendingInvocations } = await import("./aiToolInvocationApi");

    await expect(listAiToolPendingInvocations()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("ai_tool_pending_list");
  });

  it("lists audit records with a requested limit through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([]);
    const { listAiToolAudits } = await import("./aiToolInvocationApi");

    await expect(listAiToolAudits({ limit: 12 })).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("ai_tool_audit_list", {
      request: { limit: 12 },
    });
  });

  it("exports and clears audit records through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        count: 0,
        exportedAt: "10",
        records: [],
      })
      .mockResolvedValueOnce({ clearedCount: 0 });
    const { clearAiToolAudits, exportAiToolAudits } = await import(
      "./aiToolInvocationApi"
    );

    await expect(exportAiToolAudits({ limit: 5 })).resolves.toMatchObject({
      count: 0,
      records: [],
    });
    await expect(clearAiToolAudits()).resolves.toEqual({ clearedCount: 0 });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "ai_tool_audit_export", {
      request: { limit: 5 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "ai_tool_audit_clear");
  });

  it("uses safe browser preview pending and audit records outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      listAiToolAudits,
      listAiToolPendingInvocations,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        apiToken: "secret",
        themeMode: "dark",
      },
      reason: "预览受控主题切换",
      conversationId: "browser-conv",
      conversationSlotJson: JSON.stringify({ slotKey: "no-context" }),
      toolId: "settings.update_theme",
    });
    const audit = await confirmAiToolInvocation({
      approved: false,
      auditContext: {
        attachmentIds: ["att-ssh"],
        conversationId: "conversation-prod",
        contextSnapshotId: "ctx-prod",
      },
      invocationId: pending.id,
    });
    const pendingBeforeAuditList = await listAiToolPendingInvocations();
    const audits = await listAiToolAudits();

    expect(pending.toolTitle).toBe("更新主题");
    expect(pending.conversationId).toBe("browser-conv");
    expect(pending.conversationSlotJson).toBe(JSON.stringify({ slotKey: "no-context" }));
    expect(pending.argumentsSummary).toContain("apiToken=[已脱敏]");
    expect(audit.status).toBe("rejected");
    expect(pendingBeforeAuditList).toEqual([]);
    expect(audits[0]).toMatchObject({
      auditContext: {
        attachmentIds: ["att-ssh"],
        conversationId: "conversation-prod",
        contextSnapshotId: "ctx-prod",
      },
      invocationId: pending.id,
      status: "rejected",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps browser preview tool metadata aligned with the registry preview contract", async () => {
    isTauriMock.mockReturnValue(false);
    const { prepareAiToolInvocation } = await import("./aiToolInvocationApi");
    const { previewTools } = await import("./toolRegistryPreview");

    const enabledMcpTools = previewTools.filter(
      (tool) => tool.enabled && tool.exposedToMcp,
    );
    expect(enabledMcpTools.length).toBeGreaterThan(60);
    expect(previewTools.find((tool) => tool.id === "workflow.run")).toMatchObject({
      enabled: false,
      exposedToMcp: false,
    });

    for (const tool of enabledMcpTools) {
      const pending = await prepareAiToolInvocation({
        arguments: {},
        reason: "browser preview metadata contract",
        toolId: tool.id,
      });

      expect(pending, `preview metadata drift for ${tool.id}`).toMatchObject({
        audit: tool.audit,
        confirmation: tool.confirmation,
        risk: tool.risk,
        toolId: tool.id,
        toolTitle: tool.title,
      });
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("exports and clears browser preview audit records outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      clearAiToolAudits,
      confirmAiToolInvocation,
      exportAiToolAudits,
      listAiToolAudits,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");
    await clearAiToolAudits();

    const pending = await prepareAiToolInvocation({
      arguments: { themeMode: "dark" },
      reason: "预览导出审计",
      toolId: "settings.update_theme",
    });
    await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    const exported = await exportAiToolAudits({ limit: 1 });
    const cleared = await clearAiToolAudits();
    const auditsAfterClear = await listAiToolAudits();

    expect(exported.count).toBe(1);
    expect(exported.exportedAt).toMatch(/^\d+$/);
    expect(exported.records[0]).toMatchObject({
      invocationId: pending.id,
      status: "succeeded",
    });
    expect(cleared.clearedCount).toBe(1);
    expect(auditsAfterClear).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("escalates dangerous terminal write in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      listAiToolAudits,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        data: "sudo rm -rf /tmp/kerminal-smoke\r",
        sessionId: "session-1",
      },
      reason: "测试危险命令摘要",
      toolId: "terminal.write",
    });
    const audit = await confirmAiToolInvocation({
      approved: false,
      invocationId: pending.id,
    });
    const audits = await listAiToolAudits();

    expect(pending.risk).toBe("destructive");
    expect(pending.confirmation).toBe("always");
    expect(pending.riskSummary).toContain("递归强制删除");
    expect(pending.riskSummary).toContain("权限提升");
    expect(audit).toMatchObject({
      invocationId: pending.id,
      risk: "destructive",
      riskSummary: pending.riskSummary,
      status: "rejected",
      toolId: "terminal.write",
    });
    expect(audits[0]).toMatchObject({
      invocationId: pending.id,
      risk: "destructive",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns a safe workspace split client action in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: { direction: "horizontal" },
      reason: "测试工作区分屏",
      toolId: "workspace.split_pane",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("分割当前分屏");
    expect(pending.clientAction).toEqual({
      direction: "horizontal",
      kind: "workspaceSplitPane",
    });
    expect(pending.argumentsSummary).toBe("direction=horizontal");
    expect(audit.resultSummary).toBe("工作区左右分屏已批准，浏览器预览已执行。");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns a safe workspace focus tab client action in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: { tabId: " tab-remote " },
      reason: "测试切换终端 tab",
      toolId: "workspace.focus_tab",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("切换终端 tab");
    expect(pending.clientAction).toEqual({
      kind: "workspaceFocusTab",
      tabId: "tab-remote",
    });
    expect(pending.argumentsSummary).toBe("tabId= tab-remote ");
    expect(audit.resultSummary).toBe(
      "终端 tab 切换已批准，浏览器预览已执行。",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns a safe workspace open tool client action in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: { toolId: " sftp " },
      reason: "测试打开工具面板",
      toolId: "workspace.open_tool",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("打开工具面板");
    expect(pending.clientAction).toEqual({
      kind: "workspaceOpenTool",
      toolId: "sftp",
    });
    expect(pending.argumentsSummary).toBe("toolId= sftp ");
    expect(audit.resultSummary).toBe(
      "工具面板切换已批准，浏览器预览已执行。",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns a terminal create client action in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        args: ["-NoLogo"],
        cols: 120,
        env: { TERM: "xterm-256color" },
        rows: 32,
        shell: "pwsh.exe",
        title: "AI 本地终端",
      },
      reason: "预览新建终端",
      toolId: "terminal.create",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("新建终端");
    expect(pending.clientAction).toEqual({
      args: ["-NoLogo"],
      cols: 120,
      cwd: null,
      env: { TERM: "xterm-256color" },
      kind: "terminalCreate",
      rows: 32,
      shell: "pwsh.exe",
      title: "AI 本地终端",
    });
    expect(pending.argumentsSummary).toContain("title=AI 本地终端");
    expect(audit).toMatchObject({
      resultSummary: "本地终端已批准创建，浏览器预览已模拟打开新 tab。",
      status: "succeeded",
      toolId: "terminal.create",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews profile create with nested env redaction outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        env: {
          API_TOKEN: "secret",
          TERM: "xterm-256color",
        },
        name: "AI 临时 Profile",
        shell: "powershell.exe",
      },
      reason: "预览创建终端配置",
      toolId: "profile.create",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("创建终端配置");
    expect(pending.argumentsSummary).toContain("name=AI 临时 Profile");
    expect(pending.argumentsSummary).toContain("API_TOKEN=[已脱敏]");
    expect(pending.argumentsSummary).toContain("TERM=xterm-256color");
    expect(audit).toMatchObject({
      resultSummary: "终端配置已创建，浏览器预览已模拟写入。",
      status: "succeeded",
      toolId: "profile.create",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews workflow create as a write confirmed save-only action", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        description: "保存多步骤质量检查流程。",
        scope: "local",
        steps: [
          {
            command: "echo token=secret-value",
            requiresConfirmation: false,
            scope: "local",
            title: "检查状态",
          },
          {
            command: "npm run check",
            requiresConfirmation: true,
            scope: "local",
            title: "运行门禁",
          },
        ],
        tags: ["ai", "quality"],
        title: "本地质量检查",
      },
      reason: "预览创建命令工作流",
      toolId: "workflow.create",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("创建命令工作流");
    expect(pending.risk).toBe("write");
    expect(pending.confirmation).toBe("contextual");
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toContain("title=本地质量检查");
    expect(pending.argumentsSummary).toContain("steps=[2 项]");
    expect(pending.argumentsSummary).not.toContain("secret-value");
    expect(audit).toMatchObject({
      resultSummary: "命令工作流已创建，浏览器预览已模拟保存多步骤流程。",
      status: "succeeded",
      toolId: "workflow.create",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews remote host create as a remote always-confirmed tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        authType: "agent",
        groupId: "group-virtual",
        host: "ai-dev.internal",
        name: "AI Dev",
        port: 22,
        tags: ["ai", "dev"],
        username: "deploy",
      },
      reason: "预览创建远程主机",
      toolId: "remote_host.create",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("创建远程主机");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.argumentsSummary).not.toContain("credentialRef");
    expect(audit).toMatchObject({
      resultSummary: "远程主机已创建，浏览器预览已模拟刷新主机树。",
      status: "succeeded",
      toolId: "remote_host.create",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns an SSH connect client action in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        cols: 100,
        hostId: "dev-server",
        rows: 28,
      },
      reason: "预览打开 SSH 终端",
      toolId: "ssh.connect",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("打开 SSH 终端");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.clientAction).toEqual({
      cols: 100,
      hostId: "dev-server",
      kind: "sshConnect",
      rows: 28,
    });
    expect(audit).toMatchObject({
      resultSummary: "SSH 终端已批准打开，浏览器预览已模拟创建远程 tab。",
      status: "succeeded",
      toolId: "ssh.connect",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews SSH command as a remote confirmed tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        command: "uname -a && df -h /",
        hostId: "dev-server",
        maxOutputBytes: 4096,
        timeoutSeconds: 30,
      },
      reason: "预览远程命令",
      toolId: "ssh.command",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("执行远程命令");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe(
      "command=uname -a && df -h /, hostId=dev-server, maxOutputBytes=4096, timeoutSeconds=30",
    );
    expect(audit).toMatchObject({
      resultSummary:
        "远程命令已执行，浏览器预览已模拟返回 stdout/stderr 摘要。",
      risk: "remote",
      status: "succeeded",
      toolId: "ssh.command",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("escalates dangerous SSH command in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        command: "sudo reboot",
        hostId: "dev-server",
      },
      reason: "预览危险远程命令",
      toolId: "ssh.command",
    });
    const audit = await confirmAiToolInvocation({
      approved: false,
      invocationId: pending.id,
    });

    expect(pending.risk).toBe("destructive");
    expect(pending.confirmation).toBe("always");
    expect(pending.audit).toBe("full");
    expect(pending.riskSummary).toContain("远程命令风险");
    expect(pending.riskSummary).toContain("权限提升");
    expect(pending.riskSummary).toContain("关机或重启");
    expect(audit).toMatchObject({
      risk: "destructive",
      riskSummary: pending.riskSummary,
      status: "rejected",
      toolId: "ssh.command",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews resolved-host SSH command as a remote confirmed tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        command: "uname -a && df -h /",
        groupName: "bwy",
        host: "172.16.40.104",
        username: "root",
      },
      reason: "预览解析目标后执行远程命令",
      toolId: "ssh.command_on_resolved_host",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("解析目标后执行远程命令");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toContain("groupName=bwy");
    expect(pending.argumentsSummary).toContain("command=uname -a");
    expect(audit).toMatchObject({
      resultSummary:
        "远程命令已执行，浏览器预览已模拟返回 stdout/stderr 摘要。",
      risk: "remote",
      status: "succeeded",
      toolId: "ssh.command_on_resolved_host",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("escalates dangerous resolved-host SSH command in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        command: "sudo reboot",
        host: "172.16.40.104",
      },
      reason: "预览危险解析目标远程命令",
      toolId: "ssh.command_on_resolved_host",
    });
    const audit = await confirmAiToolInvocation({
      approved: false,
      invocationId: pending.id,
    });

    expect(pending.risk).toBe("destructive");
    expect(pending.confirmation).toBe("always");
    expect(pending.audit).toBe("full");
    expect(pending.riskSummary).toContain("远程命令风险");
    expect(pending.riskSummary).toContain("权限提升");
    expect(pending.riskSummary).toContain("关机或重启");
    expect(audit).toMatchObject({
      risk: "destructive",
      riskSummary: pending.riskSummary,
      status: "rejected",
      toolId: "ssh.command_on_resolved_host",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews server info snapshots as remote confirmed reads", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        hostId: "dev-server",
      },
      reason: "预览读取服务器信息",
      toolId: "server_info.snapshot",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("读取服务器信息");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe("hostId=dev-server");
    expect(audit).toMatchObject({
      resultSummary:
        "服务器信息已读取，浏览器预览已模拟返回 CPU、内存、磁盘和运行时间摘要。",
      status: "succeeded",
      toolId: "server_info.snapshot",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews runtime health as a read-only auto diagnostics tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {},
      reason: "预览读取运行体检",
      toolId: "diagnostics.runtime_health",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("读取运行体检");
    expect(pending.risk).toBe("read");
    expect(pending.confirmation).toBe("auto");
    expect(pending.requiresConfirmation).toBe(false);
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe("无参数");
    expect(audit).toMatchObject({
      resultSummary:
        "运行体检已读取，浏览器预览已模拟返回进程、本机资源和数据目录摘要。",
      risk: "read",
      status: "succeeded",
      toolId: "diagnostics.runtime_health",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews diagnostics bundle creation as a contextual write tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {},
      reason: "预览生成诊断包",
      toolId: "diagnostics.create_bundle",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("生成诊断包");
    expect(pending.risk).toBe("write");
    expect(pending.confirmation).toBe("contextual");
    expect(pending.requiresConfirmation).toBe(true);
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe("无参数");
    expect(audit).toMatchObject({
      resultSummary: "诊断包已生成，浏览器预览已模拟写入本地脱敏 JSON。",
      risk: "write",
      status: "succeeded",
      toolId: "diagnostics.create_bundle",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews port forward create as a remote confirmed tunnel action", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        bindHost: "127.0.0.1",
        hostId: "dev-server",
        kind: "local",
        name: "AI PostgreSQL 隧道",
        sourcePort: 15432,
        targetHost: "127.0.0.1",
        targetPort: 5432,
      },
      reason: "预览创建端口转发",
      toolId: "port_forward.create",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("创建端口转发");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe(
      "bindHost=127.0.0.1, hostId=dev-server, kind=local, name=AI PostgreSQL 隧道, sourcePort=15432, targetHost=127.0.0.1, targetPort=5432",
    );
    expect(audit).toMatchObject({
      resultSummary: "端口转发已创建，浏览器预览已模拟启动 SSH 隧道。",
      risk: "remote",
      status: "succeeded",
      toolId: "port_forward.create",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews terminal appearance update as a write tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        cursorBlink: false,
        fontSize: 14,
        lineHeight: 1.4,
        scrollback: 8000,
      },
      reason: "预览更新终端外观",
      toolId: "settings.update_terminal_appearance",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("更新终端外观");
    expect(pending.risk).toBe("write");
    expect(pending.confirmation).toBe("contextual");
    expect(pending.requiresConfirmation).toBe(true);
    expect(pending.argumentsSummary).toBe(
      "cursorBlink=false, fontSize=14, lineHeight=1.4, scrollback=8000",
    );
    expect(audit).toMatchObject({
      resultSummary:
        "终端外观已更新，浏览器预览已模拟保存字体、字号和滚屏缓冲设置。",
      risk: "write",
      status: "succeeded",
      toolId: "settings.update_terminal_appearance",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews port forward list as a read-only auto tool", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {},
      reason: "预览读取端口转发",
      toolId: "port_forward.list",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("列出端口转发");
    expect(pending.risk).toBe("read");
    expect(pending.confirmation).toBe("auto");
    expect(pending.requiresConfirmation).toBe(false);
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe("无参数");
    expect(audit).toMatchObject({
      resultSummary:
        "端口转发会话已读取，浏览器预览已模拟返回运行中隧道摘要。",
      risk: "read",
      status: "succeeded",
      toolId: "port_forward.list",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("previews port forward close as a remote confirmed tunnel action", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      confirmAiToolInvocation,
      prepareAiToolInvocation,
    } = await import("./aiToolInvocationApi");

    const pending = await prepareAiToolInvocation({
      arguments: {
        forwardId: "forward-preview",
      },
      reason: "预览关闭端口转发",
      toolId: "port_forward.close",
    });
    const audit = await confirmAiToolInvocation({
      approved: true,
      invocationId: pending.id,
    });

    expect(pending.toolTitle).toBe("关闭端口转发");
    expect(pending.risk).toBe("remote");
    expect(pending.confirmation).toBe("always");
    expect(pending.requiresConfirmation).toBe(true);
    expect(pending.audit).toBe("summary");
    expect(pending.clientAction).toBeNull();
    expect(pending.argumentsSummary).toBe("forwardId=forward-preview");
    expect(audit).toMatchObject({
      resultSummary: "端口转发已关闭，浏览器预览已模拟停止 SSH 隧道。",
      risk: "remote",
      status: "succeeded",
      toolId: "port_forward.close",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
