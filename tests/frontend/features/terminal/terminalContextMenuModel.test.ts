import { describe, expect, it } from "vitest";
import {
  resolveTerminalContextMenuPosition,
  splitDirectionForMenuAction,
  terminalContextMenuGroups,
  type TerminalContextMenuAction,
} from "../../../../src/features/terminal/terminalContextMenuModel";

function flattenActions(canCopy = true) {
  return terminalContextMenuGroups({ canCopy })
    .flat()
    .map((item) => item.action);
}

describe("terminalContextMenuModel", () => {
  it("keeps terminal menu groups in stable action order", () => {
    expect(terminalContextMenuGroups({ canCopy: true })).toEqual([
      [
        {
          action: "copySessionId",
          disabled: false,
          label: "复制会话 ID",
        },
        {
          action: "copy",
          disabled: false,
          label: "复制",
          shortcut: "Ctrl+C",
        },
        {
          action: "paste",
          label: "粘贴",
          shortcut: "Ctrl+V",
        },
        {
          action: "selectAll",
          label: "全选",
        },
        {
          action: "clear",
          label: "清屏",
        },
        {
          action: "search",
          label: "搜索",
          shortcut: "Ctrl+F",
        },
      ],
      [
        {
          action: "sendSelectionToAgent",
          disabled: true,
          label: "发送选中内容到 Agent",
        },
        {
          action: "sendContextToAgent",
          disabled: false,
          label: "发送当前终端上下文到 Agent",
        },
      ],
      [
        {
          action: "reconnect",
          disabled: false,
          label: "重新连接",
        },
        {
          action: "disconnect",
          disabled: false,
          label: "断开连接",
        },
      ],
      [
        {
          action: "splitHorizontal",
          label: "左右分屏",
        },
        {
          action: "splitVertical",
          label: "上下分屏",
        },
      ],
    ]);
  });

  it("keeps log actions out of the compact terminal context menu", () => {
    const actions = flattenActions();

    expect(actions).not.toContain("startLog");
    expect(actions).not.toContain("stopLog");
    expect(actions).not.toContain("openLogs");
  });

  it("derives disabled menu items from terminal state", () => {
    const groups = terminalContextMenuGroups({
      canCopy: false,
      canCopySessionId: false,
      canDisconnect: false,
      canReconnect: false,
      canSendSelectionToAgent: false,
      canSendToAgent: false,
    });

    expect(groups.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "copy", disabled: true }),
        expect.objectContaining({ action: "copySessionId", disabled: true }),
        expect.objectContaining({ action: "disconnect", disabled: true }),
        expect.objectContaining({ action: "reconnect", disabled: true }),
        expect.objectContaining({
          action: "sendSelectionToAgent",
          disabled: true,
        }),
        expect.objectContaining({
          action: "sendContextToAgent",
          disabled: true,
        }),
      ]),
    );
  });

  it("omits split actions when the host surface cannot split panes", () => {
    expect(flattenActions()).toEqual(
      expect.arrayContaining(["splitHorizontal", "splitVertical"]),
    );

    expect(
      terminalContextMenuGroups({ canCopy: true, canSplit: false })
        .flat()
        .map((item) => item.action),
    ).not.toEqual(expect.arrayContaining(["splitHorizontal", "splitVertical"]));
  });

  it("clamps menu position with the measured menu size", () => {
    expect(
      resolveTerminalContextMenuPosition(
        { x: 420, y: 320 },
        {
          menuSize: { height: 304, width: 224 },
          viewport: { height: 640, width: 800 },
        },
      ),
    ).toEqual({ x: 420, y: 320 });

    expect(
      resolveTerminalContextMenuPosition(
        { x: 780, y: 600 },
        {
          menuSize: { height: 304, width: 224 },
          viewport: { height: 640, width: 800 },
        },
      ),
    ).toEqual({ x: 568, y: 328 });
  });

  it("keeps raw coordinates until menu dimensions are available", () => {
    expect(resolveTerminalContextMenuPosition({ x: 120, y: 80 })).toEqual({
      x: 120,
      y: 80,
    });
  });

  it("maps only split actions to workspace split directions", () => {
    const nonSplitActions: TerminalContextMenuAction[] = [
      "copy",
      "copySessionId",
      "sendSelectionToAgent",
      "sendContextToAgent",
      "paste",
      "selectAll",
      "search",
      "clear",
      "startLog",
      "stopLog",
      "disconnect",
      "reconnect",
      "openLogs",
    ];

    expect(splitDirectionForMenuAction("splitHorizontal")).toBe("horizontal");
    expect(splitDirectionForMenuAction("splitVertical")).toBe("vertical");
    for (const action of nonSplitActions) {
      expect(splitDirectionForMenuAction(action)).toBeNull();
    }
  });
});
