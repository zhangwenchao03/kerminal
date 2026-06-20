import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalPane } from "../workspace/types";
import { LogToolContent } from "./LogToolContent";

const commandHistoryApiMocks = vi.hoisted(() => ({
  clearCommandHistory: vi.fn(),
  deleteCommandHistory: vi.fn(),
  listCommandHistory: vi.fn(),
}));

vi.mock("../../lib/commandHistoryApi", () => ({
  clearCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.clearCommandHistory(...args),
  deleteCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.deleteCommandHistory(...args),
  listCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.listCommandHistory(...args),
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
});
