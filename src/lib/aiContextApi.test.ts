import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("aiContextApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("calls the Tauri AI terminal context command with normalized request", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      generatedAt: "1",
      output: {
        capturedBytes: 12,
        data: "npm test",
        maxBytes: 12288,
        truncated: false,
      },
      policy: {
        includesFullHistory: false,
        includesRecentOutput: true,
        maxOutputBytes: 12288,
        mode: "currentTerminal",
        secretRedaction: true,
      },
      redacted: false,
      session: {
        cols: 80,
        id: "session-1",
        rows: 24,
        shell: "powershell.exe",
        status: "running",
      },
      source: {
        paneId: "pane-1",
        paneTitle: "本地 PowerShell",
      },
    });
    const { getAiTerminalContextSnapshot } = await import("./aiContextApi");

    const snapshot = await getAiTerminalContextSnapshot({
      paneId: "pane-1",
      paneTitle: "本地 PowerShell",
      sessionId: "session-1",
    });

    expect(snapshot.session.id).toBe("session-1");
    expect(invokeMock).toHaveBeenCalledWith("ai_terminal_context_snapshot", {
      request: {
        maxOutputBytes: 12288,
        paneId: "pane-1",
        paneTitle: "本地 PowerShell",
        sessionId: "session-1",
      },
    });
  });

  it("rejects a Tauri request before invoke when session id is missing", async () => {
    isTauriMock.mockReturnValue(true);
    const { getAiTerminalContextSnapshot } = await import("./aiContextApi");

    await expect(
      getAiTerminalContextSnapshot({ paneId: "pane-1" }),
    ).rejects.toThrow("尚未绑定终端 session");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns a Chinese browser preview context outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { getAiTerminalContextSnapshot } = await import("./aiContextApi");

    const snapshot = await getAiTerminalContextSnapshot({
      machineKind: "local",
      paneId: "pane-preview",
      paneTitle: "本地预览",
    });

    expect(snapshot.session.shell).toBe("browser-preview");
    expect(snapshot.output.data).toContain("浏览器预览模式");
    expect(snapshot.policy.secretRedaction).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("builds a terminal context request with the configured AI output limit", async () => {
    const { buildAiTerminalContextRequest } = await import("./aiContextApi");
    const { defaultAppSettings } = await import(
      "../features/settings/settingsModel"
    );

    const request = buildAiTerminalContextRequest({
      activeTab: {
        id: "tab-1",
        layout: { paneId: "pane-1", type: "pane" },
        machineId: "local-powershell",
        title: "本地终端",
      },
      focusedPane: {
        id: "pane-1",
        latencyMs: 1,
        lines: [],
        machineId: "local-powershell",
        mode: "local",
        prompt: "PS>",
        status: "online",
        title: "本地 PowerShell",
      },
      selectedMachine: {
        description: "默认本地配置",
        id: "local-powershell",
        kind: "local",
        latencyMs: 1,
        name: "PowerShell",
        status: "online",
        tags: ["local"],
      },
      sessionId: "session-1",
      settings: {
        ...defaultAppSettings,
        ai: {
          ...defaultAppSettings.ai,
          contextMaxOutputBytes: 8192,
        },
      },
    });

    expect(request).toMatchObject({
      machineId: "local-powershell",
      maxOutputBytes: 8192,
      paneId: "pane-1",
      sessionId: "session-1",
      tabId: "tab-1",
    });
  });
});
