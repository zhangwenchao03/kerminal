import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("aiAgentRunApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("starts agent runs through Tauri with normalized context", async () => {
    invokeMock.mockResolvedValue(runResult("run-1", "running"));
    const { startAiAgentRun } = await import("./aiAgentRunApi");

    await expect(
      startAiAgentRun({
        conversationId: " conv-agent ",
        conversationSlotJson: ' {"slotKey":"ai"} ',
        goal: " 列出远程主机分组 ",
        limits: { maxIterations: 4, maxToolCalls: 2 },
      }),
    ).resolves.toMatchObject({ snapshot: { run: { id: "run-1" } } });

    expect(invokeMock).toHaveBeenCalledWith("ai_agent_run_start", {
      request: {
        conversationId: "conv-agent",
        conversationSlotJson: '{"slotKey":"ai"}',
        goal: "列出远程主机分组",
        limits: { maxIterations: 4, maxToolCalls: 2 },
      },
    });
  });

  it("gets and cancels agent runs through Tauri", async () => {
    invokeMock
      .mockResolvedValueOnce(runSnapshot("run-2", "running"))
      .mockResolvedValueOnce(runSnapshot("run-2", "cancelled"));
    const { cancelAiAgentRun, getAiAgentRun } = await import("./aiAgentRunApi");

    await expect(getAiAgentRun({ runId: " run-2 " })).resolves.toMatchObject({
      run: { id: "run-2" },
    });
    await expect(cancelAiAgentRun({ runId: " run-2 " })).resolves.toMatchObject({
      run: { status: "cancelled" },
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "ai_agent_run_get", {
      request: { runId: "run-2" },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "ai_agent_run_cancel", {
      request: { runId: "run-2" },
    });
  });

  it("resumes agent runs with the approved tool audit", async () => {
    invokeMock.mockResolvedValue(runResult("run-3", "completed"));
    const { resumeAiAgentRun } = await import("./aiAgentRunApi");

    await expect(
      resumeAiAgentRun({
        audit: {
          argumentsSummary: "host=172.16.40.104",
          completedAt: "2",
          confirmation: "always",
          createdAt: "1",
          id: "audit-1",
          invocationId: "pending-1",
          risk: "remote",
          status: "succeeded",
          toolId: "remote_host.create",
          toolTitle: "创建远程主机",
        },
        runId: " run-3 ",
      }),
    ).resolves.toMatchObject({ snapshot: { run: { id: "run-3" } } });

    expect(invokeMock).toHaveBeenCalledWith("ai_agent_run_resume", {
      request: {
        audit: expect.objectContaining({
          id: "audit-1",
          toolId: "remote_host.create",
        }),
        runId: "run-3",
      },
    });
  });

  it("retries the last agent run step through Tauri", async () => {
    invokeMock.mockResolvedValue(runResult("run-retry", "running"));
    const { retryAiAgentRunLastStep } = await import("./aiAgentRunApi");

    await expect(
      retryAiAgentRunLastStep({ runId: " run-retry " }),
    ).resolves.toMatchObject({ snapshot: { run: { id: "run-retry" } } });

    expect(invokeMock).toHaveBeenCalledWith("ai_agent_run_retry_last_step", {
      request: { runId: "run-retry" },
    });
  });

  it("rejects empty run ids before invoking Tauri", async () => {
    const { getAiAgentRun } = await import("./aiAgentRunApi");

    await expect(getAiAgentRun({ runId: "  " })).rejects.toThrow(
      "Agent run id 不能为空",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

function runSnapshot(id: string, status: string) {
  return {
    run: {
      conversationId: null,
      conversationSlotJson: null,
      createdAt: 1,
      goal: "goal",
      id,
      iteration: 0,
      maxIterations: 5,
      maxToolCalls: 5,
      status,
      updatedAt: 1,
    },
    steps: [],
  };
}

function runResult(id: string, status: string) {
  return {
    finalMessage: null,
    lastObservation: null,
    pendingInvocation: null,
    snapshot: runSnapshot(id, status),
  };
}
