import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandHistoryEntry } from "../../../../src/lib/commandHistoryApi";
import type { TerminalPane } from "../../../../src/features/workspace/types";
import { LogToolContent } from "../../../../src/features/logs/LogToolContent";

const commandHistoryApiMocks = vi.hoisted(() => ({
  clearCommandHistory: vi.fn(),
  deleteCommandHistory: vi.fn(),
  listCommandHistory: vi.fn(),
}));
const diagnosticsApiMocks = vi.hoisted(() => ({
  getRuntimeHealthSnapshot: vi.fn(),
}));

vi.mock("../../../../src/lib/commandHistoryApi", () => ({
  clearCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.clearCommandHistory(...args),
  deleteCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.deleteCommandHistory(...args),
  listCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.listCommandHistory(...args),
}));

vi.mock("../../../../src/lib/diagnosticsApi", () => ({
  getRuntimeHealthSnapshot: (...args: unknown[]) =>
    diagnosticsApiMocks.getRuntimeHealthSnapshot(...args),
}));

vi.mock("../../../../src/features/tool-panel/DiagnosticsBundleCard", () => ({
  DiagnosticsBundleCard: () => <div>日志导出测试替身</div>,
}));

const sshPane: TerminalPane = {
  id: "pane-ssh-1",
  lines: [],
  machineId: "ubuntu-dev",
  mode: "ssh",
  prompt: "deploy@dev:~$",
  remoteHostId: "ubuntu-dev",
  status: "online",
  title: "ubuntu-dev",
};

const stageSshPane: TerminalPane = {
  ...sshPane,
  id: "pane-ssh-2",
  machineId: "ubuntu-stage",
  remoteHostId: "ubuntu-stage",
  title: "ubuntu-stage",
};

const telnetPane: TerminalPane = {
  ...sshPane,
  id: "pane-telnet-1",
  machineId: "legacy-router",
  mode: "telnet",
  remoteHostId: "legacy-router",
  title: "legacy-router",
};

