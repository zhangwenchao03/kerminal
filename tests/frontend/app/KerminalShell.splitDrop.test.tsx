import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalOutputEvent } from "../../../src/lib/terminalApi";
import { defaultAppSettings } from "../../../src/features/settings/settingsModel";
import {
  useWorkspaceStore,
} from "../../../src/features/workspace/workspaceStore";
import { resetWorkspaceStore } from "../support/workspace/workspaceStore.testSupport";
import {
  getKerminalShellTestMocks,
  mockElementFromPoint,
  rdpRemoteHostTree,
  remoteHostTree,
} from "../support/app/KerminalShell.testSupport.tsx";
import { KerminalShell } from "../../../src/app/KerminalShell";

const mocks = getKerminalShellTestMocks();

async function findExpandedSidebarMachine(name: RegExp) {
  const sidebar = screen.getByRole("complementary", { name: "主机侧边栏" });
  await screen.findByRole("button", { name: /bwy/i });

  let machineButton = within(sidebar).queryByRole("button", { name });
  if (machineButton) {
    return machineButton;
  }

  for (const groupButton of within(sidebar).queryAllByRole("button")) {
    if (groupButton.getAttribute("aria-expanded") === "false") {
      fireEvent.click(groupButton);
    }
  }

  return within(sidebar).findByRole("button", { name });
}

