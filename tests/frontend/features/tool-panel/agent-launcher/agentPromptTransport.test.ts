import { describe, expect, it, vi } from "vitest";
import {
  agentTerminalPaneId,
  createAgentPromptTransport,
  registerAgentPromptTerminal,
} from "../../../../../src/features/tool-panel/agent-launcher/agentPromptTransport";

describe("Agent prompt transport", () => {
  it("保留 no-submit 参数并只投递到对应 session 的 input request", async () => {
    const send = vi.fn();
    const unregister = registerAgentPromptTerminal("ags-1", {
      paneId: agentTerminalPaneId("ags-1"),
      send,
    });

    const result = await createAgentPromptTransport().send({
      sessionId: "ags-1",
      submit: false,
      text: "prompt body",
    });

    expect(result.accepted).toBe(true);
    expect(send).toHaveBeenCalledWith({
      id: expect.stringMatching(/^agent-prompt-input-/),
      submit: false,
      text: "prompt body",
    });
    unregister();
  });

  it("session 或 pane 映射不可靠时安全拒绝且不向其它终端发送", async () => {
    const send = vi.fn();
    const unregister = registerAgentPromptTerminal("ags-1", {
      paneId: agentTerminalPaneId("ags-other"),
      send,
    });
    const transport = createAgentPromptTransport();

    await expect(
      transport.send({
        sessionId: "ags-1",
        submit: true,
        text: "must not leak",
      }),
    ).resolves.toEqual({ accepted: false });
    await expect(
      transport.send({
        sessionId: "missing",
        submit: true,
        text: "must not leak",
      }),
    ).resolves.toEqual({ accepted: false });
    expect(send).not.toHaveBeenCalled();
    unregister();
  });
});
