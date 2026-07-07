import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../../../../src/features/workspace/types";
import {
  buildTerminalTabGroups,
  TerminalTabButton,
  TerminalTabGroupHeader,
} from "../../../../src/features/terminal/terminalTabChrome";

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
    expect(tabButton).toHaveClass("absolute");
    expect(tabButton).toHaveClass("inset-0");
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

  it("selects from the full tab frame while keeping close independent", () => {
    const onCloseTab = vi.fn();
    const onSelectTab = vi.fn();

    render(
      <TerminalTabButton
        active={false}
        onCloseTab={onCloseTab}
        onContextMenu={vi.fn()}
        onSelectTab={onSelectTab}
        showClose
        tab={localTab}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "本地 PowerShell",
      }),
    );
    expect(onSelectTab).toHaveBeenCalledWith("tab-local");

    fireEvent.click(
      screen.getByRole("button", {
        name: "关闭 本地 PowerShell tab",
      }),
    );
    expect(onCloseTab).toHaveBeenCalledWith("tab-local");
    expect(onSelectTab).toHaveBeenCalledTimes(1);
  });
});

describe("TerminalTabGroupHeader", () => {
  it("aligns grouped tab headers with regular top tabs", () => {
    render(
      <TerminalTabGroupHeader
        collapsed={false}
        group={{
          accentClassName: "bg-sky-500",
          activeContainerClassName: "border-sky-500/45",
          color: "blue",
          colorClassName: "bg-sky-500/12 text-sky-700",
          colorLabel: "蓝色",
          containerClassName: "border-sky-500/22",
          grouped: true,
          id: "sftpTransfer",
          swatchClassName: "bg-sky-500",
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
    expect(groupButton).toHaveClass("max-w-[220px]");
    expect(groupButton).toHaveClass("rounded-xl");
    expect(groupButton).toHaveClass("text-sm");
  });
});

describe("buildTerminalTabGroups", () => {
  it("applies saved group names and colors while defaulting other groups", () => {
    const groups = buildTerminalTabGroups(
      [
        localTab,
        { ...localTab, id: "tab-local-2", title: "本地 PowerShell #2" },
        { ...localTab, id: "tab-remote", machineId: "host-prod", title: "prod" },
        { ...localTab, id: "tab-lab", machineId: "host-lab", title: "lab" },
      ],
      {
        "local-powershell": {
          color: "pink",
          title: "本地运维",
        },
      },
    );

    expect(groups[0]).toMatchObject({
      color: "pink",
      grouped: true,
      id: "local-powershell",
      title: "本地运维",
    });
    expect(groups[0].colorClassName).toContain("pink");
    expect(groups[1]).toMatchObject({
      grouped: false,
      id: "host-prod",
      title: "prod",
    });
    expect(groups[1].color).toBeDefined();
    expect(groups[1].color).not.toBe("pink");
    expect(groups[1].color).not.toBe(groups[2].color);
  });

  it("groups host container tabs under the parent host tab group", () => {
    const hostTab: TerminalTab = {
      id: "tab-host",
      layout: {
        paneId: "pane-host",
        type: "pane",
      },
      machineId: "host-prod",
      title: "172.16.41.60",
    };
    const containerTab: TerminalTab = {
      id: "tab-container",
      layout: {
        paneId: "pane-container",
        type: "pane",
      },
      machineId: "docker:host-prod:container-1",
      title: "geological-disaster-backend",
    };
    const panes: TerminalPane[] = [
      {
        id: "pane-host",
        lines: [],
        machineId: "host-prod",
        mode: "ssh",
        prompt: "root@172.16.41.60:~$",
        remoteHostId: "host-prod",
        status: "online",
        title: "172.16.41.60",
      },
      {
        containerId: "container-1",
        id: "pane-container",
        lines: [],
        machineId: "docker:host-prod:container-1",
        mode: "container",
        prompt: "geological-disaster-backend:/$",
        remoteHostId: "host-prod",
        status: "online",
        title: "geological-disaster-backend",
      },
    ];

    const groups = buildTerminalTabGroups(
      [hostTab, containerTab],
      {
        "host-prod": {
          color: "purple",
          title: "生产主机",
        },
      },
      { panes },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      color: "purple",
      grouped: true,
      id: "host-prod",
      title: "生产主机",
    });
    expect(groups[0].tabs.map((tab) => tab.id)).toEqual([
      "tab-host",
      "tab-container",
    ]);
  });

  it("uses the parent host name when a container tab opens before the host tab", () => {
    const containerTab: TerminalTab = {
      id: "tab-container",
      layout: {
        paneId: "pane-container",
        type: "pane",
      },
      machineId: "docker:host-prod:container-1",
      title: "geological-disaster-backend",
    };
    const panes: TerminalPane[] = [
      {
        containerId: "container-1",
        id: "pane-container",
        lines: [],
        machineId: "docker:host-prod:container-1",
        mode: "container",
        prompt: "geological-disaster-backend:/$",
        remoteHostId: "host-prod",
        status: "online",
        title: "geological-disaster-backend",
      },
    ];
    const machineGroups: MachineGroup[] = [
      {
        id: "group-prod",
        machines: [
          {
            description: "生产主机",
            id: "host-prod",
            kind: "ssh",
            name: "172.16.41.60",
            status: "online",
            tags: ["ssh"],
          },
        ],
        title: "生产",
      },
    ];

    const groups = buildTerminalTabGroups(
      [containerTab],
      {},
      { machineGroups, panes },
    );

    expect(groups[0]).toMatchObject({
      grouped: false,
      id: "host-prod",
      title: "172.16.41.60",
    });
  });
});
