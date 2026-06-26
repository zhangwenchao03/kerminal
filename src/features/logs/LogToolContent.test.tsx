import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalPane } from "../workspace/types";
import { LogToolContent } from "./LogToolContent";

const commandHistoryApiMocks = vi.hoisted(() => ({
  clearCommandHistory: vi.fn(),
  deleteCommandHistory: vi.fn(),
  listCommandHistory: vi.fn(),
}));
const diagnosticsApiMocks = vi.hoisted(() => ({
  getRuntimeHealthSnapshot: vi.fn(),
}));

vi.mock("../../lib/commandHistoryApi", () => ({
  clearCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.clearCommandHistory(...args),
  deleteCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.deleteCommandHistory(...args),
  listCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.listCommandHistory(...args),
}));

vi.mock("../../lib/diagnosticsApi", () => ({
  getRuntimeHealthSnapshot: (...args: unknown[]) =>
    diagnosticsApiMocks.getRuntimeHealthSnapshot(...args),
}));

vi.mock("../tool-panel/DiagnosticsBundleCard", () => ({
  DiagnosticsBundleCard: () => <div>诊断包测试替身</div>,
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

describe("LogToolContent", () => {
  beforeEach(() => {
    commandHistoryApiMocks.clearCommandHistory.mockReset();
    commandHistoryApiMocks.deleteCommandHistory.mockReset();
    commandHistoryApiMocks.listCommandHistory.mockReset();
    commandHistoryApiMocks.listCommandHistory.mockResolvedValue([]);
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockReset();
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockResolvedValue({
      storage: {
        appLogFile: "C:/Users/me/.kerminal/logs/kerminal.log",
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
    });
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

  it("shows the Tauri app log file and rotation policy", async () => {
    render(<LogToolContent focusedPane={sshPane} />);

    expect(await screen.findByText("应用日志")).toBeInTheDocument();
    expect(await screen.findByText(/kerminal\.log$/)).toBeInTheDocument();
    expect(screen.getByText("当前 2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("单文件上限 976.6 KB")).toBeInTheDocument();
    expect(screen.getByText("保留 5 个文件")).toBeInTheDocument();
  });
});
