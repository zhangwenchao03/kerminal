import { describe, expect, it } from "vitest";
import {
  appendAgentPromptHistory,
  canSendAgentPrompt,
  createAgentPromptHistoryItem,
  createAgentPromptQueueItem,
  dequeueAgentPrompt,
  enqueueAgentPrompt,
  normalizeAgentPromptText,
  resolveAgentWorkflowStatusView,
  toggleAgentWorkflowStatus,
} from "./agentPromptQueueModel";

describe("agentPromptQueueModel", () => {
  it("normalizes prompt line endings without trimming content", () => {
    expect(normalizeAgentPromptText(" first\r\nsecond\rthird\n")).toBe(
      " first\nsecond\nthird\n",
    );
  });

  it("creates queue items with stable metadata", () => {
    const item = createAgentPromptQueueItem({
      id: "prompt-1",
      now: new Date("2026-06-26T09:30:00.000Z"),
      text: "line1\r\nline2",
    });

    expect(item).toEqual({
      createdAt: "2026-06-26T09:30:00.000Z",
      id: "prompt-1",
      submit: true,
      text: "line1\nline2",
    });
  });

  it("dequeues prompts in FIFO order", () => {
    const first = createAgentPromptQueueItem({
      id: "prompt-1",
      now: new Date("2026-06-26T09:30:00.000Z"),
      text: "first",
    });
    const second = createAgentPromptQueueItem({
      id: "prompt-2",
      now: new Date("2026-06-26T09:31:00.000Z"),
      text: "second",
    });

    const queue = enqueueAgentPrompt(enqueueAgentPrompt([], first), second);
    expect(dequeueAgentPrompt(queue)).toEqual({
      item: first,
      queue: [second],
    });
  });

  it("rejects blank composer text", () => {
    expect(canSendAgentPrompt("  \n\t")).toBe(false);
    expect(canSendAgentPrompt("run tests")).toBe(true);
  });

  it("records prompt history newest first with a cap", () => {
    const first = createAgentPromptHistoryItem({
      action: "sent",
      id: "history-1",
      now: new Date("2026-06-26T09:30:00.000Z"),
      text: "first\r\nline",
    });
    const second = createAgentPromptHistoryItem({
      action: "queued",
      id: "history-2",
      now: new Date("2026-06-26T09:31:00.000Z"),
      submit: false,
      text: "second",
    });

    expect(appendAgentPromptHistory([first], second, 1)).toEqual([second]);
    expect(second).toEqual({
      action: "queued",
      createdAt: "2026-06-26T09:31:00.000Z",
      id: "history-2",
      submit: false,
      text: "second",
    });
  });

  it("resolves explicit workflow status labels", () => {
    expect(toggleAgentWorkflowStatus("running")).toBe("waitingForUser");
    expect(toggleAgentWorkflowStatus("waitingForUser")).toBe("running");
    expect(resolveAgentWorkflowStatusView("running")).toMatchObject({
      label: "运行中",
      tone: "running",
    });
    expect(resolveAgentWorkflowStatusView("waitingForUser")).toMatchObject({
      label: "等待人工",
      tone: "waiting",
    });
  });
});
