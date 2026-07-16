import { describe, expect, it, vi } from "vitest";
import {
  DuplicateWorkspaceActionError,
  WorkspaceActionInvoker,
  WorkspaceActionRegistry,
  requireWorkspaceCapabilities,
  type WorkspaceActionCatalog,
  type WorkspaceActionExecutor,
} from "../../../../src/features/workspace-actions";

interface TestCatalog extends WorkspaceActionCatalog {
  inspect: { targetId: string };
  openTool: { toolId: string };
  remove: { targetId: string };
}

function createRegistry() {
  return new WorkspaceActionRegistry<TestCatalog>();
}

function invocation<TId extends keyof TestCatalog & string>(
  actionId: TId,
  payload: TestCatalog[TId],
  overrides: Partial<{
    expectedContextRevision: string;
    invocationKey: string;
    signal: AbortSignal;
  }> = {},
) {
  return {
    actionId,
    payload,
    context: {
      revision: "revision-2",
      capabilities: new Set(["terminal.read"]),
    },
    expectedContextRevision:
      overrides.expectedContextRevision ?? "revision-2",
    invocationKey: overrides.invocationKey,
    signal: overrides.signal,
  };
}

describe("WorkspaceActionRegistry", () => {
  it("rejects duplicate action ids", () => {
    const registry = createRegistry().register({
      id: "inspect",
      title: "检查目标",
      effect: "read",
    });

    expect(() =>
      registry.register({
        id: "inspect",
        title: "重复动作",
        effect: "read",
      }),
    ).toThrow(DuplicateWorkspaceActionError);
  });

  it("evaluates availability policies without executing the action", async () => {
    const executor: WorkspaceActionExecutor = { execute: vi.fn() };
    const registry = createRegistry().register({
      id: "inspect",
      title: "检查目标",
      effect: "read",
      availability: requireWorkspaceCapabilities("sftp.read"),
    });
    const invoker = new WorkspaceActionInvoker(registry, executor);

    await expect(
      invoker.invoke(invocation("inspect", { targetId: "pane-1" })),
    ).resolves.toEqual({
      kind: "unavailable",
      code: "missing-capability",
      reason: "缺少所需能力：sftp.read",
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("returns confirmation instead of executing protected effects", async () => {
    const executor: WorkspaceActionExecutor = { execute: vi.fn() };
    const registry = createRegistry().register({
      id: "remove",
      title: "删除目标",
      effect: "destructive",
      confirmationDetail: (_context, payload) => payload.targetId,
    });
    const invoker = new WorkspaceActionInvoker(registry, executor);

    await expect(
      invoker.invoke(invocation("remove", { targetId: "host-1" })),
    ).resolves.toEqual({
      kind: "confirmation-required",
      confirmation: {
        actionId: "remove",
        effect: "destructive",
        title: "删除目标",
        detail: "host-1",
      },
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("passes through open-tool executor results", async () => {
    const executor: WorkspaceActionExecutor = {
      execute: vi.fn().mockResolvedValue({
        kind: "open-tool",
        toolId: "sftp",
        payload: { path: "/var/log" },
      }),
    };
    const registry = createRegistry().register({
      id: "openTool",
      title: "打开工具",
      effect: "local",
    });

    await expect(
      new WorkspaceActionInvoker(registry, executor).invoke(
        invocation("openTool", { toolId: "sftp" }),
      ),
    ).resolves.toEqual({
      kind: "open-tool",
      toolId: "sftp",
      payload: { path: "/var/log" },
    });
  });
});

