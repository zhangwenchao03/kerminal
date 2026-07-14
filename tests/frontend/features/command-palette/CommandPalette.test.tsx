import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
  const onClose = vi.fn();
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
      onClose={onClose}
      onConfirmationRequired={onConfirmationRequired}
      onOpenTool={onOpenTool}
      open
      registry={registry()}
    />,
  );
  return { onClose, onConfirmationRequired, onOpenTool };
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
    const { onClose, onOpenTool } = renderPalette(executor);

    expect(screen.getAllByText("工作区").length).toBeGreaterThan(0);
    expect(screen.getAllByText("当前目标").length).toBeGreaterThan(0);
    expect(screen.getAllByText("本地").length).toBeGreaterThan(0);
    expect(screen.getByText("Ctrl+O")).toBeInTheDocument();
    fireEvent.click(screen.getByText("打开文件"));

    await waitFor(() =>
      expect(onOpenTool).toHaveBeenCalledWith("sftp", { path: "/tmp" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("工具已打开");
  });

  it("closes after a completed action", async () => {
    const executor: WorkspaceActionExecutor = {
      execute: vi.fn().mockResolvedValue({ kind: "completed" }),
    };
    const { onClose } = renderPalette(executor);

    fireEvent.click(screen.getByText("打开文件"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("动作已完成");
  });

  it("forwards protected actions to confirmation without executor access", async () => {
    const executor: WorkspaceActionExecutor = { execute: vi.fn() };
    const { onClose, onConfirmationRequired } = renderPalette(executor);

    fireEvent.click(screen.getByText("删除目标"));

    await waitFor(() =>
      expect(onConfirmationRequired).toHaveBeenCalledWith({
        actionId: "remove",
        detail: "host-1",
        effect: "destructive",
        title: "删除目标",
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it("ignores a cancelled invocation after the palette closes and reopens", async () => {
    const pending = deferred<{ kind: "completed" }>();
    const executor: WorkspaceActionExecutor = {
      execute: vi.fn(() => pending.promise),
    };
    const onClose = vi.fn();
    const view = render(
      <CommandPalette
        context={{ revision: "r1" }}
        executor={executor}
        getPayload={() => undefined}
        onClose={onClose}
        onConfirmationRequired={vi.fn()}
        onOpenTool={vi.fn()}
        open
        registry={registry()}
      />,
    );

    fireEvent.click(screen.getByText("慢速检查"));
    const invocation = vi.mocked(executor.execute).mock.calls[0]?.[1];
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(invocation?.signal?.aborted).toBe(true);

    view.rerender(
      <CommandPalette
        context={{ revision: "r1" }}
        executor={executor}
        getPayload={() => undefined}
        onClose={onClose}
        onConfirmationRequired={vi.fn()}
        onOpenTool={vi.fn()}
        open={false}
        registry={registry()}
      />,
    );
    view.rerender(
      <CommandPalette
        context={{ revision: "r1" }}
        executor={executor}
        getPayload={() => undefined}
        onClose={onClose}
        onConfirmationRequired={vi.fn()}
        onOpenTool={vi.fn()}
        open
        registry={registry()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).not.toHaveTextContent("动作已取消"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ kind: "completed" });
      await pending.promise;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets a newer invocation own feedback and close behavior", async () => {
    const pending = deferred<{ kind: "completed" }>();
    const executor: WorkspaceActionExecutor = {
      execute: vi.fn((descriptor) =>
        descriptor.id === "slow"
          ? pending.promise
          : Promise.resolve({
              error: {
                severity: "error" as const,
                title: "当前调用失败",
              },
              kind: "failure" as const,
            }),
      ),
    };
    const { onClose } = renderPalette(executor);

    fireEvent.click(screen.getByText("慢速检查"));
    fireEvent.click(screen.getByText("打开文件"));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("当前调用失败"),
    );
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve({ kind: "completed" });
      await pending.promise;
    });

    expect(screen.getByRole("status")).toHaveTextContent("当前调用失败");
    expect(onClose).not.toHaveBeenCalled();
  });
});