describe("KerminalShell sidebar split drop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    window.localStorage.clear();
    resetWorkspaceStore();
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
    mocks.terminalApi.createSshTerminalSession.mockImplementation(
      async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
        onOutput({
          data: "ssh ready",
          kind: "data",
          sessionId: "session-ssh",
        });
        return {
          cols: 80,
          id: "session-ssh",
          rows: 24,
          shell: "ssh",
          status: "running",
        };
      },
    );
    mocks.terminalApi.getTerminalLogState.mockResolvedValue({
      active: false,
      bytesWritten: 0,
    });
  });

  it("splits the focused terminal to a dropped sidebar host", async () => {
    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalled();
    });

    const terminalContent = document.querySelector<HTMLElement>(
      "[data-terminal-workspace-content]",
    );
    expect(terminalContent).toBeInTheDocument();
    const rectSpy = vi.spyOn(terminalContent!, "getBoundingClientRect");
    rectSpy.mockReturnValue({
      bottom: 680,
      height: 600,
      left: 200,
      right: 1000,
      top: 80,
      width: 800,
      x: 200,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);
    const restoreElementFromPoint = mockElementFromPoint(document.body);

    try {
      fireEvent.pointerDown(hostButton, {
        button: 0,
        clientX: 16,
        clientY: 16,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      expect(
        screen.getByRole("status", { name: "主机分屏拖放目标：右侧" }),
      ).toHaveTextContent("分屏到右侧 · 172.16.41.60");

      fireEvent.pointerUp(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      await waitFor(() => {
        expect(
          useWorkspaceStore.getState().terminalPanes.some(
            (pane) =>
              pane.machineId === "db980b17-2ed0-44e5-b72a-6ecadf788439" &&
              pane.mode === "ssh",
          ),
        ).toBe(true);
      });
      expect(mocks.remoteHostApi.updateRemoteHost).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
      restoreElementFromPoint();
    }
  });

  it("does not split when the pointer is released outside the terminal hot zone", async () => {
    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalled();
    });

    const terminalContent = document.querySelector<HTMLElement>(
      "[data-terminal-workspace-content]",
    );
    expect(terminalContent).toBeInTheDocument();
    const rectSpy = vi.spyOn(terminalContent!, "getBoundingClientRect");
    rectSpy.mockReturnValue({
      bottom: 680,
      height: 600,
      left: 200,
      right: 1000,
      top: 80,
      width: 800,
      x: 200,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);
    const restoreElementFromPoint = mockElementFromPoint(document.body);

    try {
      fireEvent.pointerDown(hostButton, {
        button: 0,
        clientX: 16,
        clientY: 16,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      expect(
        screen.getByRole("status", { name: "主机分屏拖放目标：右侧" }),
      ).toBeInTheDocument();

      fireEvent.pointerUp(window, {
        clientX: 1040,
        clientY: 320,
        pointerId: 1,
      });

      expect(mocks.terminalApi.createSshTerminalSession).not.toHaveBeenCalled();
      expect(
        useWorkspaceStore
          .getState()
          .terminalPanes.some(
            (pane) =>
              pane.machineId === "db980b17-2ed0-44e5-b72a-6ecadf788439",
          ),
      ).toBe(false);
    } finally {
      rectSpy.mockRestore();
      restoreElementFromPoint();
    }
  });

  it("does not consume RDP machines as terminal split drops", async () => {
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(rdpRemoteHostTree);
    render(<KerminalShell />);

    const sidebar = screen.getByRole("complementary", { name: "主机侧边栏" });
    const groupButton = await within(sidebar).findByRole("button", {
      name: /办公主机/,
    });
    if (groupButton.getAttribute("aria-expanded") === "false") {
      fireEvent.click(groupButton);
    }
    const hostButton = await within(sidebar).findByRole("button", {
      name: /office-rdp/,
    });

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalled();
    });

    const terminalContent = document.querySelector<HTMLElement>(
      "[data-terminal-workspace-content]",
    );
    expect(terminalContent).toBeInTheDocument();
    const rectSpy = vi.spyOn(terminalContent!, "getBoundingClientRect");
    rectSpy.mockReturnValue({
      bottom: 680,
      height: 600,
      left: 200,
      right: 1000,
      top: 80,
      width: 800,
      x: 200,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);
    const restoreElementFromPoint = mockElementFromPoint(document.body);

    try {
      fireEvent.pointerDown(hostButton, {
        button: 0,
        clientX: 16,
        clientY: 16,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      expect(
        screen.queryByRole("status", { name: /主机分屏拖放目标/ }),
      ).not.toBeInTheDocument();

      fireEvent.pointerUp(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      expect(mocks.terminalApi.createSshTerminalSession).not.toHaveBeenCalled();
      expect(
        useWorkspaceStore
          .getState()
          .terminalPanes.some((pane) => pane.machineId === "rdp-office"),
      ).toBe(false);
    } finally {
      rectSpy.mockRestore();
      restoreElementFromPoint();
    }
  });

  it("does not consume split drops while a non-terminal tab is active", async () => {
    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);

    act(() => {
      useWorkspaceStore.setState({
        activeTabId: "tab-sftp",
        focusedPaneId: "",
        terminalPanes: [],
        terminalTabs: [
          {
            id: "tab-sftp",
            kind: "sftpTransfer",
            machineId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
            title: "SFTP",
          },
        ],
      });
    });

    const terminalContent = document.querySelector<HTMLElement>(
      "[data-terminal-workspace-content]",
    );
    expect(terminalContent).toBeInTheDocument();
    const rectSpy = vi.spyOn(terminalContent!, "getBoundingClientRect");
    rectSpy.mockReturnValue({
      bottom: 680,
      height: 600,
      left: 200,
      right: 1000,
      top: 80,
      width: 800,
      x: 200,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);
    const restoreElementFromPoint = mockElementFromPoint(document.body);

    try {
      fireEvent.pointerDown(hostButton, {
        button: 0,
        clientX: 16,
        clientY: 16,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      expect(
        screen.queryByRole("status", { name: /主机分屏拖放目标/ }),
      ).not.toBeInTheDocument();

      fireEvent.pointerUp(window, {
        clientX: 980,
        clientY: 320,
        pointerId: 1,
      });

      expect(mocks.terminalApi.createSshTerminalSession).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
    } finally {
      rectSpy.mockRestore();
      restoreElementFromPoint();
    }
  });
});
