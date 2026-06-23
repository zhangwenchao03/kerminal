import { describe, expect, it } from "vitest";
import {
  splitDirectionForMenuAction,
  terminalContextMenuGroups,
  type TerminalContextMenuAction,
} from "./terminalContextMenuModel";

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
      canDisconnect: false,
      canReconnect: false,
    });

    expect(groups.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "copy", disabled: true }),
        expect.objectContaining({ action: "disconnect", disabled: true }),
        expect.objectContaining({ action: "reconnect", disabled: true }),
      ]),
    );
  });

  it("maps only split actions to workspace split directions", () => {
    const nonSplitActions: TerminalContextMenuAction[] = [
      "copy",
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
