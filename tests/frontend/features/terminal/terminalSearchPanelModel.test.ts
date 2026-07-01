import { describe, expect, it } from "vitest";
import {
  buildTerminalSearchPanelModel,
  resolveTerminalSearchInputKeyAction,
} from "../../../../src/features/terminal/terminalSearchPanelModel";

describe("buildTerminalSearchPanelModel", () => {
  it("labels an empty query and disables navigation", () => {
    expect(
      buildTerminalSearchPanelModel({
        hasSearched: false,
        query: "   ",
        resultCount: 0,
        resultIndex: -1,
      }),
    ).toEqual({
      hasQuery: false,
      navigationDisabled: true,
      resultLabel: "输入关键词",
      resultTone: "muted",
    });
  });

  it("labels a pending search without disabling navigation", () => {
    expect(
      buildTerminalSearchPanelModel({
        hasSearched: false,
        query: "error",
        resultCount: 0,
        resultIndex: -1,
      }),
    ).toMatchObject({
      navigationDisabled: false,
      resultLabel: "待搜索",
      resultTone: "muted",
    });
  });

  it("marks searched queries with no matches as danger", () => {
    expect(
      buildTerminalSearchPanelModel({
        hasSearched: true,
        query: "missing",
        resultCount: 0,
        resultIndex: -1,
      }),
    ).toMatchObject({
      navigationDisabled: false,
      resultLabel: "无匹配",
      resultTone: "danger",
    });
  });

  it("shows result totals and the active result position", () => {
    expect(
      buildTerminalSearchPanelModel({
        hasSearched: true,
        query: "warn",
        resultCount: 4,
        resultIndex: -1,
      }).resultLabel,
    ).toBe("4 项");

    expect(
      buildTerminalSearchPanelModel({
        hasSearched: true,
        query: "warn",
        resultCount: 4,
        resultIndex: 2,
      }).resultLabel,
    ).toBe("3/4");
  });
});

describe("resolveTerminalSearchInputKeyAction", () => {
  it("maps keyboard shortcuts to search panel actions", () => {
    expect(
      resolveTerminalSearchInputKeyAction({
        key: "Escape",
        shiftKey: false,
      }),
    ).toBe("close");
    expect(
      resolveTerminalSearchInputKeyAction({
        key: "Enter",
        shiftKey: true,
      }),
    ).toBe("previous");
    expect(
      resolveTerminalSearchInputKeyAction({
        key: "Enter",
        shiftKey: false,
      }),
    ).toBeNull();
  });
});
