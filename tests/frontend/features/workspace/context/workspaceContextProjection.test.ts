import { describe, expect, it } from "vitest";
import type { RemoteTargetRef } from "../../../../../src/lib/targetModel";
import type {
  Machine,
  MachineGroup,
  TerminalLayoutNode,
  TerminalPane,
  TerminalTab,
} from "../../../../../src/features/workspace/types";
import {
  buildWorkspaceContextProjection,
  createWorkspaceContextProjectionSelector,
  type WorkspaceContextProjectionInput,
} from "../../../../../src/features/workspace/context";

function machine(overrides: Partial<Machine> = {}): Machine {
  return {
    description: "",
    id: "local-machine",
    kind: "local",
    name: "Local",
    status: "online",
    tags: [],
    ...overrides,
  };
}

function group(...machines: Machine[]): MachineGroup {
  return { id: "group-1", machines, title: "Machines" };
}

function pane(overrides: Partial<TerminalPane> = {}): TerminalPane {
  return {
    id: "pane-1",
    lines: [],
    machineId: "local-machine",
    mode: "local",
    prompt: "$",
    status: "online",
    title: "Terminal",
    ...overrides,
  };
}

function terminalTab(
  layout: TerminalLayoutNode = { paneId: "pane-1", type: "pane" },
  overrides: Partial<Extract<TerminalTab, { kind?: "terminal" }>> = {},
): TerminalTab {
  return {
    id: "tab-1",
    layout,
    machineId: "local-machine",
    title: "Terminal",
    ...overrides,
  };
}

function input(
  overrides: Partial<WorkspaceContextProjectionInput> = {},
): WorkspaceContextProjectionInput {
  return {
    activeTabId: "tab-1",
    focusedPaneId: "pane-1",
    generatedAt: "2026-07-11T07:00:00.000Z",
    machineGroups: [group(machine())],
    revision: 1,
    selectedMachineId: "local-machine",
    terminalPanes: [pane()],
    terminalTabs: [terminalTab()],
    ...overrides,
  };
}

