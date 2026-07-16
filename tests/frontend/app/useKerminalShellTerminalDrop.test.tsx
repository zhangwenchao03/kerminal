import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKerminalShellTerminalDrop } from "../../../src/app/useKerminalShellTerminalDrop";
import type { Machine } from "../../../src/features/workspace/types";

const sshMachine: Machine = {
  description: "生产 SSH",
  host: "172.16.41.60",
  id: "ssh-production",
  kind: "ssh",
  name: "生产数据库",
  status: "online",
  tags: ["ssh"],
  username: "ubuntu",
};

const terminalTab = {
  id: "tab-terminal",
  layout: { paneId: "pane-terminal", type: "pane" as const },
  machineId: "local-default",
  title: "本地终端",
};

describe("useKerminalShellTerminalDrop", () => {
  let terminalContent: HTMLElement;

  beforeEach(() => {
    terminalContent = document.createElement("div");
    terminalContent.setAttribute("data-terminal-workspace-content", "");
    vi.spyOn(terminalContent, "getBoundingClientRect").mockReturnValue({
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
    document.body.append(terminalContent);
  });

  afterEach(() => {
    terminalContent.remove();
    vi.restoreAllMocks();
  });

  it("returns the right-zone hint and commits an after-horizontal split", () => {
    const splitFocusedPane = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTerminalDrop({
        activeTabId: terminalTab.id,
        focusedPaneId: "pane-terminal",
        splitFocusedPane,
        terminalTabs: [terminalTab],
      }),
    );
    const event = { clientX: 980, clientY: 320, machine: sshMachine };

    let feedback;
    act(() => {
      feedback = result.current.handleExternalMachineDrag(event);
    });

    expect(feedback).toEqual({ hint: "松开分屏到右侧" });
    expect(result.current.terminalSplitDropIndicator).toEqual({
      machineName: sshMachine.name,
      zone: "right",
    });

    let consumed = false;
    act(() => {
      consumed = result.current.handleExternalMachineDrop(event);
    });

    expect(consumed).toBe(true);
    expect(splitFocusedPane).toHaveBeenCalledWith("horizontal", {
      placement: "after",
      targetMachineId: sshMachine.id,
    });
    expect(result.current.terminalSplitDropIndicator).toBeNull();
  });

  it("preserves top-zone direction, placement, and explicit drag cleanup", () => {
    const splitFocusedPane = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTerminalDrop({
        activeTabId: terminalTab.id,
        focusedPaneId: "pane-terminal",
        splitFocusedPane,
        terminalTabs: [terminalTab],
      }),
    );
    const event = { clientX: 600, clientY: 90, machine: sshMachine };

    act(() => {
      expect(result.current.handleExternalMachineDrag(event)).toEqual({
        hint: "松开分屏到上方",
      });
    });
    expect(result.current.terminalSplitDropIndicator?.zone).toBe("top");

    act(() => result.current.handleExternalMachineDragEnd());
    expect(result.current.terminalSplitDropIndicator).toBeNull();

    act(() => {
      expect(result.current.handleExternalMachineDrop(event)).toBe(true);
    });
    expect(splitFocusedPane).toHaveBeenCalledWith("vertical", {
      placement: "before",
      targetMachineId: sshMachine.id,
    });
  });

  it("does not consume unsupported machines or pointers outside the hot zone", () => {
    const splitFocusedPane = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTerminalDrop({
        activeTabId: terminalTab.id,
        focusedPaneId: "pane-terminal",
        splitFocusedPane,
        terminalTabs: [terminalTab],
      }),
    );
    const rdpEvent = {
      clientX: 980,
      clientY: 320,
      machine: { ...sshMachine, kind: "rdp" as const },
    };
    const centerEvent = {
      clientX: 600,
      clientY: 380,
      machine: sshMachine,
    };

    act(() => {
      expect(result.current.handleExternalMachineDrag(rdpEvent)).toBeUndefined();
      expect(result.current.handleExternalMachineDrop(rdpEvent)).toBe(false);
      expect(result.current.handleExternalMachineDrag(centerEvent)).toBeUndefined();
      expect(result.current.handleExternalMachineDrop(centerEvent)).toBe(false);
    });

    expect(splitFocusedPane).not.toHaveBeenCalled();
    expect(result.current.terminalSplitDropIndicator).toBeNull();
  });

  it("requires a focused terminal tab and the terminal workspace selector", () => {
    const splitFocusedPane = vi.fn();
    const sftpTab = {
      id: "tab-sftp",
      kind: "sftpTransfer" as const,
      machineId: sshMachine.id,
      title: "SFTP",
    };
    const { result, rerender } = renderHook(
      ({ focusedPaneId, terminalTabs }) =>
        useKerminalShellTerminalDrop({
          activeTabId: terminalTabs[0].id,
          focusedPaneId,
          splitFocusedPane,
          terminalTabs,
        }),
      {
        initialProps: {
          focusedPaneId: "",
          terminalTabs: [terminalTab] as Array<
            typeof terminalTab | typeof sftpTab
          >,
        },
      },
    );
    const event = { clientX: 980, clientY: 320, machine: sshMachine };

    expect(result.current.handleExternalMachineDrop(event)).toBe(false);
    rerender({ focusedPaneId: "pane-terminal", terminalTabs: [sftpTab] });
    expect(result.current.handleExternalMachineDrop(event)).toBe(false);
    rerender({ focusedPaneId: "pane-terminal", terminalTabs: [terminalTab] });
    terminalContent.remove();
    expect(result.current.handleExternalMachineDrop(event)).toBe(false);
    expect(splitFocusedPane).not.toHaveBeenCalled();
  });
});
