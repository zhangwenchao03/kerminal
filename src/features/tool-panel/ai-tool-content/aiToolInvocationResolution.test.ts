import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiToolAuditRecord,
  AiToolPendingInvocation,
} from "../../../lib/aiToolInvocationApi";
import { confirmAiToolInvocation } from "../../../lib/aiToolInvocationApi";
import {
  aiAgentRunResultChangesRemoteHostTree,
  aiToolChangesRemoteHostTree,
  resolveAiToolInvocation,
} from "./aiToolInvocationResolution";

vi.mock("../../../lib/aiToolInvocationApi", () => ({
  confirmAiToolInvocation: vi.fn(),
}));

const confirmAiToolInvocationMock = vi.mocked(confirmAiToolInvocation);

function remoteHostInvocation(
  toolId:
    | "remote_host.create"
    | "remote_host.ensure"
    | "remote_host.update",
): AiToolPendingInvocation {
  return {
    argumentsSummary: "host=172.16.40.105, username=root, groupName=bwy",
    audit: "summary",
    confirmation: "always",
    createdAt: "1",
    id: "pending-host",
    reason: "AI 请求保存远程主机。",
    requestedBy: "kerminal-agent",
    requiresConfirmation: true,
    risk: "remote",
    status: "pending",
    toolId,
    toolTitle: "保存远程主机",
  };
}

function auditRecord(status: AiToolAuditRecord["status"]): AiToolAuditRecord {
  return {
    argumentsSummary: "host=172.16.40.105, username=root, groupName=bwy",
    completedAt: "2",
    confirmation: "always",
    createdAt: "1",
    error: status === "failed" ? "创建失败" : null,
    id: "audit-host",
    invocationId: "pending-host",
    resultSummary: status === "succeeded" ? "已保存远程主机。" : null,
    risk: "remote",
    status,
    toolId: "remote_host.ensure",
    toolTitle: "保存远程主机",
  };
}

describe("resolveAiToolInvocation", () => {
  beforeEach(() => {
    confirmAiToolInvocationMock.mockReset();
  });

  it("refreshes the machine sidebar after remote_host.ensure succeeds", async () => {
    const onRemoteHostCreated = vi.fn().mockResolvedValue(undefined);
    confirmAiToolInvocationMock.mockResolvedValue(auditRecord("succeeded"));

    await resolveAiToolInvocation({
      approved: true,
      handlers: { onRemoteHostCreated },
      invocation: remoteHostInvocation("remote_host.ensure"),
    });

    expect(confirmAiToolInvocationMock).toHaveBeenCalledWith({
      approved: true,
      invocationId: "pending-host",
    });
    expect(onRemoteHostCreated).toHaveBeenCalledTimes(1);
  });

  it("does not refresh remote hosts when approval execution fails", async () => {
    const onRemoteHostCreated = vi.fn().mockResolvedValue(undefined);
    confirmAiToolInvocationMock.mockResolvedValue(auditRecord("failed"));

    await resolveAiToolInvocation({
      approved: true,
      handlers: { onRemoteHostCreated },
      invocation: remoteHostInvocation("remote_host.ensure"),
    });

    expect(onRemoteHostCreated).not.toHaveBeenCalled();
  });

  it("treats remote host mutation tools as machine sidebar refreshes", () => {
    expect(aiToolChangesRemoteHostTree("remote_host.ensure")).toBe(true);
    expect(aiToolChangesRemoteHostTree("remote_host.update")).toBe(true);
    expect(aiToolChangesRemoteHostTree("remote_host.group_delete")).toBe(true);
    expect(aiToolChangesRemoteHostTree("remote_host.tree")).toBe(false);
    expect(aiToolChangesRemoteHostTree("ssh.connect")).toBe(false);
  });

  it("detects new remote host mutations in agent run observations", () => {
    const baseResult = {
      finalMessage: "已更新远程主机。",
      lastObservation: null,
      pendingInvocation: null,
      snapshot: {
        run: {
          conversationId: "chat-1",
          conversationSlotJson: null,
          createdAt: 1,
          goal: "更新远程主机",
          id: "run-1",
          iteration: 1,
          maxIterations: 20,
          maxToolCalls: 5,
          status: "completed" as const,
          updatedAt: 2,
        },
        steps: [
          {
            createdAt: 1,
            id: "step-observation",
            inputJson: null,
            kind: "observation" as const,
            observationJson: {
              auditId: "audit-new",
              data: { hostId: "host-bwy" },
              entities: [{ id: "host-bwy", type: "remoteHost" }],
              status: "succeeded",
            },
            runId: "run-1",
            status: "succeeded" as const,
            summary: "已更新远程主机。",
            toolId: "remote_host.update",
            updatedAt: 2,
          },
        ],
      },
    };

    expect(
      aiAgentRunResultChangesRemoteHostTree({ result: baseResult }),
    ).toBe(true);
    expect(
      aiAgentRunResultChangesRemoteHostTree({
        ignoredAuditIds: ["audit-new"],
        result: baseResult,
      }),
    ).toBe(false);
  });
});