describe("buildWorkspaceContextProjection", () => {
  it("覆盖空工作区并生成默认 workspace source", () => {
    const result = buildWorkspaceContextProjection(
      input({
        activeTabId: null,
        focusedPaneId: null,
        machineGroups: [],
        selectedMachineId: null,
        terminalPanes: [],
        terminalTabs: [],
      }),
    );

    expect(result.subject).toEqual({
      id: null,
      kind: "empty",
      title: "未选择上下文",
    });
    expect(result.target).toBeNull();
    expect(result.freshness.state).toBe("fresh");
  });

  it.each([
    ["local", "local", { kind: "local", profileId: "pwsh" }],
    ["ssh", "ssh", { hostId: "host-1", kind: "ssh" }],
    ["telnet", "telnet", { hostId: "telnet-1", kind: "telnet" }],
    ["serial", "serial", { hostId: "serial-1", kind: "serial" }],
  ] as const)("投影 %s 终端目标", (_name, mode, target) => {
    const targetRef = target as RemoteTargetRef;
    const result = buildWorkspaceContextProjection(
      input({
        machineGroups: [
          group(
            machine({
              id: `${mode}-machine`,
              kind: mode,
              name: mode,
              target: targetRef,
            }),
          ),
        ],
        selectedMachineId: `${mode}-machine`,
        terminalPanes: [
          pane({
            machineId: `${mode}-machine`,
            mode,
            target: targetRef,
          }),
        ],
        terminalTabs: [
          terminalTab(undefined, { machineId: `${mode}-machine` }),
        ],
      }),
    );

    expect(result.target?.kind).toBe(mode);
    expect(result.subject.kind).toBe("terminalPane");
  });

  it("将外部 SSH 与普通 SSH 区分", () => {
    const target = { hostId: "external-host", kind: "ssh" } as const;
    const result = buildWorkspaceContextProjection(
      input({
        machineGroups: [
          group(
            machine({
              id: "external:launch-1",
              kind: "ssh",
              name: "External",
              target,
            }),
          ),
        ],
        terminalPanes: [
          pane({
            machineId: "external:launch-1",
            mode: "ssh",
            target,
          }),
        ],
      }),
    );

    expect(result.target?.kind).toBe("external");
  });

  it("覆盖容器目标和机器默认工作目录", () => {
    const target = {
      containerId: "container-1",
      containerName: "api",
      hostId: "host-1",
      kind: "dockerContainer",
      workdir: "/workspace",
    } as const;
    const result = buildWorkspaceContextProjection(
      input({
        machineGroups: [
          group(
            machine({
              id: "container-machine",
              kind: "dockerContainer",
              name: "api",
              target,
              workdir: "/workspace",
            }),
          ),
        ],
        terminalPanes: [
          pane({
            containerId: "container-1",
            machineId: "container-machine",
            mode: "container",
            target,
          }),
        ],
      }),
    );

    expect(result.target).toMatchObject({
      containerLabel: "api",
      kind: "container",
    });
    expect(result.location).toMatchObject({
      cwd: "/workspace",
      cwdSource: "machineDefault",
      pathStyle: "posix",
    });
  });

  it("覆盖 RDP 机器上下文", () => {
    const result = buildWorkspaceContextProjection(
      input({
        activeTabId: null,
        focusedPaneId: null,
        machineGroups: [
          group(
            machine({
              host: "rdp.example",
              id: "rdp-1",
              kind: "rdp",
              name: "Desktop",
            }),
          ),
        ],
        selectedMachineId: "rdp-1",
        terminalPanes: [],
        terminalTabs: [],
      }),
    );

    expect(result.subject.kind).toBe("machine");
    expect(result.target).toMatchObject({
      hostLabel: "rdp.example",
      kind: "rdp",
    });
  });

  it("活动 workspace file 优先于旧焦点 pane", () => {
    const fileTab: TerminalTab = {
      access: "editable",
      id: "file-1",
      kind: "workspaceFile",
      machineId: "ssh-machine",
      path: "C:\\work\\README.md",
      source: "workspace",
      target: { hostId: "host-1", kind: "ssh" },
      title: "README.md",
    };
    const result = buildWorkspaceContextProjection(
      input({
        activeTabId: "file-1",
        terminalTabs: [terminalTab(), fileTab],
        workspaceFileDirtyState: { "file-1": true },
      }),
    );

    expect(result.subject).toMatchObject({
      dirty: true,
      filePath: "C:\\work\\README.md",
      id: "file-1",
      kind: "workspaceFile",
    });
    expect(result.focusedPaneId).toBeNull();
    expect(result.location).toMatchObject({
      cwd: "C:\\work",
      cwdSource: "workspaceFile",
      pathStyle: "windows",
    });
  });

  it.each([
    ["/workspace/src/main.ts", "/workspace/src", "posix"],
    ["/main.ts", "/", "posix"],
    ["C:\\work\\src\\main.ts", "C:\\work\\src", "windows"],
    ["C:\\main.ts", "C:\\", "windows"],
    ["\\\\server\\share\\src\\main.ts", "\\\\server\\share\\src", "windows"],
    ["\\\\server\\share\\main.ts", "\\\\server\\share", "windows"],
  ] as const)(
    "工作区文件 %s 投影父目录并保留完整路径",
    (filePath, expectedCwd, pathStyle) => {
      const fileTab: TerminalTab = {
        access: "editable",
        id: "file-path",
        kind: "workspaceFile",
        machineId: "local-machine",
        path: filePath,
        source: "workspace",
        target: { kind: "local" },
        title: "main.ts",
      };

      const result = buildWorkspaceContextProjection(
        input({
          activeTabId: fileTab.id,
          terminalTabs: [fileTab],
        }),
      );

      expect(result.location).toMatchObject({
        cwd: expectedCwd,
        cwdSource: "workspaceFile",
        pathStyle,
      });
      expect(result.subject.filePath).toBe(filePath);
    },
  );

  it("覆盖多 pane 布局并纠正活动 tab 之外的焦点", () => {
    const layout: TerminalLayoutNode = {
      children: [
        { paneId: "pane-a", type: "pane" },
        { paneId: "pane-b", type: "pane" },
      ],
      direction: "horizontal",
      id: "split-1",
      type: "split",
    };
    const result = buildWorkspaceContextProjection(
      input({
        focusedPaneId: "pane-other",
        terminalPanes: [
          pane({ id: "pane-a" }),
          pane({ id: "pane-b" }),
          pane({ id: "pane-other" }),
        ],
        terminalTabs: [terminalTab(layout)],
      }),
    );

    expect(result.resources.activeTabPaneIds).toEqual(["pane-a", "pane-b"]);
    expect(result.focusedPaneId).toBe("pane-a");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "pane-outside-active-tab",
    );
  });

  it("focusedPaneId 已失效时回退到活动布局中首个仍存活 pane", () => {
    const layout: TerminalLayoutNode = {
      children: [
        { paneId: "pane-removed", type: "pane" },
        { paneId: "pane-live", type: "pane" },
      ],
      direction: "horizontal",
      id: "split-stale-focus",
      type: "split",
    };
    const result = buildWorkspaceContextProjection(
      input({
        focusedPaneId: "pane-missing",
        terminalPanes: [pane({ id: "pane-live", title: "Live pane" })],
        terminalTabs: [terminalTab(layout)],
      }),
    );

    expect(result.focusedPaneId).toBe("pane-live");
    expect(result.subject).toMatchObject({
      id: "pane-live",
      kind: "terminalPane",
    });
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "focused-pane-missing",
    );
  });

  it("把陈旧来源标记为 stale 且不记录来源正文", () => {
    const result = buildWorkspaceContextProjection(
      input({
        sources: [
          {
            source: "terminal",
            status: "stale",
            updatedAt: "2026-07-11T06:00:00.000Z",
          },
        ],
      }),
    );

    expect(result.freshness.state).toBe("stale");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "source-stale",
        source: "terminal",
      }),
    );
  });

  it("把部分失败标记为 partial 并保留其它上下文", () => {
    const result = buildWorkspaceContextProjection(
      input({
        sources: [
          { source: "runtime", status: "error" },
          { source: "agentRepository", status: "unavailable" },
        ],
      }),
    );

    expect(result.freshness.state).toBe("partial");
    expect(result.subject.kind).toBe("terminalPane");
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["source-error", "source-unavailable"]),
    );
  });

  it("无语义输入变化时 selector 返回同一引用", () => {
    const select = createWorkspaceContextProjectionSelector();
    const snapshot = input();

    expect(select(snapshot)).toBe(select({ ...snapshot }));
    expect(select({ ...snapshot, revision: 2 })).not.toBe(select(snapshot));
  });

  it("兼容字符串 revision 并保持原值", () => {
    const result = buildWorkspaceContextProjection(
      input({
        revision: "workspace:42",
      }),
    );

    expect(result.revision).toBe("workspace:42");
    expect(result.freshness.sources[0]?.revision).toBe("workspace:42");
  });

  it("生产投影不复制终端正文或凭据", () => {
    const result = buildWorkspaceContextProjection(
      input({
        machineGroups: [
          group(
            machine({
              credentialSecret: "should-not-leak",
              credentialRef: "vault:key",
            }),
          ),
        ],
        terminalPanes: [
          pane({
            lines: ["secret output"],
            outputHistory: "secret history",
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("secret output");
    expect(serialized).not.toContain("secret history");
    expect(serialized).not.toContain("should-not-leak");
    expect(serialized).not.toContain("vault:key");
  });
});
