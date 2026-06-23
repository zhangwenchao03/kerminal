import { useState, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TerminalPane, TerminalTab } from "../workspace/types";
import { TerminalWorkspace } from "./TerminalWorkspace";
import {
  baseTerminalPane,
  batchPanes,
  batchTabs,
  mixedSplitPanes,
  mixedSplitTabs,
  previewOnlyPanes,
  previewOnlyTabs,
  workspaceProps,
} from "./TerminalWorkspace.testSupport";

vi.mock("./XtermPane", () => ({
  XtermPane: ({ title }: { title: string }) => (
    <div aria-label={`${title} xterm 终端`}>本地终端测试替身</div>
  ),
}));

vi.mock("../../components/ui/resizable", () => ({
  ResizableHandle: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div aria-label={ariaLabel} role="separator" />
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("TerminalWorkspace broadcast command", () => {
  it("updates the broadcast command draft", async () => {
    const user = userEvent.setup();
    const onBroadcastDraftChange = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-mixed-split",
            broadcastDraft,
            focusedPaneId: "pane-split-local",
            onBroadcastDraftChange: (draft) => {
              setBroadcastDraft(draft);
              onBroadcastDraftChange(draft);
            },
            panes: mixedSplitPanes,
            tabs: mixedSplitTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");

    expect(onBroadcastDraftChange).toHaveBeenLastCalledWith("uptime");
  });

  it("sends a safe command to the active local pane without confirmation", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-split-local"],
    });

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-mixed-split",
            broadcastDraft,
            focusedPaneId: "pane-split-local",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: mixedSplitPanes,
            tabs: mixedSplitTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");
    await user.click(screen.getByRole("button", { name: "发送到全部" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "uptime",
      data: "uptime\r",
      targetPaneIds: ["pane-split-local"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("已发送到 1 个分屏");
    expect(screen.getByLabelText("批量命令")).toHaveValue("");
  });

  it("asks for confirmation before sending to multiple or SSH panes", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: ["pane-batch-ssh"],
      sentPaneIds: ["pane-batch-local"],
    });
    const onBroadcastDraftChange = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-batch",
            broadcastDraft,
            focusedPaneId: "pane-batch-local",
            onBroadcastCommand,
            onBroadcastDraftChange: (draft) => {
              setBroadcastDraft(draft);
              onBroadcastDraftChange(draft);
            },
            panes: batchPanes,
            tabs: batchTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.click(screen.getByLabelText("批量命令"));
    expect(screen.getByLabelText("批量命令")).toHaveFocus();
    await user.keyboard("systemctl status nginx");
    expect(onBroadcastDraftChange).toHaveBeenCalled();
    expect(screen.getByLabelText("批量命令")).toHaveValue("systemctl status nginx");
    expect(screen.getByRole("button", { name: "发送到全部" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送到全部" }));

    expect(screen.getByRole("dialog", { name: "确认批量发送" })).toBeInTheDocument();
    expect(screen.getByText("将发送到 2 个分屏")).toBeInTheDocument();
    expect(screen.getByText("包含远程或设备分屏")).toBeInTheDocument();
    expect(onBroadcastCommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认发送" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "systemctl status nginx",
      data: "systemctl status nginx\r",
      targetPaneIds: ["pane-batch-local", "pane-batch-ssh"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 个分屏尚未连接");
  });

  it("includes telnet and serial panes in broadcast targets behind confirmation", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-broadcast-telnet", "pane-broadcast-serial"],
    });
    const panes: TerminalPane[] = [
      {
        ...baseTerminalPane,
        id: "pane-broadcast-telnet",
        machineId: "telnet-host",
        mode: "telnet",
        title: "Telnet 设备",
      },
      {
        ...baseTerminalPane,
        id: "pane-broadcast-serial",
        machineId: "serial-device",
        mode: "serial",
        title: "Serial 设备",
      },
      {
        ...baseTerminalPane,
        id: "pane-broadcast-preview",
        machineId: "preview-helper",
        mode: "preview",
        title: "预览辅助",
      },
    ];
    const tabs: TerminalTab[] = [
      {
        id: "tab-device-broadcast",
        layout: {
          type: "split",
          id: "split-device-broadcast",
          direction: "horizontal",
          children: [
            { type: "pane", paneId: "pane-broadcast-telnet" },
            { type: "pane", paneId: "pane-broadcast-serial" },
            { type: "pane", paneId: "pane-broadcast-preview" },
          ],
        },
        machineId: "telnet-host",
        title: "设备批量",
      },
    ];

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-device-broadcast",
            broadcastDraft,
            focusedPaneId: "pane-broadcast-telnet",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes,
            tabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "show version");
    await user.click(screen.getByRole("button", { name: "发送到全部" }));

    expect(screen.getByRole("dialog", { name: "确认批量发送" })).toBeInTheDocument();
    expect(screen.getByText("将发送到 2 个分屏")).toBeInTheDocument();
    expect(screen.getByText("包含远程或设备分屏")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认发送" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "show version",
      data: "show version\r",
      targetPaneIds: ["pane-broadcast-telnet", "pane-broadcast-serial"],
    });
  });

  it("disables broadcast when the active tab has no real terminal panes", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-preview-only",
            broadcastDraft,
            focusedPaneId: "pane-preview-a",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: previewOnlyPanes,
            tabs: previewOnlyTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");

    expect(screen.getByRole("button", { name: "发送到全部" })).toBeDisabled();
    expect(onBroadcastCommand).not.toHaveBeenCalled();
  });
});
