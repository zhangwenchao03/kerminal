import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("aiAgentApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("calls the Tauri ai_chat command with a normalized request", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      contextUsed: true,
      conversationId: "chat-1",
      generatedAt: "1",
      message: "这是 AI 回复。",
      model: "gpt-test",
      providerId: "llm-1",
      providerName: "OpenAI Chat",
      responseRedacted: false,
      pendingInvocations: [
        {
          argumentsSummary: "sessionId=session-1, data=cargo test\\r",
          audit: "summary",
          clientAction: null,
          confirmation: "contextual",
          createdAt: "1",
          id: "tool-call-1",
          reason: "运行测试确认修改。",
          requestedBy: "kerminal-agent",
          requiresConfirmation: true,
          risk: "write",
          riskSummary: null,
          status: "pending",
          toolId: "terminal.write",
          toolTitle: "写入终端",
        },
      ],
      toolCount: 20,
    });
    const { sendAiChatMessage } = await import("./aiAgentApi");

    const response = await sendAiChatMessage({
      applicationContext: {
        activeToolId: "ai",
        focusedPane: {
          id: "pane-1",
          mode: "local",
          status: "online",
          title: "本地终端",
        },
      },
      conversationId: " chat-1 ",
      conversationSlotJson: ' {"slotKey":"pane:pane-1"} ',
      history: [
        { content: " 已经解释过 npm install ", role: "user" },
        { content: " 建议继续运行 npm run build ", role: "assistant" },
      ],
      message: " 解释当前输出 ",
      providerId: " llm-1 ",
      terminalContext: {
        paneId: "pane-1",
        sessionId: "session-1",
      },
    });

    expect(response.message).toBe("这是 AI 回复。");
    expect(response.pendingInvocations).toHaveLength(1);
    expect(response.visionUsage).toEqual({
      attachments: [],
      providerSupportsVision: false,
      visionAdapterEnabled: false,
    });
    expect(response.pendingInvocations[0]).toMatchObject({
      id: "tool-call-1",
      toolId: "terminal.write",
    });
    expect(invokeMock).toHaveBeenCalledWith("ai_chat", {
      request: {
        applicationContext: {
          activeToolId: "ai",
          focusedPane: {
            id: "pane-1",
            mode: "local",
            status: "online",
            title: "本地终端",
          },
        },
        conversationId: "chat-1",
        conversationSlotJson: '{"slotKey":"pane:pane-1"}',
        history: [
          { content: "已经解释过 npm install", role: "user" },
          { content: "建议继续运行 npm run build", role: "assistant" },
        ],
        message: "解释当前输出",
        providerId: "llm-1",
        terminalContext: {
          paneId: "pane-1",
          sessionId: "session-1",
        },
      },
    });
  });

  it("rejects blank messages before invoking Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    const { sendAiChatMessage } = await import("./aiAgentApi");

    await expect(sendAiChatMessage({ message: " " })).rejects.toThrow(
      "请输入要发送给 AI 的内容",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("normalizes and forwards attachment context to Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      contextUsed: true,
      conversationId: "chat-image",
      generatedAt: "1",
      message: "已读取图片附件摘要。",
      model: "gpt-test",
      providerId: "llm-1",
      providerName: "OpenAI Chat",
      responseRedacted: false,
      toolCount: 20,
      pendingInvocations: [],
    });
    const { sendAiChatMessage } = await import("./aiAgentApi");

    await sendAiChatMessage({
      attachments: [
        {
          height: 720.8,
          id: " att-1 ",
          kind: "image",
          mimeType: " image/png ",
          ocrText: " ssh deploy@10.0.0.12 -p 2222 ",
          originalName: " ssh-login.png ",
          sizeBytes: 4096.9,
          status: "available",
          visionUsage: "ocrOnly",
          width: 1280.1,
        },
      ],
      message: " 识别这张图 ",
    });

    expect(invokeMock).toHaveBeenCalledWith("ai_chat", {
      request: expect.objectContaining({
        attachments: [
          expect.objectContaining({
            height: 720,
            id: "att-1",
            kind: "image",
            mimeType: "image/png",
            ocrText: "ssh deploy@10.0.0.12 -p 2222",
            originalName: "ssh-login.png",
            sizeBytes: 4096,
            status: "available",
            visionUsage: "ocrOnly",
            width: 1280,
          }),
        ],
        message: "识别这张图",
      }),
    });
  });

  it("streams process steps and response chunks while preserving the final response", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      contextUsed: true,
      conversationId: "chat-1",
      generatedAt: "1",
      message: "第一段回复。\n\n第二段回复。",
      model: "gpt-test",
      providerId: "llm-1",
      providerName: "OpenAI Chat",
      responseRedacted: false,
      toolCount: 20,
      pendingInvocations: [],
    });
    const { streamAiChatMessage } = await import("./aiAgentApi");
    const steps: string[] = [];
    const deltas: string[] = [];

    const response = await streamAiChatMessage(
      {
        conversationId: "chat-1",
        message: "解释当前输出",
        providerId: "llm-1",
        terminalContext: {
          paneId: "pane-1",
          sessionId: "session-1",
        },
      },
      {
        chunkDelayMs: 0,
        onDelta: (delta) => deltas.push(delta),
        onStep: (step) => steps.push(`${step.id}:${step.status}:${step.title}`),
      },
    );

    expect(response.message).toBe("第一段回复。\n\n第二段回复。");
    expect(deltas.join("")).toBe(response.message);
    expect(steps).toContain("prepare:active:整理请求");
    expect(steps).toContain("provider:done:模型已返回");
    expect(steps).toContain("complete:done:完成");
  });

  it("returns a Chinese browser preview outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { sendAiChatMessage } = await import("./aiAgentApi");

    const response = await sendAiChatMessage({
      applicationContext: {
        activeToolId: "ai",
        focusedPane: {
          id: "pane-preview",
          mode: "local",
          status: "online",
          title: "预览终端",
        },
      },
      message: "帮我解释报错",
      terminalContext: {
        paneId: "pane-preview",
        sessionId: "session-preview",
      },
    });

    expect(response.providerId).toBe("browser-preview");
    expect(response.contextUsed).toBe(true);
    expect(response.message).toContain("浏览器预览");
    expect(response.message).toContain("Kerminal Agent 是当前应用的操作层");
    expect(response.message).toContain("预览终端");
    expect(response.message).toContain("帮我解释报错");
    const { browserPreviewMcpToolCount } = await import("./toolRegistryApi");
    expect(response.toolCount).toBe(browserPreviewMcpToolCount);
    expect(response.toolCount).toBeGreaterThanOrEqual(60);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("downgrades browser preview image vision input to text context", async () => {
    isTauriMock.mockReturnValue(false);
    const { sendAiChatMessage } = await import("./aiAgentApi");

    const response = await sendAiChatMessage({
      attachments: [
        {
          id: "att-preview",
          kind: "image",
          mimeType: "image/png",
          originalName: "screen.png",
          sizeBytes: 1024,
          status: "available",
          visionUsage: "visionInput",
        },
      ],
      message: "看图说一下错误",
    });

    expect(response.contextUsed).toBe(true);
    expect(response.message).toContain("浏览器预览不会发送图片像素");
    expect(response.visionUsage).toEqual({
      attachments: [
        {
          effectiveUsage: "metadataOnly",
          id: "att-preview",
          modelInput: "textContext",
          requestedUsage: "visionInput",
          warning: "浏览器预览不会发送图片像素，已降级为文本附件上下文。",
        },
      ],
      providerSupportsVision: false,
      visionAdapterEnabled: false,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("does not synthesize browser preview tool calls outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { sendAiChatMessage } = await import("./aiAgentApi");

    const response = await sendAiChatMessage({
      message: "帮我运行测试",
      terminalContext: {
        paneId: "pane-preview",
        sessionId: "session-preview",
      },
    });

    expect(response.pendingInvocations).toEqual([]);
  });
});