const serialPane: TerminalPane = {
  ...sshPane,
  id: "pane-serial-1",
  machineId: "serial-com3",
  mode: "serial",
  remoteHostId: undefined,
  title: "COM3",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function historyEntry(
  command: string,
  pane: TerminalPane,
): CommandHistoryEntry {
  return {
    command,
    createdAt: "1",
    id: `history-${pane.id}`,
    paneId: pane.id,
    remoteHostId: pane.remoteHostId,
    source: "user",
    target: "ssh",
  };
}

function runtimeSnapshot(
  appLogFile = "C:/Users/me/.kerminal/logs/kerminal.log",
) {
  return {
    storage: {
      appLogFile,
      appLogFileSizeBytes: 2048,
      appLogMaxFileSizeBytes: 1_000_000,
      appLogRotationKeepFiles: 5,
      commandDatabaseFile: "C:/Users/me/.kerminal/data/command.sqlite",
      commandDatabaseFileSizeBytes: 1024,
      diagnostics: "C:/Users/me/.kerminal/diagnostics",
      logs: "C:/Users/me/.kerminal/logs",
      root: "C:/Users/me/.kerminal",
      rootSizeBytes: 8192,
    },
  };
}

describe("LogToolContent", () => {
  beforeEach(() => {
    commandHistoryApiMocks.clearCommandHistory.mockReset();
    commandHistoryApiMocks.clearCommandHistory.mockResolvedValue(0);
    commandHistoryApiMocks.deleteCommandHistory.mockReset();
    commandHistoryApiMocks.listCommandHistory.mockReset();
    commandHistoryApiMocks.listCommandHistory.mockResolvedValue([]);
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockReset();
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockResolvedValue(
      runtimeSnapshot(),
    );
  });

  it("loads command history for the focused SSH pane", async () => {
    render(<LogToolContent focusedPane={sshPane} />);

    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledWith({
        limit: 100,
        paneId: "pane-ssh-1",
        remoteHostId: "ubuntu-dev",
        source: undefined,
        target: "ssh",
        query: undefined,
      }),
    );
  });

  it("does not fall back to global history without a focused pane", async () => {
    render(<LogToolContent />);

    await screen.findByText("未聚焦终端");
    expect(
      screen.getByRole("button", { name: "刷新命令历史" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "清空命令历史" }),
    ).toBeDisabled();
    expect(commandHistoryApiMocks.listCommandHistory).not.toHaveBeenCalled();
    expect(diagnosticsApiMocks.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(
      1,
    );
  });

  it.each([
    [telnetPane, "telnet", "legacy-router"],
    [serialPane, "serial", "serial-com3"],
  ] as const)(
    "binds %s history to its real terminal target",
    async (pane, target, remoteHostId) => {
      render(<LogToolContent focusedPane={pane} />);

      await waitFor(() =>
        expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            paneId: pane.id,
            remoteHostId,
            target,
          }),
        ),
      );
    },
  );

  it("clears only the focused pane history", async () => {
    const user = userEvent.setup();
    commandHistoryApiMocks.listCommandHistory.mockResolvedValue([
      historyEntry("echo scoped", sshPane),
    ]);
    commandHistoryApiMocks.clearCommandHistory.mockResolvedValue(1);
    render(<LogToolContent focusedPane={sshPane} />);

    await user.click(
      await screen.findByRole("button", { name: "清空命令历史" }),
    );

    expect(commandHistoryApiMocks.clearCommandHistory).toHaveBeenCalledWith({
      paneId: "pane-ssh-1",
      remoteHostId: "ubuntu-dev",
      target: "ssh",
    });
  });

  it("shows the Tauri app log file and rotation policy", async () => {
    render(<LogToolContent focusedPane={sshPane} />);

    expect(await screen.findByText("应用日志")).toBeInTheDocument();
    expect(screen.getByText("当前日志")).toBeInTheDocument();
    expect(await screen.findByText(/kerminal\.log$/)).toBeInTheDocument();
    expect(screen.getByText("当前 2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("单文件上限 976.6 KB")).toBeInTheDocument();
    expect(screen.getByText("保留 5 个文件")).toBeInTheDocument();
  });

  it("does not read while inactive and reloads the current pane when reopened", async () => {
    const { rerender } = render(
      <LogToolContent active={false} focusedPane={sshPane} />,
    );

    await act(async () => undefined);
    expect(commandHistoryApiMocks.listCommandHistory).not.toHaveBeenCalled();
    expect(diagnosticsApiMocks.getRuntimeHealthSnapshot).not.toHaveBeenCalled();

    rerender(<LogToolContent active focusedPane={stageSshPane} />);

    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          paneId: "pane-ssh-2",
          remoteHostId: "ubuntu-stage",
        }),
      ),
    );
    expect(diagnosticsApiMocks.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(
      1,
    );
  });

  it("keeps the fast current pane history when the previous pane resolves later", async () => {
    const slowDev = deferred<CommandHistoryEntry[]>();
    const fastStage = deferred<CommandHistoryEntry[]>();
    commandHistoryApiMocks.listCommandHistory
      .mockReturnValueOnce(slowDev.promise)
      .mockReturnValueOnce(fastStage.promise);

    const { rerender } = render(
      <LogToolContent active focusedPane={sshPane} />,
    );
    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledTimes(
        1,
      ),
    );

    rerender(<LogToolContent active focusedPane={stageSshPane} />);
    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledTimes(
        2,
      ),
    );

    await act(async () => {
      fastStage.resolve([historyEntry("echo stage", stageSshPane)]);
      await fastStage.promise;
    });
    expect(await screen.findByText("echo stage")).toBeInTheDocument();

    await act(async () => {
      slowDev.resolve([historyEntry("echo dev", sshPane)]);
      await slowDev.promise;
    });
    expect(screen.getByText("echo stage")).toBeInTheDocument();
    expect(screen.queryByText("echo dev")).not.toBeInTheDocument();
    expect(diagnosticsApiMocks.getRuntimeHealthSnapshot).toHaveBeenCalledTimes(
      1,
    );
  });

  it("ignores an old global storage response after inactive and reopen", async () => {
    const oldStorage = deferred<ReturnType<typeof runtimeSnapshot>>();
    const currentStorage = deferred<ReturnType<typeof runtimeSnapshot>>();
    diagnosticsApiMocks.getRuntimeHealthSnapshot
      .mockReturnValueOnce(oldStorage.promise)
      .mockReturnValueOnce(currentStorage.promise);

    const { rerender } = render(
      <LogToolContent active focusedPane={sshPane} />,
    );
    await waitFor(() =>
      expect(
        diagnosticsApiMocks.getRuntimeHealthSnapshot,
      ).toHaveBeenCalledTimes(1),
    );

    rerender(<LogToolContent active={false} focusedPane={stageSshPane} />);
    rerender(<LogToolContent active focusedPane={stageSshPane} />);
    await waitFor(() =>
      expect(
        diagnosticsApiMocks.getRuntimeHealthSnapshot,
      ).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      currentStorage.resolve(runtimeSnapshot("C:/logs/current.log"));
      await currentStorage.promise;
    });
    expect(await screen.findByText("C:/logs/current.log")).toBeInTheDocument();

    await act(async () => {
      oldStorage.resolve(runtimeSnapshot("C:/logs/old.log"));
      await oldStorage.promise;
    });
    expect(screen.getByText("C:/logs/current.log")).toBeInTheDocument();
    expect(screen.queryByText("C:/logs/old.log")).not.toBeInTheDocument();
  });
});
