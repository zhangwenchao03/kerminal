import { describe, expect, it } from "vitest";
import {
  createAgentWorkflowBadgeViewModel,
  createAgentWorkflowHistoryViewModel,
  createAgentWorkflowPreviewViewModel,
} from "../../../../../src/features/agent-workflow/ui";

describe("Agent Workflow UI model", () => {
  it("共享 controller 的状态 badge 语义", () => {
    expect(createAgentWorkflowBadgeViewModel("waitingForUser")).toMatchObject({
      label: "等待人工",
      status: "waitingForUser",
    });
  });

  it("仅从 preview metadata 派生来源、安全提示和过期状态", () => {
    const model = createAgentWorkflowPreviewViewModel(
      {
        byteLength: 2048,
        createdAt: "2026-07-11T00:00:00.000Z",
        expiresAt: "2026-07-11T00:01:00.000Z",
        id: "preview-1",
        kind: "selection",
        redacted: true,
        sessionId: "session-1",
        text: "瞬时正文",
        truncated: true,
      },
      new Date("2026-07-11T00:02:00.000Z"),
    );

    expect(model).toMatchObject({
      byteLabel: "2.0 KiB",
      expired: true,
      sourceLabel: "终端选区",
    });
    expect(model.warnings).toEqual([
      "已隐藏疑似凭据",
      "内容已按安全上限截断",
      "预览已过期，请重新生成",
    ]);
    expect(model).not.toHaveProperty("text");
  });

  it("历史 view model 不包含正文", () => {
    const model = createAgentWorkflowHistoryViewModel({
      action: "sent",
      createdAt: "2026-07-11T00:00:00.000Z",
      id: "history-1",
      outcome: "sent",
      sessionId: "session-1",
      submit: true,
      textBytes: 12,
    });

    expect(model).toMatchObject({
      actionLabel: "发送",
      outcomeLabel: "已发送",
      sizeLabel: "12 B",
    });
    expect(model).not.toHaveProperty("text");
  });
});
