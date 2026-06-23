export type TerminalSearchInputKeyAction = "close" | "previous";

export interface TerminalSearchPanelModelOptions {
  hasSearched: boolean;
  query: string;
  resultCount: number;
  resultIndex: number;
}

export interface TerminalSearchPanelModel {
  hasQuery: boolean;
  navigationDisabled: boolean;
  resultLabel: string;
  resultTone: "danger" | "muted";
}

export function buildTerminalSearchPanelModel({
  hasSearched,
  query,
  resultCount,
  resultIndex,
}: TerminalSearchPanelModelOptions): TerminalSearchPanelModel {
  const hasQuery = query.trim().length > 0;

  if (!hasQuery) {
    return {
      hasQuery,
      navigationDisabled: true,
      resultLabel: "输入关键词",
      resultTone: "muted",
    };
  }

  if (!hasSearched) {
    return {
      hasQuery,
      navigationDisabled: false,
      resultLabel: "待搜索",
      resultTone: "muted",
    };
  }

  if (resultCount <= 0) {
    return {
      hasQuery,
      navigationDisabled: false,
      resultLabel: "无匹配",
      resultTone: "danger",
    };
  }

  if (resultIndex < 0) {
    return {
      hasQuery,
      navigationDisabled: false,
      resultLabel: `${resultCount} 项`,
      resultTone: "muted",
    };
  }

  return {
    hasQuery,
    navigationDisabled: false,
    resultLabel: `${resultIndex + 1}/${resultCount}`,
    resultTone: "muted",
  };
}

export function resolveTerminalSearchInputKeyAction({
  key,
  shiftKey,
}: {
  key: string;
  shiftKey: boolean;
}): TerminalSearchInputKeyAction | null {
  if (key === "Escape") {
    return "close";
  }
  if (key === "Enter" && shiftKey) {
    return "previous";
  }
  return null;
}
