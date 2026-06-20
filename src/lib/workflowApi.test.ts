import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("workflowApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists workflows through Tauri with filters", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        createdAt: "now",
        description: "日常开发检查链路",
        id: "workflow-1",
        scope: "local",
        sortOrder: 10,
        steps: [],
        tags: ["quality"],
        title: "本地质量检查",
        updatedAt: "now",
      },
    ]);
    const { listWorkflows } = await import("./workflowApi");

    const workflows = await listWorkflows({ query: "npm", scope: "local" });

    expect(workflows[0].title).toBe("本地质量检查");
    expect(invokeMock).toHaveBeenCalledWith("workflow_list", {
      request: { query: "npm", scope: "local" },
    });
  });

  it("normalizes create workflow requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      createdAt: "now",
      description: null,
      id: "workflow-1",
      scope: "any",
      sortOrder: 10,
      steps: [],
      tags: ["quality"],
      title: "一键检查",
      updatedAt: "now",
    });
    const { createWorkflow } = await import("./workflowApi");

    await createWorkflow({
      steps: [
        {
          command: "npm run check",
          description: " 完整质量门禁 ",
          requiresConfirmation: true,
          title: "运行检查",
        },
      ],
      tags: [" quality ", "QUALITY"],
      title: "一键检查",
    });

    expect(invokeMock).toHaveBeenCalledWith("workflow_create", {
      request: {
        description: undefined,
        scope: "any",
        steps: [
          {
            command: "npm run check",
            description: "完整质量门禁",
            requiresConfirmation: true,
            title: "运行检查",
          },
        ],
        tags: ["quality"],
        title: "一键检查",
      },
    });
  });

  it("uses searchable browser preview workflows outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listWorkflows } = await import("./workflowApi");

    const workflows = await listWorkflows({ query: "uptime", scope: "ssh" });

    expect(workflows).toEqual([
      expect.objectContaining({
        scope: "ssh",
        title: "服务器巡检",
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
