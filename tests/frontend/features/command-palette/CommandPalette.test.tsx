import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceActionRegistry,
  type WorkspaceActionConfirmation,
  type WorkspaceActionCatalog,
  type WorkspaceActionExecutor,
} from "../../../../src/features/workspace-actions";
import { CommandPalette } from "../../../../src/features/command-palette";

interface TestCatalog extends WorkspaceActionCatalog {
  open: undefined;
  remove: { targetId: string };
  slow: undefined;
}

function registry() {
  return new WorkspaceActionRegistry<TestCatalog>()
    .register({ effect: "local", id: "open", title: "打开文件" })
    .register({
      confirmationDetail: (_context, payload) => payload.targetId,
      effect: "destructive",
      id: "remove",
      title: "删除目标",
    })
    .register({ effect: "read", id: "slow", title: "慢速检查" });
}

function renderPalette(
  executor: WorkspaceActionExecutor,
  overrides: Partial<{
    context: { revision: string };
    onConfirmationRequired: (confirmation: WorkspaceActionConfirmation) => void;
    onOpenTool: (toolId: string, payload?: unknown) => void;
  }> = {},
) {
  const onConfirmationRequired = overrides.onConfirmationRequired ?? vi.fn();
  const onOpenTool = overrides.onOpenTool ?? vi.fn();
  render(
    <CommandPalette
      context={overrides.context ?? { revision: "r1" }}
      executor={executor}
      getPayload={(descriptor) =>
        descriptor.id === "remove" ? { targetId: "host-1" } : undefined
      }
      getPresentation={(descriptor) => ({
        category: "工作区",
        keybinding: descriptor.id === "open" ? "Ctrl+O" : undefined,
        scope: "当前目标",
      })}
      onClose={vi.fn()}
      onConfirmationRequired={onConfirmationRequired}
      onOpenTool={onOpenTool}
      open
      registry={registry()}
    />,
  );
  return { onConfirmationRequired, onOpenTool };
}

describe("CommandPalette", () => {
  it("shows category, scope, effect and keybinding, then routes open-tool", async () => {
    const executor: WorkspaceActionExecutor = {
      execute: vi.fn().mockResolvedValue({
        kind: "open-tool",
        payload: { path: "/tmp" },
        toolId: "sftp",
      }),
    };
    const { onOpenTool } = renderPalette(executor);

    expect(screen.getAllByText("工作区").length).toBeGreaterThan(0);
    expect(screen.getAllByText("当前目标").length).toBeGreaterThan(0);
    expect(screen.getAllByText("本地").length).toBeGreaterThan(0);
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
    fireEvent.click(screen.getByText("打开文件"));

    await waitFor(() =>
      expect(onOpenTool).toHaveBeenCalledWith("sftp", { path: "/tmp" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("工具已打开");
  });

  it("forwards protected actions to confirmation without executor access", async () => {
    const executor: WorkspaceActionExecutor = { execute: vi.fn() };
    const { onConfirmationRequired } = renderPalette(executor);

    fireEvent.click(screen.getByText("删除目标"));

    await waitFor(() =>
      expect(onConfirmationRequired).toHaveBeenCalledWith({
        actionId: "remove",
        detail: "host-1",
        effect: "destructive",
        title: "删除目标",
      }),
    );
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("reports duplicate execution and aborts an in-flight wait on close", async () => {
    let finish: (() => void) | undefined;
    const executor: WorkspaceActionExecutor = {
      execute: vi.fn(
        () =>
          new Promise<{ kind: "completed" }>((resolve) => {
            finish = () => resolve({ kind: "completed" });
          }),
      ),
    };
    const { unmount } = render(
      <CommandPalette
        context={{ revision: "r1" }}
        executor={executor}
        getPayload={() => undefined}
        onClose={vi.fn()}
        onConfirmationRequired={vi.fn()}
        onOpenTool={vi.fn()}
        open
        registry={registry()}
      />,
    );

    fireEvent.click(screen.getByText("慢速检查"));
    fireEvent.click(screen.getByText("慢速检查"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "动作正在执行，请稍候",
      ),
    );
    expect(executor.execute).toHaveBeenCalledTimes(1);
    const invocation = vi.mocked(executor.execute).mock.calls[0]?.[1];
    expect(invocation?.signal?.aborted).toBe(false);
    unmount();
    expect(invocation?.signal?.aborted).toBe(true);
    finish?.();
  });
});
