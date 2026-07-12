import { useEffect, useMemo, useState } from "react";

import {
  WorkspacePaletteShell,
  type WorkspacePaletteItem,
  type WorkspacePaletteStatus,
} from "../workspace-overlay";
import type { WorkspaceContextProjection } from "../workspace/context";
import type { QuickOpenCoordinator } from "./coordinator";
import type {
  QuickOpenReference,
  QuickOpenSearchState,
} from "./types";

export interface QuickOpenPaletteProps {
  readonly context?: WorkspaceContextProjection;
  readonly coordinator: QuickOpenCoordinator;
  readonly initialQuery?: string;
  readonly onClose: () => void;
  readonly onSelect: (reference: QuickOpenReference) => void;
  readonly open: boolean;
}

const EMPTY_STATE: QuickOpenSearchState = {
  requestId: 0,
  query: "",
  status: "idle",
  results: [],
  failures: [],
};

/** Quick Open 的薄 UI 适配层，选择结果时只回传 typed reference。 */
export function QuickOpenPalette({
  context,
  coordinator,
  initialQuery = "",
  onClose,
  onSelect,
  open,
}: QuickOpenPaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [searchState, setSearchState] = useState(EMPTY_STATE);

  useEffect(() => {
    if (!open) {
      coordinator.cancel();
      return;
    }
    const controller = new AbortController();
    void coordinator.search(query, {
      context,
      signal: controller.signal,
      onUpdate: setSearchState,
    });
    return () => controller.abort();
  }, [context, coordinator, open, query]);

  const resultByItemId = useMemo(
    () => new Map(searchState.results.map((result) => [
      `${result.providerId}:${result.reference.kind}:${result.reference.id}`,
      result,
    ])),
    [searchState.results],
  );
  const items = useMemo<readonly WorkspacePaletteItem[]>(
    () =>
      searchState.results.map((result) => ({
        id: `${result.providerId}:${result.reference.kind}:${result.reference.id}`,
        label: result.label,
        description: result.description,
        leading: result.leading,
        trailing: result.trailing ?? result.targetLabel,
      })),
    [searchState.results],
  );
  const status: WorkspacePaletteStatus =
    searchState.status === "idle" ? "ready" : searchState.status;
  const failedCount = searchState.failures.length;

  return (
    <WorkspacePaletteShell
      description="在当前工作区对象中快速定位"
      emptyMessage="没有匹配的工作区对象"
      items={items}
      loadingMessage="正在查询工作区对象"
      onClose={onClose}
      onQueryChange={setQuery}
      onSelect={(item) => {
        const result = resultByItemId.get(item.id);
        if (result) {
          onClose();
          onSelect(result.reference);
        }
      }}
      open={open}
      placeholder="搜索主机、终端、文件、历史、片段或 Agent 会话"
      query={query}
      status={status}
      statusMessage={
        failedCount > 0 ? `${failedCount} 个数据源暂时不可用` : undefined
      }
      title="快速打开"
    />
  );
}

