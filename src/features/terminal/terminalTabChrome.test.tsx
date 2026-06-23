import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TerminalTab } from "../workspace/types";
import { TerminalTabButton, TerminalTabGroupHeader } from "./terminalTabChrome";

const localTab: TerminalTab = {
  id: "tab-local",
  layout: {
    paneId: "pane-local",
    type: "pane",
  },
  machineId: "local-powershell",
  title: "本地 PowerShell",
};

describe("TerminalTabButton", () => {
  it("keeps the active top tab as a standalone framed control", () => {
    render(
      <TerminalTabButton
        active
        onCloseTab={vi.fn()}
        onContextMenu={vi.fn()}
        onSelectTab={vi.fn()}
        showClose
        tab={localTab}
        tabNumber={1}
      />,
    );

    const tabButton = screen.getByRole("button", {
      name: "1 · 本地 PowerShell",
    });
    const tabFrame = tabButton.closest("div");

    expect(tabFrame).toHaveClass("rounded-xl");
    expect(tabFrame).toHaveClass("border-sky-500/60");
    expect(tabFrame).toHaveClass("bg-sky-500/14");
    expect(tabFrame).toHaveClass("ring-1");
    expect(tabFrame).toHaveClass("ring-sky-400/30");
    expect(tabFrame).not.toHaveClass("border-b-transparent");
    expect(tabFrame).not.toHaveClass("-mb-px");
  });

  it("keeps inactive top tabs visibly framed for scanning", () => {
    render(
      <TerminalTabButton
        active={false}
        onCloseTab={vi.fn()}
        onContextMenu={vi.fn()}
        onSelectTab={vi.fn()}
        showClose
        tab={localTab}
      />,
    );

    const tabButton = screen.getByRole("button", {
      name: "本地 PowerShell",
    });
    const tabFrame = tabButton.closest("div");

    expect(tabFrame).toHaveClass("border-[var(--border-subtle)]");
    expect(tabFrame).toHaveClass("bg-[var(--surface-solid)]");
    expect(tabFrame).toHaveClass("rounded-xl");
  });
});

describe("TerminalTabGroupHeader", () => {
  it("aligns grouped tab headers with regular top tabs", () => {
    render(
      <TerminalTabGroupHeader
        collapsed={false}
        group={{
          colorClassName: "bg-sky-500/12 text-sky-700",
          grouped: true,
          id: "sftpTransfer",
          tabs: [localTab, { ...localTab, id: "tab-sftp-2" }],
          title: "SFTP 传输",
        }}
        onContextMenu={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    const groupButton = screen.getByRole("button", {
      name: "折叠 SFTP 传输 标签组",
    });

    expect(groupButton).toHaveClass("h-9");
    expect(groupButton).toHaveClass("max-w-[190px]");
    expect(groupButton).toHaveClass("rounded-xl");
    expect(groupButton).toHaveClass("text-sm");
  });
});
