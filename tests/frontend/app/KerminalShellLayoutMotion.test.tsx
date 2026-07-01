import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KerminalShell } from "../../../src/app/KerminalShell";
import { defaultAppSettings } from "../../../src/features/settings/settingsModel";
import { resetWorkspaceStore } from "../../../src/features/workspace/workspaceStore";
import type { TerminalOutputEvent } from "../../../src/lib/terminalApi";
import {
  getKerminalShellTestMocks,
  remoteHostTree,
} from "../support/app/KerminalShell.testSupport.tsx";

const mocks = getKerminalShellTestMocks();

describe("KerminalShell layout motion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkspaceStore();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-language");
    document.documentElement.removeAttribute("lang");
    mocks.nativeMenuApi.listenNativeMenuActions.mockResolvedValue(
      () => undefined,
    );
    mocks.profileApi.listProfiles.mockResolvedValue([]);
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(remoteHostTree);
    mocks.settingsApi.getSettings.mockResolvedValue(defaultAppSettings);
    mocks.settingsApi.updateSettings.mockImplementation(
      async (settings) => settings,
    );
    mocks.terminalApi.createTerminalSession.mockImplementation(
      async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
        onOutput({
          data: "local ready",
          kind: "data",
          sessionId: "session-local",
        });
        return {
          cols: 80,
          id: "session-local",
          rows: 24,
          shell: "test-shell",
          status: "running",
        };
      },
    );
    mocks.terminalApi.getTerminalLogState.mockResolvedValue({
      active: false,
      bytesWritten: 0,
    });
    mocks.terminalApi.reapOrphanTerminalSessions.mockResolvedValue({
      elapsedMs: 0,
      reapedCount: 0,
      sessionIds: [],
    });
    mocks.terminalApi.resizeTerminal.mockResolvedValue(undefined);
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue(null);
    mocks.workspaceSessionApi.saveWorkspaceSessionFile.mockResolvedValue(
      undefined,
    );
  });

  it("does not animate grid columns when the left sidebar expands", () => {
    const { container } = render(<KerminalShell />);
    const shell = container.firstElementChild as HTMLElement;

    expect(shell).not.toHaveClass("transition-[grid-template-columns]");
    expect(shell).not.toHaveClass("duration-200");
  });
});
