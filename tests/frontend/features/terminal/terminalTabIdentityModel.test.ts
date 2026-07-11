import { describe, expect, it } from "vitest";
import {
  normalizeTerminalTabGroupPreference,
  resolveAutomaticTerminalTabGroupColor,
  resolveTerminalTabIdentityAccent,
  terminalTabIdentityPalette,
} from "../../../../src/features/terminal/terminalTabIdentityModel";
import { terminalTabGroupColorIds } from "../../../../src/features/workspace/types";

describe("terminalTabIdentityPalette", () => {
  it("完整覆盖既有八色枚举且只提供身份 accent token", () => {
    expect(terminalTabIdentityPalette.map((token) => token.color)).toEqual(
      terminalTabGroupColorIds,
    );
    expect(
      new Set(
        terminalTabIdentityPalette.map((token) => token.accentClassName),
      ).size,
    ).toBe(terminalTabGroupColorIds.length);

    for (const token of terminalTabIdentityPalette) {
      expect(token.accentClassName).toMatch(/^bg-\S+ dark:bg-\S+$/);
      expect(token.accentClassName).not.toMatch(/#|rgba?\(/i);
      expect(Object.keys(token).sort()).toEqual([
        "accentClassName",
        "color",
        "label",
        "swatchClassName",
      ]);
    }
  });
});

describe("resolveTerminalTabIdentityAccent", () => {
  it("对同一 groupId 始终返回确定的自动颜色", () => {
    const first = resolveTerminalTabIdentityAccent({
      groupId: "host-production",
      tabCount: 2,
    });
    const second = resolveTerminalTabIdentityAccent({
      groupId: "host-production",
      tabCount: 2,
    });

    expect(second).toEqual(first);
    expect(first.source).toBe("automatic");
  });

  it("不因其它分组排序、插入或删除而改变已有 groupId 的自动颜色", () => {
    const groupIds = ["host-production", "host-staging", "host-lab"];
    const original = new Map(
      groupIds.map((groupId) => [
        groupId,
        resolveAutomaticTerminalTabGroupColor(groupId),
      ]),
    );

    const reorderedWithInsertion = [
      "host-new",
      "host-lab",
      "host-production",
      "host-staging",
    ];
    const reordered = new Map(
      reorderedWithInsertion.map((groupId) => [
        groupId,
        resolveAutomaticTerminalTabGroupColor(groupId),
      ]),
    );

    expect(reordered.get("host-production")).toBe(
      original.get("host-production"),
    );
    expect(reordered.get("host-staging")).toBe(original.get("host-staging"));
    expect(reordered.get("host-lab")).toBe(original.get("host-lab"));
  });

  it("显式保存颜色优先于 groupId 自动映射", () => {
    const accent = resolveTerminalTabIdentityAccent({
      groupId: "host-production",
      preference: {
        color: "orange",
      },
      tabCount: 2,
    });

    expect(accent).toMatchObject({
      color: "orange",
      source: "explicit",
      visible: true,
    });
    expect(accent.accentClassName).toContain("orange");
  });

  it("多 Tab 始终显示，单 Tab automatic 隐藏且 explicit 显示", () => {
    expect(
      resolveTerminalTabIdentityAccent({
        groupId: "host-grouped",
        tabCount: 2,
      }).visible,
    ).toBe(true);
    expect(
      resolveTerminalTabIdentityAccent({
        groupId: "host-singleton",
        tabCount: 1,
      }).visible,
    ).toBe(false);
    expect(
      resolveTerminalTabIdentityAccent({
        groupId: "host-singleton",
        preference: {
          color: "pink",
        },
        tabCount: 1,
      }).visible,
    ).toBe(true);
  });

  it("折叠状态不改变 identity", () => {
    const expanded = resolveTerminalTabIdentityAccent({
      collapsed: false,
      groupId: "host-production",
      tabCount: 3,
    });
    const collapsed = resolveTerminalTabIdentityAccent({
      collapsed: true,
      groupId: "host-production",
      tabCount: 3,
    });

    expect(collapsed).toEqual(expanded);
  });

  it("只有标题 preference 时仍使用 automatic source", () => {
    const accent = resolveTerminalTabIdentityAccent({
      groupId: "host-production",
      preference: {
        title: "生产环境",
      },
      tabCount: 1,
    });

    expect(accent.source).toBe("automatic");
    expect(accent.visible).toBe(false);
  });
});

describe("normalizeTerminalTabGroupPreference", () => {
  it("对空 preference 返回删除语义", () => {
    expect(normalizeTerminalTabGroupPreference(undefined)).toBeUndefined();
    expect(normalizeTerminalTabGroupPreference(null)).toBeUndefined();
    expect(
      normalizeTerminalTabGroupPreference({
        color: null,
        title: "   ",
      }),
    ).toBeUndefined();
  });

  it("规范化 title-only preference 且不隐式写入自动颜色", () => {
    expect(
      normalizeTerminalTabGroupPreference({
        title: " 生产环境 ",
      }),
    ).toEqual({
      title: "生产环境",
    });
  });

  it("保留 color-only preference 作为显式身份色", () => {
    expect(
      normalizeTerminalTabGroupPreference({
        color: "teal",
        title: "",
      }),
    ).toEqual({
      color: "teal",
    });
  });
});
